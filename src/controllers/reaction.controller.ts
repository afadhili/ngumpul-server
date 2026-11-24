import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { channelMessage } from "../db/schema/channel-message";
import { directMessage } from "../db/schema/direct-message";
import { channelMessageReaction, directMessageReaction } from "../db/schema/reaction";
import { getChannelAccess } from "../lib/channel-access";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { getSessionUserId } from "../lib/request-auth";
import type { MessageReaction } from "../models/chat-message";
import type { MessageReactionEvent, ReactionSummary } from "../models/realtime-event";
import { publishUserEvent } from "../services/event.service";
import { sendNotification } from "../services/notification.service";
import { channelReactions, directReactions, publicReactionSummary } from "../services/reaction.service";
import { getServerMemberIds } from "../services/server-event.service";

type MessageRow = {
    id: string;
    senderId: string;
    recipientId?: string;
    channelId?: string;
    deletedAt: Date | null;
};

export async function addDirectMessageReaction(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const target = await directTarget(userId, c.req.param("messageId") ?? "");
    if ("error" in target) return c.json({ error: target.error }, target.status);
    const body = await readJson(c);
    const emoji = parseEmoji(body?.emoji);
    if (!emoji) return c.json({ error: "emoji must be a short emoji string" }, 400);

    const [existing] = await db.select({ id: directMessageReaction.id }).from(directMessageReaction)
        .where(and(
            eq(directMessageReaction.messageId, target.message.id),
            eq(directMessageReaction.userId, userId),
            eq(directMessageReaction.emoji, emoji),
        )).limit(1);
    if (!existing) {
        const inserted = await db.insert(directMessageReaction).values({
            id: randomUUID(),
            messageId: target.message.id,
            userId,
            emoji,
        }).onConflictDoNothing().returning({ id: directMessageReaction.id });
        if (inserted.length > 0) await emitDirectReaction("added", target.message, userId, emoji);
    }
    return c.json({ messageId: target.message.id, reactions: await directReactions(target.message.id, userId) });
}

export async function removeDirectMessageReaction(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const target = await directTarget(userId, c.req.param("messageId") ?? "");
    if ("error" in target) return c.json({ error: target.error }, target.status);
    const emoji = parseEmoji(c.req.param("emoji"));
    if (!emoji) return c.json({ error: "emoji must be a short emoji string" }, 400);

    const removed = await db.delete(directMessageReaction).where(and(
        eq(directMessageReaction.messageId, target.message.id),
        eq(directMessageReaction.userId, userId),
        eq(directMessageReaction.emoji, emoji),
    )).returning({ id: directMessageReaction.id });
    if (removed.length > 0) {
        await emitDirectReaction("removed", target.message, userId, emoji);
    }
    return c.json({ messageId: target.message.id, reactions: await directReactions(target.message.id, userId) });
}

export async function addChannelMessageReaction(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const target = await channelTarget(userId, c.req.param("serverId") ?? "", c.req.param("channelId") ?? "", c.req.param("messageId") ?? "");
    if ("error" in target) return c.json({ error: target.error }, target.status);
    const body = await readJson(c);
    const emoji = parseEmoji(body?.emoji);
    if (!emoji) return c.json({ error: "emoji must be a short emoji string" }, 400);

    const [existing] = await db.select({ id: channelMessageReaction.id }).from(channelMessageReaction)
        .where(and(
            eq(channelMessageReaction.messageId, target.message.id),
            eq(channelMessageReaction.userId, userId),
            eq(channelMessageReaction.emoji, emoji),
        )).limit(1);
    if (!existing) {
        const inserted = await db.insert(channelMessageReaction).values({
            id: randomUUID(),
            messageId: target.message.id,
            userId,
            emoji,
        }).onConflictDoNothing().returning({ id: channelMessageReaction.id });
        if (inserted.length > 0) await emitChannelReaction("added", target.serverId, target.message, userId, emoji);
    }
    return c.json({ messageId: target.message.id, reactions: await channelReactions(target.message.id, userId) });
}

