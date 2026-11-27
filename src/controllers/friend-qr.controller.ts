import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { profile, user } from "../db/schema/auth";
import { friendRequest, friendship, userBlock } from "../db/schema/community";
import { createFriendQrCode, readFriendQrCode } from "../lib/friend-qr";
import { isUniqueViolation } from "../lib/db-errors";
import { getSessionUserId } from "../lib/request-auth";

async function findFriendTarget(userId: string, targetId: string) {
    const [target] = await db.select({
        id: user.id,
        username: user.username,
        displayName: profile.displayName,
        avatar: profile.avatar,
        photoVisibility: profile.photoVisibility,
    }).from(user).leftJoin(profile, eq(profile.userId, user.id)).where(eq(user.id, targetId)).limit(1);
    return target ?? null;
}

async function sharedBlock(userId: string, targetId: string) {
    const [block] = await db.select({ blockerId: userBlock.blockerId }).from(userBlock)
        .where(or(
            and(eq(userBlock.blockerId, userId), eq(userBlock.blockedId, targetId)),
            and(eq(userBlock.blockerId, targetId), eq(userBlock.blockedId, userId)),
        )).limit(1);
    return block ?? null;
}

async function areFriends(userId: string, targetId: string) {
    const [row] = await db.select({ userId: friendship.userId }).from(friendship).where(or(
        and(eq(friendship.userId, userId), eq(friendship.friendUserId, targetId)),
        and(eq(friendship.userId, targetId), eq(friendship.friendUserId, userId)),
    )).limit(1);
    return row ?? null;
}

/** Creates a short-lived, self-contained friend code that anyone can scan or open. */
export async function createFriendQr(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    let expiresInSeconds = 3600;
    const raw = c.req.query("expiresInSeconds");
    if (raw !== undefined) {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 60 || parsed > 86_400) {
            return c.json({ error: "expiresInSeconds must be an integer between 60 and 86400" }, 400);
        }
        expiresInSeconds = parsed;
    }

    const [me] = await db.select({ id: user.id, username: user.username }).from(user)
        .where(eq(user.id, userId)).limit(1);
    if (!me) return c.json({ error: "User not found" }, 404);

    const { code, expiresAt } = createFriendQrCode(userId, expiresInSeconds);
    const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
    return c.json({
        qr: {
            code,
            username: me.username,
            expiresAt: expiresAt.toISOString(),
            expiresInSeconds,
            deepLink: `ngumpul://friend?code=${encodeURIComponent(code)}`,
            httpUrl: `${baseUrl.replace(/\/$/, "")}/api/friends/qr/${encodeURIComponent(code)}`,
        },
    }, 200);
}

/** Preview who a scanned code belongs to before the requester confirms. */
export async function previewFriendQr(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const parsed = readFriendQrCode(c.req.param("code") ?? "");
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);

    const target = await findFriendTarget(userId, parsed.userId);
    if (!target) return c.json({ error: "This friend QR code is not valid" }, 404);
    if (target.id === userId) return c.json({ error: "This is your own friend QR code" }, 400);

    const [block, friends] = await Promise.all([
        sharedBlock(userId, target.id),
        areFriends(userId, target.id),
    ]);
    return c.json({
        qr: {
            user: {
                id: target.id,
                username: target.username,
                displayName: target.displayName ?? null,
                avatar: !block && (target.photoVisibility === "everyone" || (friends && target.photoVisibility !== "nobody")) ? target.avatar : null,
            },
            expiresAt: parsed.expiresAt.toISOString(),
            canRequest: !block && !friends,
            alreadyFriends: Boolean(friends),
            blocked: Boolean(block),
        },
    }, 200);
}

/** Redeems a scanned friend code by creating the usual pending friend request. */
export async function claimFriendQr(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    const code = typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>).code
        : undefined;
    if (typeof code !== "string") return c.json({ error: "A friend QR code is required" }, 400);

    const parsed = readFriendQrCode(code);
    if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);

    const target = await findFriendTarget(userId, parsed.userId);
    if (!target) return c.json({ error: "This friend QR code is not valid" }, 404);
    if (target.id === userId) return c.json({ error: "You cannot add yourself as a friend" }, 400);
    if (await sharedBlock(userId, target.id)) {
        return c.json({ error: "Friend requests are unavailable for this user" }, 403);
    }
    if (await areFriends(userId, target.id)) return c.json({ error: "Already friends" }, 409);

    const [existingRequest] = await db.select({ id: friendRequest.id }).from(friendRequest)
        .where(and(
            eq(friendRequest.status, "pending"),
            or(
                and(eq(friendRequest.requesterId, userId), eq(friendRequest.recipientId, target.id)),
                and(eq(friendRequest.requesterId, target.id), eq(friendRequest.recipientId, userId)),
            ),
        )).limit(1);
    if (existingRequest) return c.json({ error: "A friend request is already pending" }, 409);

    try {
        const [request] = await db.insert(friendRequest).values({
            id: randomUUID(),
            requesterId: userId,
            recipientId: target.id,
        }).returning();
        return c.json({
            request,
            user: { id: target.id, username: target.username, displayName: target.displayName ?? null, avatar: target.avatar ?? null },
        }, 201);
    } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: "A friend request is already pending" }, 409);
        throw error;
    }
}
