import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import type { Context } from "hono";
import { db, type DbTransaction } from "../db/index";
import { attachment } from "../db/schema/attachment";
import { directMessage } from "../db/schema/direct-message";
import { getChannelAccess } from "../lib/channel-access";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { getSessionUserId } from "../lib/request-auth";
import { emitDirectMessage } from "./direct-message.controller";
import { attachmentPolicies, matchesDeclaredMimeType } from "../models/attachment-policy";
import {
    createAttachmentDownloadUrl,
    createAttachmentPreviewUrl,
    createAttachmentUploadForm,
    deleteObject,
    copyUploadedObject,
    inspectObject,
    isMissingObject,
    readObjectPrefix,
} from "../services/object-storage.service";

type TargetType = "direct" | "channel";

export async function createAttachmentUpload(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const body = await readJson(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const targetType = body.targetType;
    const targetId = typeof body.targetId === "string" ? body.targetId : "";
    const fileName = sanitizeFileName(body.fileName);
    const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
    const sizeBytes = body.sizeBytes;
    if ((targetType !== "direct" && targetType !== "channel") || !targetId || targetId.length > 128) {
        return c.json({ error: "targetType must be direct or channel, with a targetId" }, 400);
    }
    if (!fileName) return c.json({ error: "A valid fileName is required" }, 400);
    const policy = attachmentPolicies.get(mimeType);
    if (!policy) return c.json({ error: "This file type is not allowed" }, 415);
    if (!Number.isInteger(sizeBytes) || (sizeBytes as number) < 1 || (sizeBytes as number) > policy.maxBytes) {
        return c.json({ error: `File size must be between 1 byte and ${policy.maxBytes} bytes for this type` }, 413);
    }

    const authorized = await canAccessTarget(userId, targetType, targetId);
    if (!authorized) return c.json({ error: "You do not have access to this conversation" }, 403);

    const id = randomUUID();
    const storageKey = `objects/${randomUUID()}`;
    const uploadKey = `staging/${randomUUID()}`;
    const uploadExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await db.insert(attachment).values({
        id,
        uploaderId: userId,
        targetType,
        targetId,
        storageKey,
        uploadKey,
        fileName,
        mimeType,
        sizeBytes: sizeBytes as number,
        uploadExpiresAt,
    });

    try {
        const upload = await createAttachmentUploadForm(uploadKey, mimeType, policy.maxBytes);
        return c.json({
            attachment: { id, targetType, targetId, fileName, mimeType, sizeBytes },
            upload: { method: "POST", url: upload.url, fields: upload.fields, expiresAt: uploadExpiresAt },
        }, 201);
    } catch (error) {
        await db.delete(attachment).where(eq(attachment.id, id));
        console.error("Unable to sign attachment upload:", error);
        return c.json({ error: "Object storage is unavailable" }, 503);
    }
}

export async function completeAttachmentUpload(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const attachmentId = c.req.param("attachmentId") ?? "";
    let stagingKey: string | undefined;
    const response = await db.transaction(async tx => {
        // Serialize finalization and deletion of this attachment across server instances.
        const [item] = await tx.select().from(attachment)
            .where(and(eq(attachment.id, attachmentId), eq(attachment.uploaderId, userId)))
            .for("update");
        if (!item) return c.json({ error: "Attachment not found" }, 404);
        if (item.status === "ready") return c.json({ attachment: toPublicAttachment(c, item) }, 200);

        try {
            if (item.uploadExpiresAt.getTime() <= Date.now()) {
                await discardUpload(tx, item);
                return c.json({ error: "Upload authorization expired" }, 410);
            }

            let object;
            try {
                object = await inspectObject(item.uploadKey);
            } catch (error) {
                if (isMissingObject(error)) return c.json({ error: "Uploaded object was not found" }, 409);
                return c.json({ error: "Object storage is unavailable" }, 503);
            }
            if (object.ContentLength !== item.sizeBytes || object.ContentType?.toLowerCase() !== item.mimeType) {
                await discardUpload(tx, item);
                return c.json({ error: "Uploaded file does not match its declared size or content type" }, 400);
            }

            await copyUploadedObject(item.uploadKey, item.storageKey, item.mimeType, item.fileName);
            const prefix = await readObjectPrefix(item.storageKey, 4096);
            if (!prefix || !matchesDeclaredMimeType(item.mimeType, prefix)) {
                await discardUpload(tx, item);
                return c.json({ error: "Uploaded file content does not match its declared type" }, 400);
            }
        } catch (error) {
            console.error("Unable to finalize attachment upload:", error);
            return c.json({ error: "Unable to finalize upload" }, 502);
        }

        const [ready] = await tx.update(attachment)
            .set({ status: "ready", uploadedAt: new Date() })
            .where(eq(attachment.id, item.id))
            .returning();
        stagingKey = item.uploadKey;
        return c.json({ attachment: toPublicAttachment(c, ready) }, 200);
    });

    // Keep the original bytes available for retry until the database commit succeeds.
    if (stagingKey) {
        await deleteObject(stagingKey).catch(error => console.error("Unable to remove staged attachment:", error));
    }
    return response;
}

async function discardUpload(tx: DbTransaction, item: typeof attachment.$inferSelect) {
    await deleteObject(item.storageKey);
    await deleteObject(item.uploadKey);
    await tx.delete(attachment).where(eq(attachment.id, item.id));
}

export async function listConversationAttachments(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const targetType = c.req.query("targetType");
    const targetId = c.req.query("targetId") ?? "";
    if ((targetType !== "direct" && targetType !== "channel") || !targetId) {
        return c.json({ error: "targetType and targetId are required" }, 400);
    }
    if (!await canAccessTarget(userId, targetType, targetId)) {
        return c.json({ error: "You do not have access to this conversation" }, 403);
    }

    const scope = targetType === "direct"
        ? or(
            and(eq(attachment.uploaderId, userId), eq(attachment.targetId, targetId)),
            and(eq(attachment.uploaderId, targetId), eq(attachment.targetId, userId)),
        )
        : eq(attachment.targetId, targetId);
    const items = await db.select().from(attachment)
        .where(and(eq(attachment.targetType, targetType), eq(attachment.status, "ready"), scope))
        .orderBy(attachment.createdAt)
        .limit(100);
    return c.json({ attachments: items.map(item => toPublicAttachment(c, item)) }, 200);
}

export async function getAttachmentDownloadUrl(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const attachmentId = c.req.param("attachmentId") ?? "";
    const [item] = await db.select().from(attachment)
        .where(and(eq(attachment.id, attachmentId), eq(attachment.status, "ready")))
        .limit(1);
    if (!item) return c.json({ error: "Attachment not found" }, 404);
    let accessTargetId = item.targetId;
    if (item.targetType === "direct") {
        if (userId !== item.uploaderId && userId !== item.targetId) {
            return c.json({ error: "Attachment not found" }, 404);
        }
        if (userId === item.targetId) accessTargetId = item.uploaderId;
    }
    if (!await canAccessTarget(userId, item.targetType as TargetType, accessTargetId)) {
        return c.json({ error: "Attachment not found" }, 404);
    }

    try {
        const url = await createAttachmentDownloadUrl(item.storageKey, item.mimeType, item.fileName);
        return c.json({ url, expiresInSeconds: 300 }, 200);
    } catch (error) {
        console.error("Unable to sign attachment download:", error);
        return c.json({ error: "Object storage is unavailable" }, 503);
    }
}

export async function getAttachmentPreview(c: Context) {
    const attachmentId = c.req.param("attachmentId") ?? "";
    const [item] = await db.select({
        storageKey: attachment.storageKey,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
    }).from(attachment)
        .where(and(eq(attachment.id, attachmentId), eq(attachment.status, "ready")))
        .limit(1);
    if (!item) return c.json({ error: "Attachment not found" }, 404);

    try {
        const url = await createAttachmentPreviewUrl(item.storageKey, item.mimeType, item.fileName);
        c.header("Cache-Control", "private, no-store");
        c.header("Cross-Origin-Resource-Policy", "cross-origin");
        c.header("X-Robots-Tag", "noindex, nofollow");
        return c.redirect(url, 302);
    } catch (error) {
        console.error("Unable to sign attachment preview:", error);
        return c.json({ error: "Object storage is unavailable" }, 503);
    }
}

export async function deleteAttachment(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const attachmentId = c.req.param("attachmentId") ?? "";
    const updatedMessages: (typeof directMessage.$inferSelect)[] = [];
    const response = await db.transaction(async tx => {
        const [item] = await tx.select().from(attachment)
            .where(and(eq(attachment.id, attachmentId), eq(attachment.uploaderId, userId)))
            .for("update");
        if (!item) return c.json({ error: "Attachment not found" }, 404);

        try {
            await Promise.all([deleteObject(item.storageKey), deleteObject(item.uploadKey)]);
        } catch (error) {
            console.error("Unable to remove attachment object:", error);
            return c.json({ error: "Unable to remove attachment object" }, 502);
        }
        const linkedMessages = await tx.select().from(directMessage).where(eq(directMessage.attachmentId, item.id));
        for (const message of linkedMessages) {
            const now = new Date();
            const [updated] = await tx.update(directMessage).set({
                attachmentId: null,
                ...(message.text ? {} : { deletedAt: now }),
                updatedAt: now,
            }).where(eq(directMessage.id, message.id)).returning();
            if (updated) updatedMessages.push(updated);
        }
        await tx.delete(attachment).where(eq(attachment.id, item.id));
        return c.body(null, 204);
    });
    for (const message of updatedMessages) {
        await emitDirectMessage(message.text ? "updated" : "deleted", toDirectMessageRecord(message));
    }
    return response;
}

function toDirectMessageRecord(row: typeof import("../db/schema/direct-message").directMessage.$inferSelect) {
    return {
        id: row.id,
        senderId: row.senderId,
        recipientId: row.recipientId,
        text: row.text,
        attachmentId: row.attachmentId,
        replyToMessageId: row.replyToMessageId,
        status: row.status as "sent" | "delivered" | "read",
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        readAt: row.readAt?.toISOString() ?? null,
        editedAt: row.editedAt?.toISOString() ?? null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        forwardedFromId: row.forwardedFromId,
        location: row.locationLat !== null && row.locationLng !== null
            ? { lat: row.locationLat, lng: row.locationLng, label: row.locationLabel }
            : null,
        attachmentDurationMs: row.attachmentDurationMs,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        encrypted: row.encrypted,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        reactions: [],
        mentions: [],
        poll: null,
        pinned: false,
    };
}

async function canAccessTarget(userId: string, targetType: TargetType, targetId: string) {
    if (targetType === "direct") return canAccessDirectConversation(userId, targetId);
    const access = await getChannelAccess(userId, targetId);
    return access?.kind === "text";
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

function sanitizeFileName(value: unknown) {
    if (typeof value !== "string") return null;
    const name = value.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
    if (!name || name === "." || name === ".." || name.length > 180) return null;
    return name;
}

function toPublicAttachment(c: Context, item: typeof attachment.$inferSelect) {
    return {
        id: item.id,
        uploaderId: item.uploaderId,
        targetType: item.targetType,
        targetId: item.targetId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        uploadedAt: item.uploadedAt,
        createdAt: item.createdAt,
        previewUrl: new URL(`/api/attachments/${encodeURIComponent(item.id)}/preview`, c.req.url).toString(),
    };
}
