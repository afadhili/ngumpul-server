import { and, desc, eq, gt, inArray, isNull, lt, notExists, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { attachment } from "../db/schema/attachment";
import { channelMessage, channelMessageHidden } from "../db/schema/channel-message";
import { channelMessageReaction } from "../db/schema/reaction";
import { getChannelAccess, isServerManager } from "../lib/channel-access";
import { parseMessageInput } from "../lib/message-input";
import { getSessionUserId } from "../lib/request-auth";
import type { ChannelMessageRecord } from "../models/chat-message";
import { createChannelMessage, toChannelRecord } from "../services/message-create.service";
import { loadChannelMessageMeta, metaFor, type MessageMeta } from "../services/message-meta.service";
import { deleteMessageSideData } from "../services/message-support.service";
import { deleteObject } from "../services/object-storage.service";
import { publishChatMessage } from "../services/realtime.service";

const noMeta: MessageMeta = { reactions: [], mentions: [], poll: null, pinned: false };

export async function listChannelMessages(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found or access denied" }, 404);

    const rawLimit = Number(c.req.query("limit") ?? 50);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
        return c.json({ error: "limit must be between 1 and 100" }, 400);
    }
    let cursorCondition;
    const beforeId = c.req.query("before");
    if (beforeId) {
        const [cursor] = await db
            .select({ id: channelMessage.id, createdAt: channelMessage.createdAt })
            .from(channelMessage)
            .where(and(eq(channelMessage.id, beforeId), eq(channelMessage.channelId, channelId)))
            .limit(1);
        if (!cursor) return c.json({ error: "Message cursor not found in this channel" }, 400);
        cursorCondition = or(
            lt(channelMessage.createdAt, cursor.createdAt),
            and(
                eq(sql`date_trunc('milliseconds', ${channelMessage.createdAt})`, cursor.createdAt),
                lt(channelMessage.id, cursor.id),
            ),
        );
    }

    const rows = await db
        .select()
        .from(channelMessage)
        .where(
            and(
                eq(channelMessage.channelId, channelId),
                notExists(
                    db
                        .select({ id: channelMessageHidden.messageId })
                        .from(channelMessageHidden)
                        .where(
                            and(
                                eq(channelMessageHidden.messageId, channelMessage.id),
                                eq(channelMessageHidden.userId, userId),
                            ),
                        ),
                ),
                or(isNull(channelMessage.expiresAt), gt(channelMessage.expiresAt, new Date())),
                ...(cursorCondition ? [cursorCondition] : []),
            ),
        )
        .orderBy(desc(sql`date_trunc('milliseconds', ${channelMessage.createdAt})`), desc(channelMessage.id))
        .limit(rawLimit);

    const replyIds = [...new Set(rows.map(row => row.replyToMessageId).filter((id): id is string => Boolean(id)))];
    const replyRows = replyIds.length
        ? await db
              .select()
              .from(channelMessage)
              .where(and(inArray(channelMessage.id, replyIds), eq(channelMessage.channelId, channelId)))
        : [];
    const metaMap = await loadChannelMessageMeta([...rows, ...replyRows], userId);
    const replyById = new Map(replyRows.map(row => [row.id, toPublicMessage(row, metaFor(metaMap, row.id))]));
    const nextCursor = rows.length === rawLimit ? (rows[rows.length - 1]?.id ?? null) : null;
    const messages = rows.reverse().map(row => ({
        ...toPublicMessage(row, metaFor(metaMap, row.id)),
        replyTo: row.replyToMessageId ? (replyById.get(row.replyToMessageId) ?? null) : null,
    }));
    return c.json({ messages, nextCursor }, 200);
}

export async function sendChannelMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found or access denied" }, 404);

    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const parsed = parseMessageInput(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, parsed.status);
    const result = await createChannelMessage(userId, access, parsed.value, {
        isAnnouncement: body.isAnnouncement === true,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ message: { ...result.message, replyTo: result.replyTo } }, 201);
}