export async function removeChannelMessageReaction(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const target = await channelTarget(userId, c.req.param("serverId") ?? "", c.req.param("channelId") ?? "", c.req.param("messageId") ?? "");
    if ("error" in target) return c.json({ error: target.error }, target.status);
    const emoji = parseEmoji(c.req.param("emoji"));
    if (!emoji) return c.json({ error: "emoji must be a short emoji string" }, 400);

    const removed = await db.delete(channelMessageReaction).where(and(
        eq(channelMessageReaction.messageId, target.message.id),
        eq(channelMessageReaction.userId, userId),
        eq(channelMessageReaction.emoji, emoji),
    )).returning({ id: channelMessageReaction.id });
    if (removed.length > 0) {
        await emitChannelReaction("removed", target.serverId, target.message, userId, emoji);
    }
    return c.json({ messageId: target.message.id, reactions: await channelReactions(target.message.id, userId) });
}

async function directTarget(userId: string, messageId: string) {
    if (!messageId) return { error: "Message not found", status: 404 } as const;
    const [message] = await db.select().from(directMessage).where(and(
        eq(directMessage.id, messageId),
        isNull(directMessage.deletedAt),
    )).limit(1);
    if (!message) return { error: "Message not found", status: 404 } as const;
    if (message.senderId !== userId && message.recipientId !== userId) {
        return { error: "Message not found", status: 404 } as const;
    }
    const peerId = message.senderId === userId ? message.recipientId : message.senderId;
    if (!await canAccessDirectConversation(userId, peerId)) {
        return { error: "You do not have access to this conversation", status: 403 } as const;
    }
    return { message: message as MessageRow, peerId } as const;
}

async function channelTarget(userId: string, serverId: string, channelId: string, messageId: string) {
    if (!messageId) return { error: "Message not found", status: 404 } as const;
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return { error: "Channel not found or access denied", status: 404 } as const;
    const [message] = await db.select().from(channelMessage).where(and(
        eq(channelMessage.id, messageId),
        eq(channelMessage.channelId, channelId),
        isNull(channelMessage.deletedAt),
    )).limit(1);
    if (!message) return { error: "Message not found", status: 404 } as const;
    return { message: message as MessageRow, serverId } as const;
}

async function emitDirectReaction(
    event: "added" | "removed",
    message: MessageRow,
    userId: string,
    emoji: string,
) {
    const reactions = await directReactions(message.id, userId);
    const payload: MessageReactionEvent = {
        type: "message_reaction",
        event,
        scope: "direct",
        messageId: message.id,
        userId,
        emoji,
        reactions: publicReactionSummary(reactions) as ReactionSummary[],
        senderId: message.senderId,
        recipientId: message.recipientId!,
        createdAt: new Date().toISOString(),
    };
    await publishUserEvent([message.senderId, message.recipientId!], payload);
    if (event === "added" && message.senderId !== userId) {
        await sendNotification({
            recipients: [message.senderId],
            kind: "reaction",
            title: "Reaksi baru",
            body: `${emoji} pada pesanmu`,
            messageId: message.id,
            actorId: userId,
        });
    }
}

async function emitChannelReaction(
    event: "added" | "removed",
    serverId: string,
    message: MessageRow,
    userId: string,
    emoji: string,
) {
    const reactions = await channelReactions(message.id, userId);
    const payload: MessageReactionEvent = {
        type: "message_reaction",
        event,
        scope: "channel",
        messageId: message.id,
        userId,
        emoji,
        reactions: publicReactionSummary(reactions) as ReactionSummary[],
        serverId,
        channelId: message.channelId!,
        createdAt: new Date().toISOString(),
    };
    await publishUserEvent(await getServerMemberIds(serverId), payload);
    if (event === "added" && message.senderId !== userId) {
        await sendNotification({
            recipients: [message.senderId],
            kind: "reaction",
            title: "Reaksi baru",
            body: `${emoji} pada pesanmu`,
            serverId,
            channelId: message.channelId,
            messageId: message.id,
            actorId: userId,
        });
    }
}

function parseEmoji(value: unknown) {
    if (typeof value !== "string") return null;
    const emoji = value.trim();
    if (!emoji || emoji.length > 32 || /[\u0000-\u001f\u007f]/.test(emoji)) return null;
    return emoji;
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
    try {
        const value: unknown = await c.req.json();
        return typeof value === "object" && value !== null && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}
