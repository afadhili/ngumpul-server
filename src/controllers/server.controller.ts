import { randomBytes, randomUUID } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { attachment } from "../db/schema/attachment";
import { profile, user } from "../db/schema/auth";
import { communityServer, serverChannel, serverInvite, serverMember } from "../db/schema/community";
import { isUniqueViolation } from "../lib/db-errors";
import type { ChannelSummary, MemberSummary, ServerSummary } from "../models/realtime-event";
import { getSessionUserId } from "../lib/request-auth";
import { sendNotification } from "../services/notification.service";
import { deleteObject } from "../services/object-storage.service";
import { publishServerEvent, getServerMemberIds } from "../services/server-event.service";
import { revokeChannel, revokeServer, revokeUserFromServer } from "../services/socket-registry.service";

type ServerRole = "owner" | "admin" | "member";

export async function listServers(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const servers = await db
        .select({
            id: communityServer.id,
            name: communityServer.name,
            description: communityServer.description,
            icon: communityServer.icon,
            ownerId: communityServer.ownerId,
            role: serverMember.role,
            joinedAt: serverMember.joinedAt,
        })
        .from(serverMember)
        .innerJoin(communityServer, eq(communityServer.id, serverMember.serverId))
        .where(eq(serverMember.userId, userId))
        .orderBy(desc(serverMember.joinedAt));
    return c.json({ servers });
}

export async function createServer(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = body.description === undefined || body.description === null ? null : body.description;
    if (name.length < 2 || name.length > 80) return c.json({ error: "Server name must be 2–80 characters" }, 400);
    if (description !== null && (typeof description !== "string" || description.length > 500)) {
        return c.json({ error: "Description must be at most 500 characters" }, 400);
    }

    const created = await db.transaction(async tx => {
        const id = randomUUID();
        const [server] = await tx.insert(communityServer).values({
            id,
            name,
            description: typeof description === "string" ? description.trim() || null : null,
            ownerId: userId,
        }).returning();
        await tx.insert(serverMember).values({ serverId: id, userId, role: "owner" });
        await tx.insert(serverChannel).values({
            id: randomUUID(),
            serverId: id,
            name: "general",
            kind: "text",
            createdBy: userId,
        });
        return server;
    });
    await publishServerEvent(created.id, userId, "server.created", { server: toServerSummary(created) });
    return c.json({ server: created }, 201);
}

export async function createServerInvite(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found" }, 404);
    if (role !== "owner" && role !== "admin") return c.json({ error: "Server admin permission required" }, 403);

    const body = await readOptionalJson(c);
    if (body === null) return c.json({ error: "Invalid JSON body" }, 400);
    const expiresInSeconds = body.expiresInSeconds === undefined ? 7 * 24 * 60 * 60 : body.expiresInSeconds;
    const maxUses = body.maxUses === undefined ? null : body.maxUses;
    if (expiresInSeconds !== null && (!Number.isInteger(expiresInSeconds) || (expiresInSeconds as number) < 60 || (expiresInSeconds as number) > 30 * 24 * 60 * 60)) {
        return c.json({ error: "expiresInSeconds must be null or between 60 and 2592000" }, 400);
    }
    if (maxUses !== null && (!Number.isInteger(maxUses) || (maxUses as number) < 1 || (maxUses as number) > 1000)) {
        return c.json({ error: "maxUses must be null or an integer between 1 and 1000" }, 400);
    }

    const code = randomBytes(18).toString("base64url");
    const expiresAt = typeof expiresInSeconds === "number" ? new Date(Date.now() + expiresInSeconds * 1000) : null;
    await db.insert(serverInvite).values({ code, serverId, createdBy: userId, expiresAt, maxUses: maxUses as number | null });
    await publishServerEvent(serverId, userId, "server.invite_created", {}, [userId]);
    return c.json({ invite: { code, serverId, expiresAt, maxUses } }, 201);
}

