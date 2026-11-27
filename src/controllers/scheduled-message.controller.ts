import { randomUUID } from "node:crypto";
import { and, asc, eq, lte } from "drizzle-orm";
import type { Context } from "hono";
import { db, type DbTransaction } from "../db/index";
import { scheduledMessage } from "../db/schema/features";
import { getChannelAccess } from "../lib/channel-access";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { isConversationScope, resolveConversationTarget, type ConversationScope } from "../lib/conversation-access";
import { getSessionUserId } from "../lib/request-auth";
import type { ScheduledMessageEvent, ScheduledMessageSummary } from "../models/realtime-event";
import { publishUserEvent } from "../services/event.service";
import { storeChannelMessage, storeDirectMessage } from "../services/message-create.service";

const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

export function toScheduledSummary(row: typeof scheduledMessage.$inferSelect): ScheduledMessageSummary {
    return {
        id: row.id,
        scope: row.scope as ConversationScope,
        targetId: row.targetId,
        text: row.text,
        replyToMessageId: row.replyToMessageId,
        attachmentId: row.attachmentId,
        scheduledFor: row.scheduledFor.toISOString(),
        status: row.status as ScheduledMessageSummary["status"],
        sentMessageId: row.sentMessageId,
        failureReason: row.failureReason,
        createdAt: row.createdAt.toISOString(),
    };
}

function publishScheduled(userId: string, event: ScheduledMessageEvent["event"], row: typeof scheduledMessage.$inferSelect) {
    const payload: ScheduledMessageEvent = {
        type: "scheduled_message",
        event,
        scheduled: toScheduledSummary(row),
    };
    return publishUserEvent([userId], payload).catch(error => {
        console.error("Unable to publish scheduled message event:", error);
    });
}

async function readBody(c: Context): Promise<Record<string, unknown> | null> {
    try {
        const value: unknown = await c.req.json();
        return typeof value === "object" && value !== null && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

export async function createScheduledMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const body = await readBody(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);
    const scope = body.scope;
    if (!isConversationScope(scope)) return c.json({ error: "scope must be direct or channel" }, 400);
    if (typeof body.targetId !== "string" || body.targetId.length === 0 || body.targetId.length > 160) {
        return c.json({ error: "targetId is required" }, 400);
    }
    const targetId = await resolveConversationTarget(userId, scope, body.targetId);
    if (!targetId) return c.json({ error: "You do not have access to this conversation" }, 403);
    const text = typeof body.text === "string" ? body.text.trim() : null;
    if (text !== null && text.length > 4000) return c.json({ error: "text must not exceed 4000 characters" }, 400);
    const attachmentId = typeof body.attachmentId === "string" && body.attachmentId.length <= 128 ? body.attachmentId : null;
    if (!text && !attachmentId) return c.json({ error: "text or attachmentId is required" }, 400);
    if (typeof body.scheduledFor !== "string") return c.json({ error: "scheduledFor is required" }, 400);
    const scheduledFor = new Date(body.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) return c.json({ error: "scheduledFor must be an ISO date" }, 400);
    const delta = scheduledFor.getTime() - Date.now();
    if (delta < 5_000) return c.json({ error: "scheduledFor must be at least 5 seconds in the future" }, 400);
    if (delta > MAX_SCHEDULE_AHEAD_MS) return c.json({ error: "scheduledFor must be within one year" }, 400);
    const replyToMessageId = typeof body.replyToMessageId === "string" && body.replyToMessageId.length <= 128
        ? body.replyToMessageId
        : null;

    const [row] = await db.insert(scheduledMessage).values({
        id: randomUUID(),
        userId,
        scope,
        targetId,
        text,
        replyToMessageId,
        attachmentId,
        scheduledFor,
        status: "pending",
    }).returning();
    await publishScheduled(userId, "created", row);
    return c.json({ scheduledMessage: toScheduledSummary(row) }, 201);
}

export async function listScheduledMessages(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const scope = c.req.query("scope");
    if (scope !== undefined && !isConversationScope(scope)) return c.json({ error: "scope must be direct or channel" }, 400);
    const targetId = c.req.query("targetId");
    const status = c.req.query("status");
    if (status !== undefined && !["pending", "sent", "canceled", "failed"].includes(status)) {
        return c.json({ error: "status must be pending, sent, canceled or failed" }, 400);
    }
    const conditions = [eq(scheduledMessage.userId, userId)];
    if (scope) conditions.push(eq(scheduledMessage.scope, scope));
    if (targetId) conditions.push(eq(scheduledMessage.targetId, targetId));
    if (status) conditions.push(eq(scheduledMessage.status, status));
    const rows = await db.select().from(scheduledMessage)
        .where(and(...conditions))
        .orderBy(asc(scheduledMessage.scheduledFor))
        .limit(200);
    return c.json({ scheduledMessages: rows.map(toScheduledSummary) }, 200);
}

export async function updateScheduledMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const id = c.req.param("scheduledMessageId") ?? "";
    const [current] = await db.select().from(scheduledMessage)
        .where(and(eq(scheduledMessage.id, id), eq(scheduledMessage.userId, userId))).limit(1);
    if (!current) return c.json({ error: "Scheduled message not found" }, 404);
    if (current.status !== "pending") return c.json({ error: "Only pending scheduled messages can be updated" }, 409);
    const body = await readBody(c);
    if (!body) return c.json({ error: "Invalid JSON body" }, 400);

    const patch: Partial<typeof scheduledMessage.$inferInsert> = {};
    if (body.text !== undefined) {
        if (typeof body.text !== "string" || body.text.trim().length === 0 || body.text.trim().length > 4000) {
            return c.json({ error: "text must contain between 1 and 4000 characters" }, 400);
        }
        patch.text = body.text.trim();
    }
    if (body.scheduledFor !== undefined) {
        if (typeof body.scheduledFor !== "string") return c.json({ error: "scheduledFor must be an ISO date" }, 400);
        const scheduledFor = new Date(body.scheduledFor);
        if (Number.isNaN(scheduledFor.getTime())) return c.json({ error: "scheduledFor must be an ISO date" }, 400);
        const delta = scheduledFor.getTime() - Date.now();
        if (delta < 5_000 || delta > MAX_SCHEDULE_AHEAD_MS) {
            return c.json({ error: "scheduledFor must be between 5 seconds and one year from now" }, 400);
        }
        patch.scheduledFor = scheduledFor;
    }
    if (Object.keys(patch).length === 0) return c.json({ error: "No fields to update" }, 400);
    patch.updatedAt = new Date();
    const [row] = await db.update(scheduledMessage).set(patch)
        .where(and(eq(scheduledMessage.id, id), eq(scheduledMessage.userId, userId), eq(scheduledMessage.status, "pending")))
        .returning();
    if (!row) return c.json({ error: "Scheduled message not found" }, 404);
    await publishScheduled(userId, "updated", row);
    return c.json({ scheduledMessage: toScheduledSummary(row) }, 200);
}

