import type { Context } from "hono";
import { getSessionUserId } from "../lib/request-auth";
import {
    broadcastPresence,
    getPresencePermissions,
    getFriendIds,
    getFriendPresencePermissions,
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
    const access = await getPresencePermissions(viewerId, targetUserId);
    if (!access.status && !access.lastSeen) return c.json({ error: "Presence is not visible for this user" }, 403);
    const presence = toPublicPresence(await getPresence(targetUserId), targetUserId);
    return c.json({ presence: { ...presence, status: access.status ? presence.status : "offline",
        lastSeenAt: access.lastSeen ? presence.lastSeenAt : null } }, 200);
}

export async function listFriendPresence(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const friendIds = await getFriendIds(userId);
    const [presence, permissions] = await Promise.all([
        getPresenceMap(friendIds), getFriendPresencePermissions(friendIds),
    ]);
    const presences = friendIds.flatMap((id, index) => {
        const access = permissions[index];
        if (!access.status && !access.lastSeen) return [];
        const item = toPublicPresence(presence.get(id) ?? null, id);
        return [{ ...item, status: access.status ? item.status : "offline" as const,
            lastSeenAt: access.lastSeen ? item.lastSeenAt : null }];
    });
    return c.json({ presences }, 200);
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
    return c.json({ presence: toPublicPresence(row, userId) }, 200);
}
