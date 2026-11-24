import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { notification } from "../db/schema/features";
import { getSessionUserId } from "../lib/request-auth";
import { toPublicNotification } from "../services/notification.service";

export async function listNotifications(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const rawLimit = Number(c.req.query("limit") ?? 50);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
        return c.json({ error: "limit must be between 1 and 100" }, 400);
    }
    const before = c.req.query("before");
    const unreadOnly = c.req.query("unread") === "true";
    const conditions = [eq(notification.userId, userId)];
    if (unreadOnly) conditions.push(isNull(notification.readAt));
    if (before) {
        const [cursor] = await db.select({ createdAt: notification.createdAt, id: notification.id })
            .from(notification)
            .where(and(eq(notification.id, before), eq(notification.userId, userId)))
            .limit(1);
        if (!cursor) return c.json({ error: "Notification cursor not found" }, 400);
        const cursorCondition = or(
            lt(notification.createdAt, cursor.createdAt),
            and(eq(notification.createdAt, cursor.createdAt), lt(notification.id, cursor.id)),
        );
        if (cursorCondition) conditions.push(cursorCondition);
    }
    const rows = await db.select().from(notification)
        .where(and(...conditions))
        .orderBy(desc(notification.createdAt), desc(notification.id))
        .limit(rawLimit);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(notification)
        .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
    return c.json({
        notifications: rows.map(toPublicNotification),
        nextCursor: rows.length === rawLimit ? rows[rows.length - 1]?.id ?? null : null,
        unreadCount: countRow?.count ?? 0,
    });
}

export async function markNotificationRead(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const notificationId = c.req.param("notificationId") ?? "";
    const [existing] = await db.select().from(notification)
        .where(and(eq(notification.id, notificationId), eq(notification.userId, userId))).limit(1);
    if (!existing) return c.json({ error: "Notification not found" }, 404);
    if (existing.readAt) return c.json({ notification: toPublicNotification(existing) });
    const [updated] = await db.update(notification).set({ readAt: new Date() })
        .where(and(eq(notification.id, notificationId), eq(notification.userId, userId)))
        .returning();
    return c.json({ notification: toPublicNotification(updated ?? existing) });
}

export async function markAllNotificationsRead(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const updated = await db.update(notification).set({ readAt: new Date() })
        .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
        .returning({ id: notification.id });
    return c.json({ updatedCount: updated.length });
}

export async function deleteNotification(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const notificationId = c.req.param("notificationId") ?? "";
    const deleted = await db.delete(notification)
        .where(and(eq(notification.id, notificationId), eq(notification.userId, userId)))
        .returning({ id: notification.id });
    if (deleted.length === 0) return c.json({ error: "Notification not found" }, 404);
    return c.body(null, 204);
}

export async function clearReadNotifications(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const deleted = await db.delete(notification).where(and(
        eq(notification.userId, userId),
        sql`${notification.readAt} IS NOT NULL`,
    )).returning({ id: notification.id });
    return c.json({ deletedCount: deleted.length });
}

export async function getUnreadNotificationCount(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(notification)
        .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
    return c.json({ unreadCount: row?.count ?? 0 });
}