export async function joinServerWithInvite(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const code = c.req.param("code") ?? "";
    const [invite] = await db.select().from(serverInvite).where(eq(serverInvite.code, code)).limit(1);
    if (!invite) return c.json({ error: "Invite not found" }, 404);

    const [existingMembership] = await db.select().from(serverMember).where(
        and(eq(serverMember.serverId, invite.serverId), eq(serverMember.userId, userId)),
    ).limit(1);
    if (existingMembership) return c.json({ error: "Already a member of this server" }, 409);

    try {
        const joined = await db.transaction(async tx => {
            const now = new Date();
            const [reservedInvite] = await tx
                .update(serverInvite)
                .set({ uses: sql`${serverInvite.uses} + 1` })
                .where(and(
                    eq(serverInvite.code, code),
                    orIsAvailableInvite(now),
                ))
                .returning();
            if (!reservedInvite) return false;

            await tx.insert(serverMember).values({ serverId: invite.serverId, userId, role: "member" });
            return true;
        });
        if (joined) {
            const memberIds = await getServerMemberIds(invite.serverId);
            await publishServerEvent(invite.serverId, userId, "server.member_added", {
                member: { userId, role: "member" },
            }, memberIds);
            const [server] = await db.select({ ownerId: communityServer.ownerId, name: communityServer.name })
                .from(communityServer).where(eq(communityServer.id, invite.serverId)).limit(1);
            if (server && server.ownerId !== userId) {
                await sendNotification({
                    recipients: [server.ownerId],
                    kind: "member_joined",
                    title: "Anggota baru",
                    body: `Seseorang bergabung ke ${server.name}`,
                    serverId: invite.serverId,
                    actorId: userId,
                });
            }
        }
        return joined
            ? c.json({ serverId: invite.serverId, joined: true }, 201)
            : c.json({ error: "Invite has expired or reached its use limit" }, 410);
    } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: "Already a member of this server" }, 409);
        throw error;
    }
}

export async function listServerChannels(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found or access denied" }, 404);

    const channels = await db
        .select()
        .from(serverChannel)
        .where(eq(serverChannel.serverId, serverId))
        .orderBy(serverChannel.position, serverChannel.createdAt);
    return c.json({ channels });
}

export async function createServerChannel(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found or access denied" }, 404);
    if (role !== "owner" && role !== "admin") return c.json({ error: "Server admin permission required" }, 403);

    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const name = typeof body.name === "string" ? normalizeChannelName(body.name) : "";
    const kind = body.kind;
    const description = body.description === undefined || body.description === null ? null : body.description;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(name)) {
        return c.json({ error: "Channel name must use lowercase letters, numbers, and hyphens" }, 400);
    }
    if (kind !== "text" && kind !== "voice") return c.json({ error: "kind must be 'text' or 'voice'" }, 400);
    if (description !== null && (typeof description !== "string" || description.length > 500)) {
        return c.json({ error: "Description must be at most 500 characters" }, 400);
    }

    const [lastChannel] = await db.select({ position: serverChannel.position }).from(serverChannel)
        .where(eq(serverChannel.serverId, serverId)).orderBy(desc(serverChannel.position)).limit(1);
    try {
        const [channel] = await db.insert(serverChannel).values({
            id: randomUUID(),
            serverId,
            name,
            kind,
            description: typeof description === "string" ? description.trim() || null : null,
            position: (lastChannel?.position ?? -1) + 1,
            createdBy: userId,
        }).returning();
        await publishServerEvent(serverId, userId, "server.channel_created", { channel: toChannelSummary(channel) });
        return c.json({ channel }, 201);
    } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: "A channel with that name already exists" }, 409);
        throw error;
    }
}

export async function getVoiceChannelToken(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found or access denied" }, 404);

    const [channel] = await db.select({ id: serverChannel.id, kind: serverChannel.kind })
        .from(serverChannel)
        .where(and(eq(serverChannel.id, channelId), eq(serverChannel.serverId, serverId)))
        .limit(1);
    if (!channel || channel.kind !== "voice") return c.json({ error: "Voice channel not found" }, 404);

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) return c.json({ error: "Voice service is not configured" }, 503);

    const room = `server-${serverId}-channel-${channelId}`;
    const accessToken = new AccessToken(apiKey, apiSecret, { identity: userId, ttl: "1h" });
    accessToken.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
    return c.json({
        url: process.env.LIVEKIT_PUBLIC_URL ?? "ws://localhost:7880",
        token: await accessToken.toJwt(),
        room,
        expiresInSeconds: 3600,
    });
}

