import { randomBytes, randomUUID } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { communityServer, serverChannel, serverInvite, serverMember } from "../db/schema/community";
import { getSessionUserId } from "../lib/request-auth";

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
    return c.json({ server: created }, 201);
}

export async function createServerInvite(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found" }, 404);
    if (role !== "owner" && role !== "admin") return c.json({ error: "Server admin permission required" }, 403);

    const body = await readJson(c);
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

function normalizeChannelName(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function orIsAvailableInvite(now: Date) {
    return and(
        or(isNull(serverInvite.expiresAt), gt(serverInvite.expiresAt, now)),
        or(isNull(serverInvite.maxUses), lt(serverInvite.uses, serverInvite.maxUses)),
    );
}

function isUniqueViolation(error: unknown): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