export async function editChannelMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const messageId = c.req.param("messageId") ?? "";
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found or access denied" }, 404);

    const [current] = await db
        .select()
        .from(channelMessage)
        .where(
            and(
                eq(channelMessage.id, messageId),
                eq(channelMessage.channelId, channelId),
                eq(channelMessage.senderId, userId),
                isNull(channelMessage.deletedAt),
            ),
        )
        .limit(1);
    if (!current) return c.json({ error: "Message not found" }, 404);

    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 4000) return c.json({ error: "text must contain between 1 and 4000 characters" }, 400);

    const now = new Date();
    const [updated] = await db
        .update(channelMessage)
        .set({ text, editedAt: now, updatedAt: now })
        .where(
            and(
                eq(channelMessage.id, messageId),
                eq(channelMessage.senderId, userId),
                isNull(channelMessage.deletedAt),
            ),
        )
        .returning();
    if (!updated) return c.json({ error: "Message not found" }, 404);
    const message = toPublicMessage(updated, metaFor(await loadChannelMessageMeta([updated], userId), updated.id));
    await emitChannelMessage("updated", access.serverId, message);
    return c.json({ message }, 200);
}

export async function deleteChannelMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const messageId = c.req.param("messageId") ?? "";
    const scope = c.req.query("scope");
    if (scope !== "me" && scope !== "everyone") return c.json({ error: "scope must be me or everyone" }, 400);
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found or access denied" }, 404);

    const [current] = await db
        .select()
        .from(channelMessage)
        .where(and(eq(channelMessage.id, messageId), eq(channelMessage.channelId, channelId)))
        .limit(1);
    if (!current) return c.json({ error: "Message not found" }, 404);

    if (scope === "me") {
        await db.insert(channelMessageHidden).values({ messageId, userId }).onConflictDoNothing();
        return c.body(null, 204);
    }

    if (current.senderId !== userId && !isServerManager(access.role)) {
        return c.json({ error: "Only the sender or a server administrator can delete this message" }, 403);
    }

    const now = new Date();
    if (current.attachmentId) {
        const [file] = await db
            .select({ storageKey: attachment.storageKey, uploadKey: attachment.uploadKey })
            .from(attachment)
            .where(eq(attachment.id, current.attachmentId))
            .limit(1);
        if (file) {
            try {
                await Promise.all([deleteObject(file.storageKey), deleteObject(file.uploadKey)]);
            } catch (error) {
                console.error("Unable to delete channel message attachment:", error);
                return c.json({ error: "Unable to delete message attachment" }, 502);
            }
        }
    }

    const [deleted] = await db
        .update(channelMessage)
        .set({
            text: null,
            attachmentId: null,
            deletedAt: now,
            updatedAt: now,
        })
        .where(and(eq(channelMessage.id, messageId), isNull(channelMessage.deletedAt)))
        .returning();
    if (deleted) {
        await db.delete(channelMessageReaction).where(eq(channelMessageReaction.messageId, messageId));
        await deleteMessageSideData("channel", messageId);
        if (current.attachmentId) await db.delete(attachment).where(eq(attachment.id, current.attachmentId));
        await emitChannelMessage("deleted", access.serverId, toPublicMessage(deleted, { ...noMeta, reactions: [] }));
    }
    return c.body(null, 204);
}

export function toPublicMessage(row: typeof channelMessage.$inferSelect, meta: MessageMeta): ChannelMessageRecord {
    return toChannelRecord(row, meta);
}

export async function emitChannelMessage(
    event: "created" | "updated" | "deleted",
    serverId: string,
    message: ChannelMessageRecord,
) {
    try {
        await publishChatMessage({
            type: "channel_message",
            event,
            serverId,
            channelId: message.channelId,
            message,
        });
    } catch (error) {
        console.error("Unable to publish channel message event:", error);
    }
}

function summarizeNotificationBody(text: string | null) {
    if (!text) return "Mengirim lampiran";
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
    try {
        const value: unknown = await c.req.json();
        return typeof value === "object" && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}
