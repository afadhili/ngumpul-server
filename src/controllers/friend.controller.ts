import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { profile, user } from "../db/schema/auth";
import { friendRequest, friendship, userBlock } from "../db/schema/community";
import { getSessionUserId } from "../lib/request-auth";

export async function listFriends(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const rows = await db
        .select({ userId: friendship.userId, friendUserId: friendship.friendUserId, createdAt: friendship.createdAt })
        .from(friendship)
        .where(or(eq(friendship.userId, userId), eq(friendship.friendUserId, userId)));
    const friendIds = rows.map(row => (row.userId === userId ? row.friendUserId : row.userId));
    if (friendIds.length === 0) return c.json({ friends: [] });

    const profiles = await db
        .select({ userId: user.id, username: user.username, displayName: profile.displayName, avatar: profile.avatar })
        .from(user)
        .leftJoin(profile, eq(profile.userId, user.id))
        .where(inArray(user.id, friendIds));
    const byId = new Map(profiles.map(item => [item.userId, item]));
    return c.json({ friends: rows.map(row => byId.get(row.userId === userId ? row.friendUserId : row.userId)).filter(Boolean) });
}

export async function listFriendRequests(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const [incoming, outgoing] = await Promise.all([
        db
            .select({ id: friendRequest.id, userId: user.id, username: user.username, displayName: profile.displayName, createdAt: friendRequest.createdAt })
            .from(friendRequest)
            .innerJoin(user, eq(user.id, friendRequest.requesterId))
            .leftJoin(profile, eq(profile.userId, user.id))
            .where(and(eq(friendRequest.recipientId, userId), eq(friendRequest.status, "pending"))),
        db
            .select({ id: friendRequest.id, userId: user.id, username: user.username, displayName: profile.displayName, createdAt: friendRequest.createdAt })
            .from(friendRequest)
            .innerJoin(user, eq(user.id, friendRequest.recipientId))
            .leftJoin(profile, eq(profile.userId, user.id))
            .where(and(eq(friendRequest.requesterId, userId), eq(friendRequest.status, "pending"))),
    ]);

    return c.json({ incoming, outgoing });
}

export async function sendFriendRequest(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    let body: { username?: unknown };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return c.json({ error: "A valid username is required" }, 400);

    const [target] = await db.select({ userId: user.id }).from(user).where(eq(user.username, username)).limit(1);
    if (!target) return c.json({ error: "User not found" }, 404);
    if (target.userId === userId) return c.json({ error: "You cannot add yourself as a friend" }, 400);

    const [block] = await db.select({ blockerId: userBlock.blockerId }).from(userBlock)
        .where(or(
            and(eq(userBlock.blockerId, userId), eq(userBlock.blockedId, target.userId)),
            and(eq(userBlock.blockerId, target.userId), eq(userBlock.blockedId, userId)),
        )).limit(1);
    if (block) return c.json({ error: "Friend requests are unavailable for this user" }, 403);

    const [existingFriendship] = await db
        .select()
        .from(friendship)
        .where(or(
            and(eq(friendship.userId, userId), eq(friendship.friendUserId, target.userId)),
            and(eq(friendship.userId, target.userId), eq(friendship.friendUserId, userId)),
        ))
        .limit(1);
    if (existingFriendship) return c.json({ error: "Already friends" }, 409);

    const [existingRequest] = await db
        .select()
        .from(friendRequest)
        .where(and(
            eq(friendRequest.status, "pending"),
            or(
                and(eq(friendRequest.requesterId, userId), eq(friendRequest.recipientId, target.userId)),
                and(eq(friendRequest.requesterId, target.userId), eq(friendRequest.recipientId, userId)),
            ),
        ))
        .limit(1);
    if (existingRequest) return c.json({ error: "A friend request is already pending" }, 409);

    try {
        const [request] = await db.insert(friendRequest).values({
            id: randomUUID(),
            requesterId: userId,
            recipientId: target.userId,
        }).returning();
        return c.json({ request }, 201);
    } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: "A friend request is already pending" }, 409);
        throw error;
    }
}

export async function acceptFriendRequest(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const requestId = c.req.param("requestId") ?? "";

    try {
        const accepted = await db.transaction(async tx => {
            const [request] = await tx
                .update(friendRequest)
                .set({ status: "accepted", updatedAt: new Date() })
                .where(and(eq(friendRequest.id, requestId), eq(friendRequest.recipientId, userId), eq(friendRequest.status, "pending")))
                .returning();
            if (!request) return null;

            const firstId = request.requesterId < request.recipientId ? request.requesterId : request.recipientId;
            const secondId = request.requesterId < request.recipientId ? request.recipientId : request.requesterId;
            await tx.insert(friendship).values({ userId: firstId, friendUserId: secondId }).onConflictDoNothing();
            return request;
        });
        return accepted ? c.json({ request: accepted }) : c.json({ error: "Pending friend request not found" }, 404);
    } catch (error) {
        throw error;
    }
}

export async function declineFriendRequest(c: Context) {
    return updateFriendRequestStatus(c, "declined");
}

export async function cancelFriendRequest(c: Context) {
    return updateFriendRequestStatus(c, "canceled");
}

export async function removeFriend(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const friendUserId = c.req.param("userId") ?? "";
    const firstId = userId < friendUserId ? userId : friendUserId;
    const secondId = userId < friendUserId ? friendUserId : userId;
    const removed = await db.delete(friendship).where(and(eq(friendship.userId, firstId), eq(friendship.friendUserId, secondId))).returning();
    return removed.length ? c.body(null, 204) : c.json({ error: "Friend not found" }, 404);
}

async function updateFriendRequestStatus(c: Context, status: "declined" | "canceled") {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const requestId = c.req.param("requestId") ?? "";
    const condition = status === "declined"
        ? and(eq(friendRequest.id, requestId), eq(friendRequest.recipientId, userId), eq(friendRequest.status, "pending"))
        : and(eq(friendRequest.id, requestId), eq(friendRequest.requesterId, userId), eq(friendRequest.status, "pending"));
    const [updated] = await db.update(friendRequest).set({ status, updatedAt: new Date() }).where(condition).returning();
    return updated ? c.json({ request: updated }) : c.json({ error: "Pending friend request not found" }, 404);
}

function isUniqueViolation(error: unknown): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