export async function cancelScheduledMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const id = c.req.param("scheduledMessageId") ?? "";
    const [row] = await db.update(scheduledMessage).set({ status: "canceled", updatedAt: new Date() })
        .where(and(
            eq(scheduledMessage.id, id),
            eq(scheduledMessage.userId, userId),
            eq(scheduledMessage.status, "pending"),
        )).returning();
    if (!row) return c.json({ error: "Pending scheduled message not found" }, 404);
    await publishScheduled(userId, "canceled", row);
    return c.body(null, 204);
}

/** Commits each message and its scheduled status together while holding the job row lock. */
export async function dispatchDueScheduledMessages(limit = 25, signal?: AbortSignal): Promise<number> {
    let processed = 0;
    while (processed < limit && !signal?.aborted) {
        const completed = await db.transaction(async tx => {
            const [item] = await tx.select().from(scheduledMessage).where(and(
                eq(scheduledMessage.status, "pending"),
                lte(scheduledMessage.scheduledFor, new Date()),
            )).orderBy(asc(scheduledMessage.scheduledFor), asc(scheduledMessage.id))
                .limit(1).for("update", { skipLocked: true });
            if (!item) return null;

            const outcome = await dispatchOne(tx, item);
            const status: "sent" | "failed" = outcome.ok ? "sent" : "failed";
            const [row] = await tx.update(scheduledMessage).set({
                status,
                sentMessageId: outcome.ok ? outcome.message.id : null,
                failureReason: outcome.ok ? null : outcome.error,
                updatedAt: new Date(),
            }).where(eq(scheduledMessage.id, item.id)).returning();
            return { row, status, publish: outcome.ok ? outcome.publish : undefined };
        });
        if (!completed) break;
        processed += 1;
        await Promise.all([completed.publish?.(), publishScheduled(completed.row.userId, completed.status, completed.row)]);
    }
    return processed;
}

async function dispatchOne(executor: DbTransaction, item: typeof scheduledMessage.$inferSelect) {
    const input = {
        text: item.text,
        attachmentId: item.attachmentId,
        replyToMessageId: item.replyToMessageId,
        forwardedFromId: null,
        location: null,
        attachmentDurationMs: null,
        expiresInSeconds: null,
        encrypted: false,
        poll: null,
    };
    const options = { messageId: item.id };

    if (item.scope === "direct") {
        const peerId = item.targetId.split(":").find(id => id !== item.userId);
        if (!peerId) return { ok: false, error: "Scheduled conversation target is invalid" } as const;
        if (!await canAccessDirectConversation(item.userId, peerId, executor)) {
            return { ok: false, error: "You no longer have access to this conversation" } as const;
        }
        return storeDirectMessage(executor, item.userId, peerId, input, options);
    }

    if (item.scope !== "channel") return { ok: false, error: "Scheduled message scope is invalid" } as const;
    const access = await getChannelAccess(item.userId, item.targetId, undefined, executor);
    if (!access || access.kind !== "text") return { ok: false, error: "Channel not found or access denied" } as const;
    return storeChannelMessage(executor, item.userId, access, input, options);
}
