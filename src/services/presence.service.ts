import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import { user } from "../db/schema/auth";
import { friendship } from "../db/schema/community";
import { userPreference, userPresence } from "../db/schema/features";
import type { PresenceEvent } from "../models/realtime-event";
import { publishUserEvent } from "./event.service";

type PresenceStatus = "online" | "away" | "offline";

export async function markOnline(userId: string) {
    const now = new Date();
    const [row] = await db.insert(userPresence).values({
        userId,
        status: "online",
        connections: 1,
        lastSeenAt: now,
        lastActiveAt: now,
        updatedAt: now,
    }).onConflictDoUpdate({
        target: userPresence.userId,
        set: {
            status: "online",
            connections: sql`${userPresence.connections} + 1`,
            lastActiveAt: now,
            updatedAt: now,
        },
    }).returning();
    return row;
}

export async function markOffline(userId: string) {
    const now = new Date();
    const [row] = await db.insert(userPresence).values({
        userId,
        status: "offline",
        connections: 0,
        lastSeenAt: now,
        lastActiveAt: now,
        updatedAt: now,
    }).onConflictDoUpdate({
        target: userPresence.userId,
        set: {
            connections: sql`greatest(${userPresence.connections} - 1, 0)`,
            status: sql`case when ${userPresence.connections} - 1 <= 0 then 'offline' else ${userPresence.status} end`,
            lastSeenAt: now,
            updatedAt: now,
        },
    }).returning();
    return row;
}

export async function setPresenceStatus(userId: string, status: PresenceStatus) {
    const now = new Date();
    const [row] = await db.insert(userPresence).values({
        userId,
        status,
        connections: status === "offline" ? 0 : 1,
        lastSeenAt: now,
        lastActiveAt: now,
        updatedAt: now,
    }).onConflictDoUpdate({
        target: userPresence.userId,
        set: { status, lastSeenAt: now, lastActiveAt: now, updatedAt: now },
    }).returning();
    return row;
}

export async function getPresence(userId: string) {
    const [row] = await db.select().from(userPresence).where(eq(userPresence.userId, userId)).limit(1);
    return row ?? null;
}

export async function getPresenceMap(userIds: string[]) {
    const result = new Map<string, typeof userPresence.$inferSelect>();
    if (userIds.length === 0) return result;
    const rows = await db.select().from(userPresence).where(inArray(userPresence.userId, userIds));
    for (const row of rows) result.set(row.userId, row);
    return result;
}

export async function getFriendIds(userId: string) {
    const rows = await db.select({
        userId: friendship.userId,
        friendUserId: friendship.friendUserId,
    }).from(friendship).where(or(eq(friendship.userId, userId), eq(friendship.friendUserId, userId)));
    return rows.map(row => (row.userId === userId ? row.friendUserId : row.userId));
}

type PresenceVisibility = "everyone" | "friends" | "nobody";

export async function getPresenceVisibility(userId: string): Promise<PresenceVisibility> {
    const [row] = await db.select({ settings: userPreference.settings })
        .from(userPreference).where(eq(userPreference.userId, userId)).limit(1);
    const settings = row?.settings as Record<string, unknown> | null | undefined;
    const value = settings?.presenceVisibility;
    return value === "everyone" || value === "friends" || value === "nobody" ? value : "friends";
}

/** Returns whether `viewerId` may see the presence of `targetUserId`. */
export async function canViewPresence(viewerId: string, targetUserId: string) {
    if (viewerId === targetUserId) return true;
    const visibility = await getPresenceVisibility(targetUserId);
    if (visibility === "nobody") return false;
    if (visibility === "everyone") return true;
    const [link] = await db.select({ userId: friendship.userId }).from(friendship).where(and(
        or(
            and(eq(friendship.userId, viewerId), eq(friendship.friendUserId, targetUserId)),
            and(eq(friendship.userId, targetUserId), eq(friendship.friendUserId, viewerId)),
        ),
    )).limit(1);
    return Boolean(link);
}

export function toPublicPresence(row: typeof userPresence.$inferSelect | null, userId: string) {
    return {
        userId,
        status: (row?.status ?? "offline") as PresenceStatus,
        lastSeenAt: row?.lastSeenAt?.toISOString() ?? null,
        updatedAt: (row?.updatedAt ?? new Date()).toISOString(),
    };
}

/** Broadcasts the current presence of `userId` to friends that may see it. */
export async function broadcastPresence(userId: string) {
    const presence = await getPresence(userId);
    const visibility = await getPresenceVisibility(userId);
    if (visibility === "nobody") return;
    const recipients = visibility === "everyone"
        ? (await db.select({ id: user.id }).from(user)).map(row => row.id)
        : await getFriendIds(userId);
    const filtered = recipients.filter(id => id !== userId).slice(0, 500);
    if (filtered.length === 0) return;
    const event: PresenceEvent = {
        type: "presence",
        userId,
        status: (presence?.status ?? "offline") as PresenceStatus,
        lastSeenAt: presence?.lastSeenAt?.toISOString() ?? null,
        updatedAt: (presence?.updatedAt ?? new Date()).toISOString(),
    };
    try {
        await publishUserEvent(filtered, event);
    } catch (error) {
        console.error("Unable to publish presence:", error);
    }
}