export async function updateServer(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found" }, 404);
    if (role !== "owner" && role !== "admin") return c.json({ error: "Server admin permission required" }, 403);

    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const patch: Partial<typeof communityServer.$inferInsert> = {};
    if (body.name !== undefined) {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (name.length < 2 || name.length > 80) return c.json({ error: "Server name must be 2–80 characters" }, 400);
        patch.name = name;
    }
    if (body.description !== undefined) {
        if (body.description !== null && (typeof body.description !== "string" || body.description.length > 500)) {
            return c.json({ error: "Description must be at most 500 characters" }, 400);
        }
        patch.description = typeof body.description === "string" ? body.description.trim() || null : null;
    }
    if (body.icon !== undefined) {
        if (body.icon !== null && (typeof body.icon !== "string" || body.icon.length > 2048 || !isHttpUrl(body.icon))) {
            return c.json({ error: "Server icon must be an HTTP or HTTPS URL" }, 400);
        }
        patch.icon = typeof body.icon === "string" ? body.icon : null;
    }
    if (Object.keys(patch).length === 0) return c.json({ error: "At least one server field is required" }, 400);
    patch.updatedAt = new Date();

    const [server] = await db.update(communityServer).set(patch)
        .where(eq(communityServer.id, serverId)).returning();
    if (server) await publishServerEvent(serverId, userId, "server.updated", { server: toServerSummary(server) });
    return server ? c.json({ server }) : c.json({ error: "Server not found" }, 404);
}

export async function deleteServer(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found" }, 404);
    if (role !== "owner") return c.json({ error: "Only the server owner can delete this server" }, 403);

    const channels = await db.select({ id: serverChannel.id }).from(serverChannel)
        .where(eq(serverChannel.serverId, serverId));
    const memberIds = await getServerMemberIds(serverId);
    revokeServer(serverId);
    await db.delete(communityServer).where(eq(communityServer.id, serverId));
    await deleteChannelAttachments(channels.map(channel => channel.id));
    await publishServerEvent(serverId, userId, "server.deleted", {}, memberIds);
    return c.body(null, 204);
}

export async function updateServerChannel(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found" }, 404);
    if (role !== "owner" && role !== "admin") return c.json({ error: "Server admin permission required" }, 403);

    const [channel] = await db.select({ id: serverChannel.id }).from(serverChannel)
        .where(and(eq(serverChannel.id, channelId), eq(serverChannel.serverId, serverId)))
        .limit(1);
    if (!channel) return c.json({ error: "Channel not found" }, 404);

    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const patch: Partial<typeof serverChannel.$inferInsert> = {};
    if (body.name !== undefined) {
        const name = typeof body.name === "string" ? normalizeChannelName(body.name) : "";
        if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(name)) {
            return c.json({ error: "Channel name must use lowercase letters, numbers, and hyphens" }, 400);
        }
        patch.name = name;
    }
    if (body.description !== undefined) {
        if (body.description !== null && (typeof body.description !== "string" || body.description.length > 500)) {
            return c.json({ error: "Description must be at most 500 characters" }, 400);
        }
        patch.description = typeof body.description === "string" ? body.description.trim() || null : null;
    }
    if (body.position !== undefined) {
        if (!Number.isInteger(body.position) || (body.position as number) < 0 || (body.position as number) > 1_000_000) {
            return c.json({ error: "position must be a non-negative integer" }, 400);
        }
        patch.position = body.position as number;
    }
    if (Object.keys(patch).length === 0) return c.json({ error: "At least one channel field is required" }, 400);
    patch.updatedAt = new Date();

    try {
        const [updated] = await db.update(serverChannel).set(patch)
            .where(and(eq(serverChannel.id, channelId), eq(serverChannel.serverId, serverId)))
            .returning();
        if (updated) await publishServerEvent(serverId, userId, "server.channel_updated", { channel: toChannelSummary(updated) });
        return updated ? c.json({ channel: updated }) : c.json({ error: "Channel not found" }, 404);
    } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: "A channel with that name already exists" }, 409);
        throw error;
    }
}

