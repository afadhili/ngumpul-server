import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, type DbExecutor } from "../db/index";
import { conversationPreference } from "../db/schema/features";

export type ConversationScope = "direct" | "channel";

export type ConversationPreferenceInput = {
    favorite?: boolean;
    archived?: boolean;
    mutedUntil?: Date | null;
    notificationLevel?: "all" | "mentions" | "none";
    disappearingSeconds?: number | null;
    sortOrder?: number;
};

export async function getConversationPreference(userId: string, scope: ConversationScope, targetId: string, executor: DbExecutor = db) {
    const [row] = await executor.select().from(conversationPreference).where(and(
        eq(conversationPreference.userId, userId),
        eq(conversationPreference.scope, scope),
        eq(conversationPreference.targetId, targetId),
    )).limit(1);
    return row ?? null;
}

export async function upsertConversationPreference(
    userId: string,
    scope: ConversationScope,
    targetId: string,
    patch: ConversationPreferenceInput,
) {
    const now = new Date();
    const [row] = await db.insert(conversationPreference).values({
        id: randomUUID(),
        userId,
        scope,
        targetId,
        favorite: patch.favorite ?? false,
        archived: patch.archived ?? false,
        mutedUntil: patch.mutedUntil ?? null,
        notificationLevel: patch.notificationLevel ?? "all",
        disappearingSeconds: patch.disappearingSeconds ?? null,
        sortOrder: patch.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
    }).onConflictDoUpdate({
        target: [conversationPreference.userId, conversationPreference.scope, conversationPreference.targetId],
        set: {
            ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
            ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
            ...(patch.mutedUntil !== undefined ? { mutedUntil: patch.mutedUntil } : {}),
            ...(patch.notificationLevel !== undefined ? { notificationLevel: patch.notificationLevel } : {}),
            ...(patch.disappearingSeconds !== undefined ? { disappearingSeconds: patch.disappearingSeconds } : {}),
            ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
            updatedAt: now,
        },
    }).returning();
    return row;
}

export async function listConversationPreferences(userId: string) {
    return db.select().from(conversationPreference).where(eq(conversationPreference.userId, userId));
}

export async function loadPreferencesForTarget(
    scope: ConversationScope,
    targetId: string,
    userIds: string[],
    executor: DbExecutor = db,
) {
    const result = new Map<string, Awaited<ReturnType<typeof getConversationPreference>>>();
    if (userIds.length === 0) return result;
    const rows = await executor.select().from(conversationPreference).where(and(
        eq(conversationPreference.scope, scope),
        eq(conversationPreference.targetId, targetId),
        inArray(conversationPreference.userId, userIds),
    ));
    for (const row of rows) result.set(row.userId, row);
    return result;
}

export function isMuted(preference: { mutedUntil: Date | null } | null) {
    return Boolean(preference?.mutedUntil && preference.mutedUntil.getTime() > Date.now());
}

export async function disappearingSecondsFor(userId: string, scope: ConversationScope, targetId: string, executor: DbExecutor = db) {
    const preference = await getConversationPreference(userId, scope, targetId, executor);
    return preference?.disappearingSeconds ?? null;
}

/** Whether a recipient wants a realtime/browser notification for this conversation. */
export function allowsNotification(
    preference: { mutedUntil: Date | null; notificationLevel: string } | null,
    hasMention: boolean,
) {
    if (!preference) return true;
    if (isMuted(preference)) return false;
    if (preference.notificationLevel === "none") return false;
    if (preference.notificationLevel === "mentions" && !hasMention) return false;
    return true;
}
