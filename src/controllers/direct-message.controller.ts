import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { attachment } from "../db/schema/attachment";
import { directMessage, directMessageHidden } from "../db/schema/direct-message";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { getSessionUserId } from "../lib/request-auth";
import type { DirectMessageRecord } from "../models/chat-message";
import { deleteObject } from "../services/object-storage.service";
import { publishChatMessage } from "../services/realtime.service";

export async function listDirectMessages(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const peerId = c.req.param("peerId") ?? "";
    if (!await canAccessDirectConversation(userId, peerId)) return c.json({ error: "You do not have access to this conversation" }, 403);

    const rawLimit = Number(c.req.query("limit") ?? 50);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) return c.json({ error: "limit must be between 1 and 100" }, 400);
    const conversation = or(
        and(eq(directMessage.senderId, userId), eq(directMessage.recipientId, peerId)),
        and(eq(directMessage.senderId, peerId), eq(directMessage.recipientId, userId)),
    );
    let cursorCondition;
    const beforeId = c.req.query("before");
    if (beforeId) {
        const [cursor] = await db.select({ id: directMessage.id, createdAt: directMessage.createdAt })
            .from(directMessage).where(and(eq(directMessage.id, beforeId), conversation)).limit(1);
        if (!cursor) return c.json({ error: "Message cursor not found in this conversation" }, 400);
        cursorCondition = or(
            lt(directMessage.createdAt, cursor.createdAt),
            and(eq(sql`date_trunc('milliseconds', ${directMessage.createdAt})`, cursor.createdAt), lt(directMessage.id, cursor.id)),
        );
    }

    const rows = await db.select().from(directMessage).where(and(
        conversation,
        notExists(db.select({ id: directMessageHidden.messageId }).from(directMessageHidden)
            .where(and(eq(directMessageHidden.messageId, directMessage.id), eq(directMessageHidden.userId, userId)))),
        ...(cursorCondition ? [cursorCondition] : []),
    )).orderBy(desc(sql`date_trunc('milliseconds', ${directMessage.createdAt})`), desc(directMessage.id)).limit(rawLimit);
    const replyIds = [...new Set(rows.map(row => row.replyToMessageId).filter((id): id is string => Boolean(id)))];
    const replyRows = replyIds.length
        ? await db.select().from(directMessage).where(inArray(directMessage.id, replyIds))
        : [];
    const replyById = new Map(replyRows.map(row => [row.id, toPublicMessage(row)]));
    const nextCursor = rows.length === rawLimit ? rows[rows.length - 1]?.id ?? null : null;
    const messages = rows.reverse().map(row => ({
        ...toPublicMessage(row),
        replyTo: row.replyToMessageId ? replyById.get(row.replyToMessageId) ?? null : null,
    }));
    return c.json({ messages, nextCursor });
}

export async function sendDirectMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const peerId = c.req.param("peerId") ?? "";
    if (!await canAccessDirectConversation(userId, peerId)) return c.json({ error: "You do not have access to this conversation" }, 403);
    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const text = typeof body.text === "string" ? body.text.trim() || null : null;
    if (body.text !== undefined && body.text !== null && typeof body.text !== "string") return c.json({ error: "text must be a string" }, 400);
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
            eq(attachment.targetType, "direct"),
            eq(attachment.targetId, peerId),
            eq(attachment.status, "ready"),
        )).limit(1);
        if (!item) return c.json({ error: "Ready attachment not found for this conversation" }, 404);
    }
    const replyToId = body.replyToMessageId === undefined || body.replyToMessageId === null
        ? null
        : typeof body.replyToMessageId === "string" ? body.replyToMessageId : "";
    if (replyToId === "") return c.json({ error: "replyToMessageId must be a message ID" }, 400);

    let replyTo = null;
    if (replyToId) {
        const [parent] = await db.select().from(directMessage).where(and(
            eq(directMessage.id, replyToId),
            or(
                and(eq(directMessage.senderId, userId), eq(directMessage.recipientId, peerId)),
                and(eq(directMessage.senderId, peerId), eq(directMessage.recipientId, userId)),
            ),
        )).limit(1);
        if (!parent) return c.json({ error: "Reply target not found in this conversation" }, 404);
        replyTo = toPublicMessage(parent);
    }

    const [row] = await db.insert(directMessage).values({
        id: randomUUID(), senderId: userId, recipientId: peerId, text, attachmentId, replyToMessageId: replyToId,
    }).returning();
    const message = toPublicMessage(row);
    await emitDirectMessage("created", message);
    return c.json({ message: { ...message, replyTo } }, 201);
}

export async function editDirectMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const messageId = c.req.param("messageId") ?? "";
    const [current] = await db.select().from(directMessage)
        .where(and(eq(directMessage.id, messageId), eq(directMessage.senderId, userId), isNull(directMessage.deletedAt))).limit(1);
    if (!current) return c.json({ error: "Message not found" }, 404);
    if (!await canAccessDirectConversation(userId, current.recipientId)) return c.json({ error: "You do not have access to this conversation" }, 403);
    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 4000) return c.json({ error: "text must contain between 1 and 4000 characters" }, 400);
    const now = new Date();
    const [updated] = await db.update(directMessage).set({ text, editedAt: now, updatedAt: now })
        .where(and(eq(directMessage.id, messageId), eq(directMessage.senderId, userId), isNull(directMessage.deletedAt))).returning();
    if (!updated) return c.json({ error: "Message not found" }, 404);
    const message = toPublicMessage(updated);
    await emitDirectMessage("updated", message);
    return c.json({ message });
}

