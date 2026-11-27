import { endDirectCallsBetween } from "./direct-call.controller";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { profile, user } from "../db/schema/auth";
import { friendRequest, friendship, userBlock, userReport } from "../db/schema/community";
import { getSessionUserId } from "../lib/request-auth";
import { revokeDirectConversation } from "../services/socket-registry.service";

const reportReasons = new Set(["spam", "harassment", "impersonation", "inappropriate_content", "other"]);

export async function listBlockedUsers(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const blocked = await db.select({
        userId: user.id,
        username: user.username,
        name: user.name,
        displayName: profile.displayName,
        blockedAt: userBlock.createdAt,
    }).from(userBlock)
        .innerJoin(user, eq(user.id, userBlock.blockedId))
        .leftJoin(profile, eq(profile.userId, user.id))
        .where(eq(userBlock.blockerId, userId))
        .orderBy(userBlock.createdAt);
    return c.json({ blocked }, 200);
}

export async function blockUser(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const targetId = c.req.param("userId") ?? "";
    if (targetId === userId) return c.json({ error: "You cannot block yourself" }, 400);
    const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, targetId)).limit(1);
    if (!target) return c.json({ error: "User not found" }, 404);

    await db.transaction(async tx => {
        await tx.insert(userBlock).values({ blockerId: userId, blockedId: targetId }).onConflictDoNothing();
        const firstId = userId < targetId ? userId : targetId;
        const secondId = userId < targetId ? targetId : userId;
        await tx.delete(friendship).where(and(eq(friendship.userId, firstId), eq(friendship.friendUserId, secondId)));
        await tx.update(friendRequest).set({
            status: "canceled",
            updatedAt: new Date(),
        }).where(and(eq(friendRequest.requesterId, userId), eq(friendRequest.recipientId, targetId), eq(friendRequest.status, "pending")));
        await tx.update(friendRequest).set({
            status: "declined",
            updatedAt: new Date(),
        }).where(and(eq(friendRequest.requesterId, targetId), eq(friendRequest.recipientId, userId), eq(friendRequest.status, "pending")));
    });
    revokeDirectConversation(userId, targetId);
    await endDirectCallsBetween(userId, targetId).catch(error => {
        console.error("Unable to revoke private calls:", error);
    });
    return c.body(null, 204);
}

export async function unblockUser(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const targetId = c.req.param("userId") ?? "";
    const removed = await db.delete(userBlock)
        .where(and(eq(userBlock.blockerId, userId), eq(userBlock.blockedId, targetId)))
        .returning({ blockedId: userBlock.blockedId });
    return removed.length ? c.body(null, 204) : c.json({ error: "User is not blocked" }, 404);
}

export async function reportUser(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const targetId = c.req.param("userId") ?? "";
    if (targetId === userId) return c.json({ error: "You cannot report yourself" }, 400);
    let body: Record<string, unknown>;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    const reason = typeof body.reason === "string" ? body.reason.trim().toLowerCase() : "";
    const details = typeof body.details === "string" ? body.details.trim() : null;
    if (!reportReasons.has(reason)) return c.json({ error: "A supported report reason is required" }, 400);
    if (details !== null && details.length > 1000) return c.json({ error: "Report details must be at most 1000 characters" }, 400);
    const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, targetId)).limit(1);
    if (!target) return c.json({ error: "User not found" }, 404);

    try {
        const [report] = await db.insert(userReport).values({
            id: randomUUID(), reporterId: userId, reportedId: targetId, reason, details,
        }).returning({ id: userReport.id, status: userReport.status, createdAt: userReport.createdAt });
        return c.json({ report }, 201);
    } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: "You have already reported this user" }, 409);
        throw error;
    }
}

export async function updatePrivacySettings(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    let body: Record<string, unknown>;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    const allowed = new Set(["everyone", "friends", "nobody"]);
    const fields = ["photoVisibility", "onlineStatusVisibility", "lastSeenVisibility"] as const;
    for (const field of fields) {
        if (body[field] !== undefined && (typeof body[field] !== "string" || !allowed.has(body[field] as string))) {
            return c.json({ error: `${field} must be everyone, friends, or nobody` }, 400);
        }
    }

    const patch: Partial<typeof profile.$inferInsert> = {};
    for (const field of fields) if (body[field] !== undefined) patch[field] = body[field] as string;
    if (Object.keys(patch).length === 0) return c.json({ error: "At least one privacy setting is required" }, 400);
    patch.updatedAt = new Date();
    const [current] = await db.select({ id: profile.id }).from(profile).where(eq(profile.userId, userId)).limit(1);
    if (current) {
        await db.update(profile).set(patch).where(eq(profile.userId, userId));
    } else {
        await db.insert(profile).values({ id: randomUUID(), userId, ...patch });
    }
    const [settings] = await db.select({
        photoVisibility: profile.photoVisibility,
        onlineStatusVisibility: profile.onlineStatusVisibility,
        lastSeenVisibility: profile.lastSeenVisibility,
    }).from(profile).where(eq(profile.userId, userId)).limit(1);
    return c.json({ privacy: settings }, 200);
}

export async function getPrivacySettings(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const [settings] = await db.select({
        photoVisibility: profile.photoVisibility,
        onlineStatusVisibility: profile.onlineStatusVisibility,
        lastSeenVisibility: profile.lastSeenVisibility,
    }).from(profile).where(eq(profile.userId, userId)).limit(1);
    return c.json({ privacy: settings ?? {
        photoVisibility: "friends",
        onlineStatusVisibility: "friends",
        lastSeenVisibility: "friends",
    } }, 200);
}

function isUniqueViolation(error: unknown) {
    let current = error;
    for (let depth = 0; depth < 4; depth += 1) {
        if (typeof current !== "object" || current === null) return false;
        if ("code" in current && current.code === "23505") return true;
        current = "cause" in current ? current.cause : null;
    }
    return false;
}
