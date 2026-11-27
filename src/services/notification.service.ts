import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbExecutor } from "../db/index";
import { notification } from "../db/schema/features";
import type { NotificationEvent } from "../models/realtime-event";
import { publishUserEvent } from "./event.service";

type NotificationInput = {
    recipients: string[];
    kind: NotificationEvent["notification"]["kind"];
    title: string;
    body: string;
    serverId?: string;
    channelId?: string;
    messageId?: string;
    actorId?: string;
};

/** Stores notifications in the caller's transaction when they accompany a message. */
export async function persistNotifications(executor: DbExecutor, input: NotificationInput) {
    const recipients = [...new Set(input.recipients.filter(Boolean))];
    if (recipients.length === 0) return [];
    const createdAt = new Date();
    const rows = recipients.map(userId => ({
        id: randomUUID(),
        userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        serverId: input.serverId ?? null,
        channelId: input.channelId ?? null,
        messageId: input.messageId ?? null,
        actorId: input.actorId ?? null,
        createdAt,
    }));
    const persisted: (typeof notification.$inferSelect)[] = [];
    for (let offset = 0; offset < rows.length; offset += 500) {
        const batch = await executor.insert(notification).values(rows.slice(offset, offset + 500))
            .onConflictDoNothing().returning();
        persisted.push(...batch);
    }
    return persisted;
}

export async function publishNotifications(rows: (typeof notification.$inferSelect)[]) {
    await Promise.all(rows.map(row => publishUserEvent([row.userId], {
        type: "notification",
        notification: {
            id: row.id,
            kind: row.kind as NotificationEvent["notification"]["kind"],
            title: row.title,
            body: row.body,
            ...(row.serverId ? { serverId: row.serverId } : {}),
            ...(row.channelId ? { channelId: row.channelId } : {}),
            ...(row.messageId ? { messageId: row.messageId } : {}),
            ...(row.actorId ? { actorId: row.actorId } : {}),
            createdAt: row.createdAt.toISOString(),
        },
    })));
}

/** Persists a notification for every recipient and pushes it in realtime. */
export async function sendNotification(input: NotificationInput) {
    try {
        await publishNotifications(await persistNotifications(db, input));
    } catch (error) {
        console.error("Unable to send notification:", error);
    }
}

/** Marks notifications linked to a message as read (used when a chat is opened). */
export async function markMessageNotificationsRead(userId: string, messageIds: string[]) {
    if (messageIds.length === 0) return;
    await db.update(notification).set({ readAt: new Date() })
        .where(and(
            eq(notification.userId, userId),
            isNull(notification.readAt),
            inArray(notification.messageId, messageIds),
        ));
}

export function toPublicNotification(row: typeof notification.$inferSelect) {
    return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        serverId: row.serverId,
        channelId: row.channelId,
        messageId: row.messageId,
        actorId: row.actorId,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
    };
}