export async function deleteServerChannel(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found" }, 404);
    if (role !== "owner" && role !== "admin") return c.json({ error: "Server admin permission required" }, 403);

    const [channel] = await db.select().from(serverChannel)
        .where(and(eq(serverChannel.id, channelId), eq(serverChannel.serverId, serverId)))
        .limit(1);
    if (!channel) return c.json({ error: "Channel not found" }, 404);

    const memberIds = await getServerMemberIds(serverId);
    revokeChannel(channelId);
    await db.delete(serverChannel).where(eq(serverChannel.id, channelId));
    await deleteChannelAttachments([channelId]);
    await publishServerEvent(serverId, userId, "server.channel_deleted", { channel: toChannelSummary(channel) }, memberIds);
    return c.body(null, 204);
}

export async function listServerMembers(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    if (!await getServerRole(serverId, userId)) return c.json({ error: "Server not found or access denied" }, 404);

    const members = await db.select({
        userId: user.id,
        username: user.username,
        displayName: profile.displayName,
        avatar: profile.avatar,
        role: serverMember.role,
        joinedAt: serverMember.joinedAt,
    }).from(serverMember)
        .innerJoin(user, eq(user.id, serverMember.userId))
        .leftJoin(profile, eq(profile.userId, user.id))
        .where(eq(serverMember.serverId, serverId))
        .orderBy(serverMember.joinedAt);
    return c.json({ members });
}

export async function addServerMember(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found" }, 404);
    if (role !== "owner" && role !== "admin") return c.json({ error: "Server admin permission required" }, 403);

    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const targetUserId = typeof body.userId === "string" ? body.userId : "";
    if (!username && !targetUserId) return c.json({ error: "username or userId is required" }, 400);

    const [target] = await db.select({ id: user.id, username: user.username }).from(user)
        .where(username ? eq(user.username, username) : eq(user.id, targetUserId))
        .limit(1);
    if (!target) return c.json({ error: "User not found" }, 404);

    const [existing] = await db.select({ role: serverMember.role }).from(serverMember)
        .where(and(eq(serverMember.serverId, serverId), eq(serverMember.userId, target.id)))
        .limit(1);
    if (existing) return c.json({ error: "User is already a member of this server" }, 409);

    const [member] = await db.insert(serverMember).values({
        serverId,
        userId: target.id,
        role: "member",
    }).returning().catch(error => {
        if (isUniqueViolation(error)) return [];
        throw error;
    });
    if (!member) return c.json({ error: "User is already a member of this server" }, 409);
    const memberIds = await getServerMemberIds(serverId);
    await publishServerEvent(serverId, userId, "server.member_added", {
        member: { userId: target.id, username: target.username, role: member.role as "member", joinedAt: member.joinedAt.toISOString() },
    }, memberIds);
    await sendNotification({
        recipients: [target.id],
        kind: "server_added",
        title: "Ditambahkan ke server",
        body: "Kamu ditambahkan ke sebuah server",
        serverId,
        actorId: userId,
    });
    return c.json({ member: { userId: target.id, username: target.username, role: member.role } }, 201);
}

export async function updateServerMember(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const targetUserId = c.req.param("userId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found" }, 404);
    if (role !== "owner") return c.json({ error: "Only the server owner can change member roles" }, 403);
    if (targetUserId === userId) return c.json({ error: "The server owner's role cannot be changed" }, 400);

    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const newRole = body.role;
    if (newRole !== "admin" && newRole !== "member") {
        return c.json({ error: "role must be admin or member" }, 400);
    }

    const [target] = await db.select({ role: serverMember.role }).from(serverMember)
        .where(and(eq(serverMember.serverId, serverId), eq(serverMember.userId, targetUserId)))
        .limit(1);
    if (!target) return c.json({ error: "Member not found" }, 404);
    if (target.role === "owner") return c.json({ error: "The server owner's role cannot be changed" }, 403);

    const [member] = await db.update(serverMember).set({ role: newRole })
        .where(and(eq(serverMember.serverId, serverId), eq(serverMember.userId, targetUserId)))
        .returning();
    await publishServerEvent(serverId, userId, "server.member_updated", {
        member: { userId: targetUserId, role: newRole, joinedAt: member?.joinedAt.toISOString() },
    });
    return c.json({ member });
}

