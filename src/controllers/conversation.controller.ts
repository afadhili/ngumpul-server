import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { conversationPreference } from "../db/schema/features";
import { isConversationScope, resolveConversationTarget, type ConversationScope } from "../lib/conversation-access";
import { getSessionUserId } from "../lib/request-auth";

const MAX_MUTE_SECONDS = 365 * 24 * 60 * 60;

function toPublicPreference(row: typeof conversationPreference.$inferSelect) {
    return {
        scope: row.scope,
        targetId: row.targetId,
        favorite: row.favorite,
        archived: row.archived,
        markedUnread: row.markedUnread,
        mutedUntil: row.mutedUntil?.toISOString() ?? null,
        notificationLevel: row.notificationLevel,
        disappearingSeconds: row.disappearingSeconds,
        sortOrder: row.sortOrder,
        updatedAt: row.updatedAt.toISOString(),
    };
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined | null {
    const value = record[key];
    if (value === undefined) return undefined;
    return typeof value === "boolean" ? value : null;
}

export async function listConversations(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const url = new URL(c.req.url);
    const scope = url.searchParams.get("scope");
    if (scope !== null && !isConversationScope(scope)) return c.json({ error: "scope must be direct or channel" }, 400);
    const archivedParam = url.searchParams.get("archived");
    if (archivedParam !== null && archivedParam !== "true" && archivedParam !== "false") {
        return c.json({ error: "archived must be true or false" }, 400);
    }
    const favoriteParam = url.searchParams.get("favorite");
    if (favoriteParam !== null && favoriteParam !== "true" && favoriteParam !== "false") {
        return c.json({ error: "favorite must be true or false" }, 400);
    }

    const conditions = [eq(conversationPreference.userId, userId)];
    if (scope) conditions.push(eq(conversationPreference.scope, scope));
    if (archivedParam !== null) conditions.push(eq(conversationPreference.archived, archivedParam === "true"));
    if (favoriteParam !== null) conditions.push(eq(conversationPreference.favorite, favoriteParam === "true"));

    const rows = await db.select().from(conversationPreference)
        .where(and(...conditions))
        .orderBy(conversationPreference.sortOrder, conversationPreference.updatedAt);
    return c.json({ conversations: rows.map(toPublicPreference) }, 200);
}

export async function getConversationPreferenceHandler(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const scope = c.req.param("scope");
    if (!isConversationScope(scope)) return c.json({ error: "scope must be direct or channel" }, 400);
    const resolvedTarget = await resolveConversationTarget(userId, scope, c.req.param("targetId") ?? "");
    if (!resolvedTarget) return c.json({ error: "You do not have access to this conversation" }, 403);
    const targetId = resolvedTarget;
    const [row] = await db.select().from(conversationPreference).where(and(
        eq(conversationPreference.userId, userId),
        eq(conversationPreference.scope, scope),
        eq(conversationPreference.targetId, targetId),
    )).limit(1);
    if (!row) {
        return c.json({
            preference: {
                scope,
                targetId,
                favorite: false,
                archived: false,
                markedUnread: false,
                mutedUntil: null,
                notificationLevel: "all",
                disappearingSeconds: null,
                sortOrder: 0,
                updatedAt: null,
            },
        }, 200);
    }
    return c.json({ preference: toPublicPreference(row) }, 200);
}

export async function updateConversationPreference(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const scope = c.req.param("scope");
    if (!isConversationScope(scope)) return c.json({ error: "scope must be direct or channel" }, 400);
    const resolvedTarget = await resolveConversationTarget(userId, scope, c.req.param("targetId") ?? "");
    if (!resolvedTarget) return c.json({ error: "You do not have access to this conversation" }, 403);
    const targetId = resolvedTarget;

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return c.json({ error: "Request body must be an object" }, 400);
    }
    const record = body as Record<string, unknown>;

    const favorite = readOptionalBoolean(record, "favorite");
    if (favorite === null) return c.json({ error: "favorite must be a boolean" }, 400);
    const archived = readOptionalBoolean(record, "archived");
    if (archived === null) return c.json({ error: "archived must be a boolean" }, 400);
    const markedUnread = readOptionalBoolean(record, "markedUnread");
    if (markedUnread === null) return c.json({ error: "markedUnread must be a boolean" }, 400);

    let mutedUntil: Date | null | undefined;
    if (record.mutedUntil === null) {
        mutedUntil = null;
    } else if (typeof record.mutedUntil === "string") {
        const parsed = new Date(record.mutedUntil);
        if (Number.isNaN(parsed.getTime())) return c.json({ error: "mutedUntil must be an ISO date or null" }, 400);
        mutedUntil = parsed;
    } else if (record.muteForSeconds !== undefined) {
        const seconds = Number(record.muteForSeconds);
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_MUTE_SECONDS) {
            return c.json({ error: `muteForSeconds must be between 1 and ${MAX_MUTE_SECONDS}` }, 400);
        }
        mutedUntil = new Date(Date.now() + Math.trunc(seconds) * 1000);
    }

    let notificationLevel: string | undefined;
    if (record.notificationLevel !== undefined) {
        if (record.notificationLevel !== "all" && record.notificationLevel !== "mentions" && record.notificationLevel !== "none") {
            return c.json({ error: "notificationLevel must be all, mentions or none" }, 400);
        }
        notificationLevel = record.notificationLevel;
    }

    let disappearingSeconds: number | null | undefined;
    if (record.disappearingSeconds === null) {
        disappearingSeconds = null;
    } else if (record.disappearingSeconds !== undefined) {
        const seconds = Number(record.disappearingSeconds);
        if (!Number.isFinite(seconds) || seconds < 5 || seconds > 604800) {
            return c.json({ error: "disappearingSeconds must be between 5 and 604800" }, 400);
        }
        disappearingSeconds = Math.trunc(seconds);
    }

    let sortOrder: number | undefined;
    if (record.sortOrder !== undefined) {
        const value = Number(record.sortOrder);
        if (!Number.isFinite(value)) return c.json({ error: "sortOrder must be a number" }, 400);
        sortOrder = Math.trunc(value);
    }

    const patch = {
        ...(favorite !== undefined ? { favorite } : {}),
        ...(archived !== undefined ? { archived } : {}),
        ...(markedUnread !== undefined ? { markedUnread } : {}),
        ...(mutedUntil !== undefined ? { mutedUntil } : {}),
        ...(notificationLevel !== undefined ? { notificationLevel } : {}),
        ...(disappearingSeconds !== undefined ? { disappearingSeconds } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
    };
    if (Object.keys(patch).length === 0) return c.json({ error: "No preference fields provided" }, 400);

    const [row] = await db.insert(conversationPreference).values({
        id: randomUUID(),
        userId,
        scope: scope as ConversationScope,
        targetId,
        ...patch,
    }).onConflictDoUpdate({
        target: [conversationPreference.userId, conversationPreference.scope, conversationPreference.targetId],
        set: { ...patch, updatedAt: new Date() },
    }).returning();
    return c.json({ preference: row ? toPublicPreference(row) : null }, 200);
}
