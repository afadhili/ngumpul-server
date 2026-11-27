import { and, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { channelMessage } from "../db/schema/channel-message";
import { channelReadState, conversationPreference } from "../db/schema/features";
import { serverChannel, serverMember } from "../db/schema/community";
import { getChannelAccess } from "../lib/channel-access";
import { getSessionUserId } from "../lib/request-auth";
import type { ReadStateEvent } from "../models/realtime-event";
import { publishUserEvent } from "../services/event.service";
import { markChannelNotificationsRead } from "../services/notification.service";
import { getServerMemberIds } from "../services/server-event.service";

export async function getChannelReadState(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") || undefined;
    const channelId = c.req.param("channelId") ?? "";
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found or access denied" }, 404);
    const [row] = await db.select().from(channelReadState)
        .where(and(eq(channelReadState.channelId, channelId), eq(channelReadState.userId, userId)))
        .limit(1);
    return c.json({
        readState: {
            channelId,
            lastReadMessageId: row?.lastReadMessageId ?? null,
            lastReadAt: row?.lastReadAt?.toISOString() ?? null,
            markedUnread: row?.markedUnread ?? false,
        },
    }, 200);
}

export async function updateChannelReadState(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") || undefined;
    const channelId = c.req.param("channelId") ?? "";
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found or access denied" }, 404);

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    const record = typeof body === "object" && body !== null && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {};
    const messageId = record.messageId === undefined || record.messageId === null ? null : record.messageId;
    if (messageId !== null && (typeof messageId !== "string" || messageId.length > 128)) {
        return c.json({ error: "messageId must be a message ID" }, 400);
    }
    if (record.markedUnread !== undefined && typeof record.markedUnread !== "boolean") {
        return c.json({ error: "markedUnread must be a boolean" }, 400);
    }
    if (messageId === null && record.markedUnread === undefined) {
        return c.json({ error: "messageId or markedUnread is required" }, 400);
    }

    let lastReadMessageId: string | null = null;
    let lastReadAt = new Date();
    if (messageId) {
        const [message] = await db.select({ id: channelMessage.id, createdAt: channelMessage.createdAt })
            .from(channelMessage)
            .where(and(eq(channelMessage.id, messageId), eq(channelMessage.channelId, channelId)))
            .limit(1);
        if (!message) return c.json({ error: "Message not found in this channel" }, 404);
        lastReadMessageId = message.id;
        lastReadAt = message.createdAt;
    }
    const markedUnread = record.markedUnread === true;

    const [row] = await db.insert(channelReadState).values({
        channelId,
        userId,
        lastReadMessageId,
        lastReadAt,
        markedUnread,
    }).onConflictDoUpdate({
        target: [channelReadState.channelId, channelReadState.userId],
        set: {
            ...(messageId ? { lastReadMessageId, lastReadAt } : {}),
            markedUnread,
        },
    }).returning();

    if (messageId) await markChannelNotificationsRead(userId, channelId, lastReadAt);

    const event: ReadStateEvent = {
        type: "read_state",
        scope: "channel",
        userId,
        lastReadMessageId: row?.lastReadMessageId ?? null,
        lastReadAt: (row?.lastReadAt ?? lastReadAt).toISOString(),
        markedUnread: row?.markedUnread ?? false,
        serverId: access.serverId,
        channelId,
    };
    try {
        const members = (await getServerMemberIds(access.serverId)).filter(id => id !== userId);
        if (members.length > 0) await publishUserEvent(members, event);
    } catch (error) {
        console.error("Unable to publish read state:", error);
    }
    return c.json({
        readState: {
            channelId,
            lastReadMessageId: row?.lastReadMessageId ?? null,
            lastReadAt: (row?.lastReadAt ?? lastReadAt).toISOString(),
            markedUnread: row?.markedUnread ?? false,
        },
    }, 200);
}

/** Unread counters per channel for a server plus muted/favorite flags. */
export async function getServerUnreadCounts(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const [membership] = await db.select({ userId: serverMember.userId }).from(serverMember)
        .where(and(eq(serverMember.serverId, serverId), eq(serverMember.userId, userId)))
        .limit(1);
    if (!membership) return c.json({ error: "Server not found or access denied" }, 404);

    const rows = await db.select({
        channelId: channelMessage.channelId,
        unreadCount: sql<number>`count(*)::int`,
        lastMessageAt: sql<Date | null>`max(${channelMessage.createdAt})`,
    }).from(channelMessage)
        .innerJoin(serverChannel, eq(serverChannel.id, channelMessage.channelId))
        .leftJoin(channelReadState, and(
            eq(channelReadState.channelId, channelMessage.channelId),
            eq(channelReadState.userId, userId),
        ))
        .where(and(
            eq(serverChannel.serverId, serverId),
            ne(channelMessage.senderId, userId),
            isNull(channelMessage.deletedAt),
            or(isNull(channelReadState.lastReadAt), gt(channelMessage.createdAt, channelReadState.lastReadAt)),
        ))
        .groupBy(channelMessage.channelId);
    const channelIds = rows.map(row => row.channelId);
    const preferences = channelIds.length > 0
        ? await db.select().from(conversationPreference).where(and(
            eq(conversationPreference.userId, userId),
            eq(conversationPreference.scope, "channel"),
            inArray(conversationPreference.targetId, channelIds),
        ))
        : [];
    const preferenceMap = new Map(preferences.map(row => [row.targetId, row]));
    return c.json({
        channels: rows.map(row => ({
            channelId: row.channelId,
            unreadCount: row.unreadCount,
            lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null,
            favorite: preferenceMap.get(row.channelId)?.favorite ?? false,
            archived: preferenceMap.get(row.channelId)?.archived ?? false,
            notificationLevel: preferenceMap.get(row.channelId)?.notificationLevel ?? "all",
        })),
    }, 200);
}