export async function removeServerMember(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const targetUserId = c.req.param("userId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found" }, 404);

    const [target] = await db.select({ role: serverMember.role }).from(serverMember)
        .where(and(eq(serverMember.serverId, serverId), eq(serverMember.userId, targetUserId)))
        .limit(1);
    if (!target) return c.json({ error: "Member not found" }, 404);

    if (targetUserId === userId) {
        if (target.role === "owner") {
            return c.json({ error: "The server owner cannot leave; transfer the server or delete it" }, 400);
        }
    } else {
        if (role !== "owner" && role !== "admin") return c.json({ error: "Server admin permission required" }, 403);
        if (target.role === "owner") return c.json({ error: "The server owner cannot be removed" }, 403);
        if (target.role === "admin" && role !== "owner") {
            return c.json({ error: "Only the server owner can remove an admin" }, 403);
        }
    }

    const memberIds = await getServerMemberIds(serverId);
    await db.delete(serverMember).where(and(
        eq(serverMember.serverId, serverId),
        eq(serverMember.userId, targetUserId),
    ));
    revokeUserFromServer(targetUserId, serverId);
    await publishServerEvent(serverId, userId, "server.member_removed", {
        member: { userId: targetUserId, role: target.role as "owner" | "admin" | "member" },
    }, memberIds);
    if (targetUserId !== userId) {
        await sendNotification({
            recipients: [targetUserId],
            kind: "member_joined",
            title: "Dikeluarkan dari server",
            body: "Kamu tidak lagi menjadi anggota server ini",
            serverId,
            actorId: userId,
        });
    }
    return c.body(null, 204);
}

function toServerSummary(row: typeof communityServer.$inferSelect): ServerSummary {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        icon: row.icon,
        ownerId: row.ownerId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function toChannelSummary(row: typeof serverChannel.$inferSelect): ChannelSummary {
    return {
        id: row.id,
        serverId: row.serverId,
        name: row.name,
        description: row.description,
        kind: row.kind as "text" | "voice",
        position: row.position,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

async function deleteChannelAttachments(channelIds: string[]) {
    if (channelIds.length === 0) return;
    const files = await db.select({
        id: attachment.id,
        storageKey: attachment.storageKey,
        uploadKey: attachment.uploadKey,
    }).from(attachment).where(and(
        eq(attachment.targetType, "channel"),
        inArray(attachment.targetId, channelIds),
    ));
    await Promise.allSettled(files.flatMap(file => [deleteObject(file.storageKey), deleteObject(file.uploadKey)]));
    if (files.length > 0) {
        await db.delete(attachment).where(inArray(attachment.id, files.map(file => file.id)));
    }
}

async function getServerRole(serverId: string, userId: string): Promise<ServerRole | null> {
    const [membership] = await db.select({ role: serverMember.role }).from(serverMember)
        .where(and(eq(serverMember.serverId, serverId), eq(serverMember.userId, userId))).limit(1);
    return membership?.role === "owner" || membership?.role === "admin" || membership?.role === "member"
        ? membership.role
        : null;
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
    try {
        const body: unknown = await c.req.json();
        return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

async function readOptionalJson(c: Context): Promise<Record<string, unknown> | null> {
    const raw = await c.req.text().catch(() => null);
    if (raw === null) return null;
    if (raw.trim() === "") return {};
    try {
        const body: unknown = JSON.parse(raw);
        return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

function normalizeChannelName(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function orIsAvailableInvite(now: Date) {
    return and(
        or(isNull(serverInvite.expiresAt), gt(serverInvite.expiresAt, now)),
        or(isNull(serverInvite.maxUses), lt(serverInvite.uses, serverInvite.maxUses)),
    );
}

function isHttpUrl(value: string) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}
