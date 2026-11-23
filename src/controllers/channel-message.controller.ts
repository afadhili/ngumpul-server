import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { attachment } from "../db/schema/attachment";
import { channelMessage, channelMessageHidden } from "../db/schema/channel-message";
import { getChannelAccess, isServerManager } from "../lib/channel-access";
import { isUniqueViolation } from "../lib/db-errors";
import { getSessionUserId } from "../lib/request-auth";
import type { ChannelMessageRecord } from "../models/chat-message";
import { deleteObject } from "../services/object-storage.service";
import { publishChatMessage } from "../services/realtime.service";

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
        const [cursor] = await db.select({ id: channelMessage.id, createdAt: channelMessage.createdAt })
            .from(channelMessage)
            .where(and(eq(channelMessage.id, beforeId), eq(channelMessage.channelId, channelId)))
            .limit(1);
        if (!cursor) return c.json({ error: "Message cursor not found in this channel" }, 400);
        cursorCondition = or(
            lt(channelMessage.createdAt, cursor.createdAt),
            and(eq(sql`date_trunc('milliseconds', ${channelMessage.createdAt})`, cursor.createdAt), lt(channelMessage.id, cursor.id)),
        );
    }

    const rows = await db.select().from(channelMessage).where(and(
        eq(channelMessage.channelId, channelId),
        notExists(db.select({ id: channelMessageHidden.messageId }).from(channelMessageHidden)
            .where(and(eq(channelMessageHidden.messageId, channelMessage.id), eq(channelMessageHidden.userId, userId)))),
        ...(cursorCondition ? [cursorCondition] : []),
    )).orderBy(desc(sql`date_trunc('milliseconds', ${channelMessage.createdAt})`), desc(channelMessage.id)).limit(rawLimit);

    const replyIds = [...new Set(rows.map(row => row.replyToMessageId).filter((id): id is string => Boolean(id)))];
    const replyRows = replyIds.length
        ? await db.select().from(channelMessage).where(and(
            inArray(channelMessage.id, replyIds),
            eq(channelMessage.channelId, channelId),
        ))
        : [];
    const replyById = new Map(replyRows.map(row => [row.id, toPublicMessage(row)]));
    const nextCursor = rows.length === rawLimit ? rows[rows.length - 1]?.id ?? null : null;
    const messages = rows.reverse().map(row => ({
        ...toPublicMessage(row),
        replyTo: row.replyToMessageId ? replyById.get(row.replyToMessageId) ?? null : null,
    }));
    return c.json({ messages, nextCursor });
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
    const text = typeof body.text === "string" ? body.text.trim() || null : null;
    if (body.text !== undefined && body.text !== null && typeof body.text !== "string") {
        return c.json({ error: "text must be a string" }, 400);
    }
    if (text && text.length > 4000) return c.json({ error: "text must contain at most 4000 characters" }, 400);

    const attachmentId = body.attachmentId === undefined || body.attachmentId === null
        ? null
        : typeof body.attachmentId === "string" ? body.attachmentId : "";
    if (attachmentId === "") return c.json({ error: "attachmentId must be an attachment ID" }, 400);
    if (!text && !attachmentId) return c.json({ error: "A text message or attachment is required" }, 400);
    if (attachmentId) {
        const [item] = await db.select({ id: attachment.id }).from(attachment).where(and(
            eq(attachment.id, attachmentId),
            eq(attachment.uploaderId, userId),
            eq(attachment.targetType, "channel"),
            eq(attachment.targetId, channelId),
            eq(attachment.status, "ready"),
        )).limit(1);
        if (!item) return c.json({ error: "Ready attachment not found for this channel" }, 404);
    }

    const replyToId = body.replyToMessageId === undefined || body.replyToMessageId === null
        ? null
        : typeof body.replyToMessageId === "string" ? body.replyToMessageId : "";
    if (replyToId === "") return c.json({ error: "replyToMessageId must be a message ID" }, 400);
    let replyTo = null;
    if (replyToId) {
        const [parent] = await db.select().from(channelMessage).where(and(
            eq(channelMessage.id, replyToId),
            eq(channelMessage.channelId, channelId),
        )).limit(1);
        if (!parent) return c.json({ error: "Reply target not found in this channel" }, 404);
        replyTo = toPublicMessage(parent);
    }

    let row: typeof channelMessage.$inferSelect;
    try {
        [row] = await db.insert(channelMessage).values({
            id: randomUUID(),
            channelId,
            senderId: userId,
            text,
            attachmentId,
            replyToMessageId: replyToId,
        }).returning();
    } catch (error) {
        if (isUniqueViolation(error)) {
            return c.json({ error: "Attachment is already attached to a message" }, 409);
        }
        throw error;
    }
    const message = toPublicMessage(row);
    await emitChannelMessage("created", access.serverId, message);
    return c.json({ message: { ...message, replyTo } }, 201);
}

export async function editChannelMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const messageId = c.req.param("messageId") ?? "";
    const access = await getChannelAccess(userId, channelId, serverId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found or access denied" }, 404);

    const [current] = await db.select().from(channelMessage).where(and(
        eq(channelMessage.id, messageId),
        eq(channelMessage.channelId, channelId),
        eq(channelMessage.senderId, userId),
        isNull(channelMessage.deletedAt),
    )).limit(1);
    if (!current) return c.json({ error: "Message not found" }, 404);

    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 4000) return c.json({ error: "text must contain between 1 and 4000 characters" }, 400);

    const now = new Date();
    const [updated] = await db.update(channelMessage).set({ text, editedAt: now, updatedAt: now })
        .where(and(eq(channelMessage.id, messageId), eq(channelMessage.senderId, userId), isNull(channelMessage.deletedAt)))
        .returning();
    if (!updated) return c.json({ error: "Message not found" }, 404);
    const message = toPublicMessage(updated);
    await emitChannelMessage("updated", access.serverId, message);
    return c.json({ message });
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

    const [current] = await db.select().from(channelMessage)
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
        const [file] = await db.select({ storageKey: attachment.storageKey, uploadKey: attachment.uploadKey })
            .from(attachment).where(eq(attachment.id, current.attachmentId)).limit(1);
        if (file) {
            try {
                await Promise.all([deleteObject(file.storageKey), deleteObject(file.uploadKey)]);
            } catch (error) {
                console.error("Unable to delete channel message attachment:", error);
                return c.json({ error: "Unable to delete message attachment" }, 502);
            }
        }
    }

    const [deleted] = await db.update(channelMessage).set({
        text: null,
        attachmentId: null,
        deletedAt: now,
        updatedAt: now,
    }).where(and(eq(channelMessage.id, messageId), isNull(channelMessage.deletedAt))).returning();
    if (deleted) {
        if (current.attachmentId) await db.delete(attachment).where(eq(attachment.id, current.attachmentId));
        await emitChannelMessage("deleted", access.serverId, toPublicMessage(deleted));
    }
    return c.body(null, 204);
}

function toPublicMessage(row: typeof channelMessage.$inferSelect): ChannelMessageRecord {
    return {
        id: row.id,
        channelId: row.channelId,
        senderId: row.senderId,
        text: row.text,
        attachmentId: row.attachmentId,
        replyToMessageId: row.replyToMessageId,
        editedAt: row.editedAt?.toISOString() ?? null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
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
