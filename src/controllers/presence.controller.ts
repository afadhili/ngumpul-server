import type { Context } from "hono";
import { getSessionUserId } from "../lib/request-auth";
import {
    broadcastPresence,
    canViewPresence,
    getFriendIds,
    getPresence,
    getPresenceMap,
    setPresenceStatus,
    toPublicPresence,
} from "../services/presence.service";

export async function getUserPresence(c: Context) {
    const viewerId = await getSessionUserId(c);
    if (!viewerId) return c.json({ error: "Unauthorized" }, 401);
    const targetUserId = c.req.param("userId") ?? "";
    if (!targetUserId) return c.json({ error: "userId is required" }, 400);
    if (!await canViewPresence(viewerId, targetUserId)) {
        return c.json({ error: "Presence is not visible for this user" }, 403);
    }
    return c.json({ presence: toPublicPresence(await getPresence(targetUserId), targetUserId) });
}

export async function listFriendPresence(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const friendIds = await getFriendIds(userId);
    const presence = await getPresenceMap(friendIds);
    return c.json({
        presences: friendIds.map(id => toPublicPresence(presence.get(id) ?? null, id)),
    });
}

export async function updateMyPresence(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    const status = typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>).status
        : undefined;
    if (status !== "online" && status !== "away" && status !== "offline") {
        return c.json({ error: "status must be online, away or offline" }, 400);
    }
    const row = await setPresenceStatus(userId, status);
    await broadcastPresence(userId);
    return c.json({ presence: toPublicPresence(row, userId) });
}
