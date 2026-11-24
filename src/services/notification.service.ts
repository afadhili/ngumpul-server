import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index";
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

/** Persists a notification for every recipient and pushes it in realtime. */
export async function sendNotification(input: NotificationInput) {
    const recipients = [...new Set(input.recipients.filter(Boolean))];
    if (recipients.length === 0) return;
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
    try {
        await db.insert(notification).values(rows).onConflictDoNothing();
    } catch (error) {
        console.error("Unable to persist notifications:", error);
    }
    try {
        for (const row of rows) {
            const event: NotificationEvent = {
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
                    createdAt: createdAt.toISOString(),
                },
            };
            await publishUserEvent([row.userId], event);
        }
    } catch (error) {
        console.error("Unable to publish notification:", error);
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
