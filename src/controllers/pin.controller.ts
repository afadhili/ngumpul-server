import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { channelMessage } from "../db/schema/channel-message";
import { directMessage } from "../db/schema/direct-message";
import { messagePin } from "../db/schema/features";
import { getChannelAccess } from "../lib/channel-access";
import { directConversationKey } from "../lib/conversation-key";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { getSessionUserId } from "../lib/request-auth";
import type { PinEvent } from "../models/realtime-event";
import { publishUserEvent } from "../services/event.service";
import { loadChannelMessageMeta, loadDirectMessageMeta, metaFor } from "../services/message-meta.service";
import { getServerMemberIds } from "../services/server-event.service";
import { toPublicMessage as toPublicChannelMessage } from "./channel-message.controller";
import { toPublicMessage as toPublicDirectMessage } from "./direct-message.controller";

export async function listDirectPins(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const peerId = c.req.param("peerId") ?? "";
    if (!await canAccessDirectConversation(userId, peerId)) return c.json({ error: "You do not have access to this conversation" }, 403);
    const targetId = directConversationKey(userId, peerId);
    const pins = await db.select().from(messagePin).where(and(
        eq(messagePin.scope, "direct"),
        eq(messagePin.targetId, targetId),
    ));
    const ids = pins.map(pin => pin.messageId);
    if (ids.length === 0) return c.json({ messages: [] });
    const rows = await db.select().from(directMessage).where(and(
        inArray(directMessage.id, ids),
        isNull(directMessage.deletedAt),
    ));
    const meta = await loadDirectMessageMeta(rows, userId);
    const byId = new Map(rows.map(row => [row.id, toPublicDirectMessage(row, metaFor(meta, row.id))]));
    return c.json({
        messages: pins.map(pin => byId.get(pin.messageId)).filter(Boolean),
    });
}

export async function pinDirectMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const messageId = await resolveMessageId(c);
    if (!messageId) return c.json({ error: "messageId is required" }, 400);
    const [message] = await db.select().from(directMessage).where(and(
        eq(directMessage.id, messageId),
        isNull(directMessage.deletedAt),
    )).limit(1);
    if (!message) return c.json({ error: "Message not found" }, 404);
    const members = new Set([message.senderId, message.recipientId]);
    if (!members.has(userId)) return c.json({ error: "Message not found" }, 404);
    const peerId = message.senderId === userId ? message.recipientId : message.senderId;

    const targetId = directConversationKey(message.senderId, message.recipientId);
    const [pin] = await db.insert(messagePin).values({
        id: randomUUID(),
        scope: "direct",
        targetId,
        messageId,
        pinnedBy: userId,
    }).onConflictDoNothing().returning();

    const event: PinEvent = {
        type: "pin_event",
        event: "pinned",
        scope: "direct",
        messageId,
        actorId: userId,
        pinnedAt: (pin?.pinnedAt ?? new Date()).toISOString(),
        peerId,
    };
    await publishUserEvent([message.senderId, message.recipientId], event).catch(error => {
        console.error("Unable to publish pin event:", error);
    });
    return c.json({ pinned: true, messageId }, pin ? 201 : 200);
}

export async function unpinDirectMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const messageId = await resolveMessageId(c);
    if (!messageId) return c.json({ error: "messageId is required" }, 400);
    const [message] = await db.select().from(directMessage).where(eq(directMessage.id, messageId)).limit(1);
    if (!message) return c.json({ error: "Message not found" }, 404);
    if (message.senderId !== userId && message.recipientId !== userId) return c.json({ error: "Message not found" }, 404);
    const peerId = message.senderId === userId ? message.recipientId : message.senderId;
    const targetId = directConversationKey(message.senderId, message.recipientId);
    const deleted = await db.delete(messagePin).where(and(
        eq(messagePin.scope, "direct"),
        eq(messagePin.targetId, targetId),
        eq(messagePin.messageId, messageId),
    )).returning({ id: messagePin.id });
    const recipients = message ? [message.senderId, message.recipientId] : [userId, peerId];
    const event: PinEvent = {
        type: "pin_event",
        event: "unpinned",
        scope: "direct",
        messageId,
        actorId: userId,
        pinnedAt: null,
        peerId,
    };
    await publishUserEvent(recipients, event).catch(error => {
        console.error("Unable to publish pin event:", error);
    });
    return deleted.length > 0 ? c.body(null, 204) : c.json({ error: "Pin not found" }, 404);
}