export async function deleteDirectMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const messageId = c.req.param("messageId") ?? "";
    const scope = c.req.query("scope");
    if (scope !== "me" && scope !== "everyone") return c.json({ error: "scope must be me or everyone" }, 400);
    const [current] = await db.select().from(directMessage).where(and(
        eq(directMessage.id, messageId),
        or(eq(directMessage.senderId, userId), eq(directMessage.recipientId, userId)),
    )).limit(1);
    if (!current || !await canAccessDirectConversation(userId, current.senderId === userId ? current.recipientId : current.senderId)) {
        return c.json({ error: "Message not found" }, 404);
    }
    if (scope === "me") {
        await db.insert(directMessageHidden).values({ messageId, userId }).onConflictDoNothing();
        return c.body(null, 204);
    }
    if (current.senderId !== userId) return c.json({ error: "Only the sender can delete a message for everyone" }, 403);
    const now = new Date();
    if (current.attachmentId) {
        const [file] = await db.select({ storageKey: attachment.storageKey, uploadKey: attachment.uploadKey })
            .from(attachment).where(eq(attachment.id, current.attachmentId)).limit(1);
        if (file) {
            try {
                await Promise.all([deleteObject(file.storageKey), deleteObject(file.uploadKey)]);
            } catch (error) {
                console.error("Unable to delete message attachment:", error);
                return c.json({ error: "Unable to delete message attachment" }, 502);
            }
        }
    }
    const [deleted] = await db.update(directMessage).set({ text: null, attachmentId: null, deletedAt: now, updatedAt: now })
        .where(and(eq(directMessage.id, messageId), isNull(directMessage.deletedAt))).returning();
    if (deleted) {
        if (current.attachmentId) await db.delete(attachment).where(eq(attachment.id, current.attachmentId));
        await emitDirectMessage("deleted", toPublicMessage(deleted));
    }
    return c.body(null, 204);
}

export async function markDirectMessageReceipt(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const messageId = c.req.param("messageId") ?? "";
    const body = await readJson(c);
    if (!body || (body.status !== "delivered" && body.status !== "read")) {
        return c.json({ error: "status must be delivered or read" }, 400);
    }
    const [marker] = await db.select().from(directMessage).where(and(eq(directMessage.id, messageId), eq(directMessage.recipientId, userId))).limit(1);
    if (!marker) return c.json({ error: "Incoming message not found" }, 404);
    const peerId = marker.senderId;
    if (!await canAccessDirectConversation(userId, peerId)) return c.json({ error: "You do not have access to this conversation" }, 403);
    const now = new Date();
    const beforeMarker = or(
        lt(directMessage.createdAt, marker.createdAt),
        and(eq(sql`date_trunc('milliseconds', ${directMessage.createdAt})`, marker.createdAt), lte(directMessage.id, marker.id)),
    );
    const statusCondition = body.status === "read"
        ? sql`true`
        : eq(directMessage.status, "sent");
    const updated = await db.update(directMessage).set(body.status === "read"
        ? { status: "read", deliveredAt: sql`coalesce(${directMessage.deliveredAt}, ${now})`, readAt: sql`coalesce(${directMessage.readAt}, ${now})`, updatedAt: now }
        : { status: "delivered", deliveredAt: sql`coalesce(${directMessage.deliveredAt}, ${now})`, updatedAt: now })
        .where(and(eq(directMessage.senderId, peerId), eq(directMessage.recipientId, userId), beforeMarker, statusCondition))
        .returning();
    const markerUpdated = updated.find(message => message.id === marker.id);
    const record = markerUpdated ? toPublicMessage(markerUpdated) : toPublicMessage(marker);
    await emitDirectMessage("receipt", record);
    return c.json({ status: record.status, upToMessageId: marker.id, updatedCount: updated.length });
}

function toPublicMessage(row: typeof directMessage.$inferSelect): DirectMessageRecord {
    return {
        id: row.id,
        senderId: row.senderId,
        recipientId: row.recipientId,
        text: row.text,
        attachmentId: row.attachmentId,
        replyToMessageId: row.replyToMessageId,
        status: row.status as DirectMessageRecord["status"],
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        readAt: row.readAt?.toISOString() ?? null,
        editedAt: row.editedAt?.toISOString() ?? null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export async function emitDirectMessage(event: "created" | "updated" | "deleted" | "receipt", message: DirectMessageRecord) {
    try {
        await publishChatMessage({
            type: "direct_message", event,
            senderId: message.senderId,
            recipientId: message.recipientId,
            message,
        });
    } catch (error) {
        console.error("Unable to publish direct message event:", error);
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
