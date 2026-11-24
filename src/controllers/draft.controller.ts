import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { messageDraft } from "../db/schema/features";
import { resolveConversationTarget, type ConversationScope } from "../lib/conversation-access";
import { getSessionUserId } from "../lib/request-auth";

type DraftScope = ConversationScope;

function readScope(value: unknown): DraftScope | null {
    return value === "direct" || value === "channel" ? value : null;
}

export async function listDrafts(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const rows = await db.select().from(messageDraft).where(eq(messageDraft.userId, userId));
    return c.json({
        drafts: rows.map(row => ({
            scope: row.scope,
            targetId: row.targetId,
            text: row.text,
            replyToMessageId: row.replyToMessageId,
            updatedAt: row.updatedAt.toISOString(),
        })),
    });
}

export async function saveDraft(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    const record = typeof body === "object" && body !== null && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {};
    const scope = readScope(c.req.param("scope")) ?? readScope(record.scope);
    if (!scope) return c.json({ error: "scope must be direct or channel" }, 400);
    const rawTarget = c.req.param("targetId") ?? (typeof record.targetId === "string" ? record.targetId : "");
    if (!rawTarget) return c.json({ error: "targetId is required" }, 400);
    const targetId = await resolveConversationTarget(userId, scope, rawTarget);
    if (!targetId) return c.json({ error: "You do not have access to this conversation" }, 403);
    const text = typeof record.text === "string" ? record.text : "";
    if (text.length > 4000) return c.json({ error: "Draft text must not exceed 4000 characters" }, 400);
    const replyToMessageId = typeof record.replyToMessageId === "string" && record.replyToMessageId.length <= 128
        ? record.replyToMessageId
        : null;
    if (text.trim().length === 0 && replyToMessageId === null) {
        await db.delete(messageDraft).where(and(
            eq(messageDraft.userId, userId),
            eq(messageDraft.scope, scope),
            eq(messageDraft.targetId, targetId),
        ));
        return c.body(null, 204);
    }
    const [row] = await db.insert(messageDraft).values({
        id: randomUUID(),
        userId,
        scope,
        targetId,
        text,
        replyToMessageId,
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: [messageDraft.userId, messageDraft.scope, messageDraft.targetId],
        set: { text, replyToMessageId, updatedAt: new Date() },
    }).returning();
    return c.json({
        draft: {
            scope,
            targetId,
            text: row?.text ?? text,
            replyToMessageId: row?.replyToMessageId ?? replyToMessageId,
            updatedAt: (row?.updatedAt ?? new Date()).toISOString(),
        },
    });
}

export async function deleteDraft(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const scope = readScope(c.req.param("scope"));
    if (!scope) return c.json({ error: "scope must be direct or channel" }, 400);
    const targetId = c.req.param("targetId") ?? "";
    const deleted = await db.delete(messageDraft).where(and(
        eq(messageDraft.userId, userId),
        eq(messageDraft.scope, scope),
        eq(messageDraft.targetId, targetId),
    )).returning({ userId: messageDraft.userId });
    return deleted.length > 0 ? c.body(null, 204) : c.json({ error: "Draft not found" }, 404);
}

/** Drafts for a list of channel IDs (used by unread/metadata views). */
export async function loadDraftsForTargets(userId: string, scope: DraftScope, targetIds: string[]) {
    if (targetIds.length === 0) return [];
    return db.select().from(messageDraft).where(and(
        eq(messageDraft.userId, userId),
        eq(messageDraft.scope, scope),
        inArray(messageDraft.targetId, targetIds),
    ));
}