export async function listChannelPins(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found or access denied" }, 404);
    const pins = await db.select().from(messagePin).where(and(
        eq(messagePin.scope, "channel"),
        eq(messagePin.targetId, channelId),
    ));
    const ids = pins.map(pin => pin.messageId);
    if (ids.length === 0) return c.json({ messages: [] });
    const rows = await db.select().from(channelMessage).where(and(
        inArray(channelMessage.id, ids),
        eq(channelMessage.channelId, channelId),
        isNull(channelMessage.deletedAt),
    ));
    const meta = await loadChannelMessageMeta(rows, userId);
    const byId = new Map(rows.map(row => [row.id, toPublicChannelMessage(row, metaFor(meta, row.id))]));
    return c.json({ messages: pins.map(pin => byId.get(pin.messageId)).filter(Boolean) });
}

export async function pinChannelMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found or access denied" }, 404);
    const messageId = await resolveMessageId(c);
    if (!messageId) return c.json({ error: "messageId is required" }, 400);
    const [message] = await db.select().from(channelMessage).where(and(
        eq(channelMessage.id, messageId),
        eq(channelMessage.channelId, channelId),
        isNull(channelMessage.deletedAt),
    )).limit(1);
    if (!message) return c.json({ error: "Message not found" }, 404);

    const [pin] = await db.insert(messagePin).values({
        id: randomUUID(),
        scope: "channel",
        targetId: channelId,
        messageId,
        pinnedBy: userId,
    }).onConflictDoNothing().returning();

    const event: PinEvent = {
        type: "pin_event",
        event: "pinned",
        scope: "channel",
        messageId,
        actorId: userId,
        pinnedAt: (pin?.pinnedAt ?? new Date()).toISOString(),
        serverId: access.serverId,
        channelId,
    };
    const members = (await getServerMemberIds(access.serverId)).filter(id => id !== userId);
    await publishUserEvent(members, event).catch(error => {
        console.error("Unable to publish pin event:", error);
    });
    return c.json({ pinned: true, messageId }, pin ? 201 : 200);
}

export async function unpinChannelMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const messageId = c.req.param("messageId") ?? "";
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found or access denied" }, 404);
    const deleted = await db.delete(messagePin).where(and(
        eq(messagePin.scope, "channel"),
        eq(messagePin.targetId, channelId),
        eq(messagePin.messageId, messageId),
    )).returning({ id: messagePin.id });
    if (deleted.length === 0) return c.json({ error: "Pin not found" }, 404);
    const event: PinEvent = {
        type: "pin_event",
        event: "unpinned",
        scope: "channel",
        messageId,
        actorId: userId,
        pinnedAt: null,
        serverId: access.serverId,
        channelId,
    };
    const members = (await getServerMemberIds(access.serverId)).filter(id => id !== userId);
    await publishUserEvent(members, event).catch(error => {
        console.error("Unable to publish pin event:", error);
    });
    return c.body(null, 204);
}

async function resolveMessageId(c: Context): Promise<string | null> {
    const fromParam = c.req.param("messageId");
    if (typeof fromParam === "string" && fromParam.length > 0 && fromParam.length <= 128) return fromParam;
    try {
        const body: unknown = await c.req.json();
        if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
        const value = (body as Record<string, unknown>).messageId;
        return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
    } catch {
        return null;
    }
}
