import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { profile, user } from "../db/schema/auth";
import { channelMessage } from "../db/schema/channel-message";
import { communityServer, serverChannel, serverMember } from "../db/schema/community";
import { directMessage } from "../db/schema/direct-message";
import {
    conversationPreference,
    messageDraft,
    messagePin,
    notification,
    scheduledMessage,
    userPreference,
} from "../db/schema/features";
import { resolveConversationTarget } from "../lib/conversation-access";
import { getSessionUserId } from "../lib/request-auth";

const MAX_MESSAGES_PER_KIND = 5000;

export async function exportBackup(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const [account] = await db
        .select({
            id: user.id,
            name: user.name,
            username: user.username,
            email: user.email,
            image: user.image,
            createdAt: user.createdAt,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
    const [profileRow] = await db.select().from(profile).where(eq(profile.userId, userId)).limit(1);
    const [preferences] = await db.select().from(userPreference).where(eq(userPreference.userId, userId)).limit(1);
    const preferencesList = await db
        .select()
        .from(conversationPreference)
        .where(eq(conversationPreference.userId, userId));
    const drafts = await db.select().from(messageDraft).where(eq(messageDraft.userId, userId));
    const pins = await db.select().from(messagePin).where(eq(messagePin.pinnedBy, userId));
    const scheduled = await db.select().from(scheduledMessage).where(eq(scheduledMessage.userId, userId));
    const notifications = await db
        .select()
        .from(notification)
        .where(eq(notification.userId, userId))
        .orderBy(desc(notification.createdAt))
        .limit(500);

    const memberships = await db
        .select({ serverId: serverMember.serverId })
        .from(serverMember)
        .where(eq(serverMember.userId, userId));
    const serverIds = memberships.map(row => row.serverId);
    const servers =
        serverIds.length === 0
            ? []
            : await db.select().from(communityServer).where(inArray(communityServer.id, serverIds));
    const channels =
        serverIds.length === 0
            ? []
            : await db.select().from(serverChannel).where(inArray(serverChannel.serverId, serverIds));
    const channelIds = channels.map(channel => channel.id);

    const directRows = await db
        .select()
        .from(directMessage)
        .where(or(eq(directMessage.senderId, userId), eq(directMessage.recipientId, userId)))
        .orderBy(desc(directMessage.createdAt))
        .limit(MAX_MESSAGES_PER_KIND);
    const channelRows =
        channelIds.length === 0
            ? []
            : await db
                  .select()
                  .from(channelMessage)
                  .where(inArray(channelMessage.channelId, channelIds))
                  .orderBy(desc(channelMessage.createdAt))
                  .limit(MAX_MESSAGES_PER_KIND);

    return c.json({
        backup: {
            version: 1,
            exportedAt: new Date().toISOString(),
            account,
            profile: profileRow ?? null,
            preferences: preferences ?? null,
            conversationPreferences: preferencesList,
            drafts,
            pins,
            scheduledMessages: scheduled,
            notifications,
            servers: servers.map(server => ({
                id: server.id,
                name: server.name,
                description: server.description,
                channels: channels
                    .filter(channel => channel.serverId === server.id)
                    .map(channel => ({ id: channel.id, name: channel.name, kind: channel.kind })),
            })),
            directMessages: directRows,
            channelMessages: channelRows,
        },
    }, 200);
}

type RestoreResult = {
    directMessagesImported: number;
    channelMessagesImported: number;
    draftsImported: number;
    skipped: number;
};

export async function restoreBackup(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return c.json({ error: "Request body must be an object" }, 400);
    }
    const backup = (body as Record<string, unknown>).backup ?? body;
    if (typeof backup !== "object" || backup === null || Array.isArray(backup)) {
        return c.json({ error: "backup must be an object" }, 400);
    }
    const source = backup as Record<string, unknown>;
    if (source.version !== undefined && source.version !== 1) {
        return c.json({ error: "Unsupported backup version" }, 400);
    }
    const directRows = Array.isArray(source.directMessages) ? source.directMessages : [];
    const channelRows = Array.isArray(source.channelMessages) ? source.channelMessages : [];
    const draftRows = Array.isArray(source.drafts) ? source.drafts : [];
    if (directRows.length + channelRows.length + draftRows.length > 3 * MAX_MESSAGES_PER_KIND) {
        return c.json({ error: "Backup is too large to restore" }, 413);
    }

    const result: RestoreResult = {
        directMessagesImported: 0,
        channelMessagesImported: 0,
        draftsImported: 0,
        skipped: 0,
    };

    for (const entry of directRows) {
        const row = asStringRecord(entry);
        const id = row?.id;
        const peerId = row?.senderId === userId ? row?.recipientId : row?.senderId;
        if (!id || typeof peerId !== "string" || typeof row?.text !== "string" || !row.text.trim()) {
            result.skipped += 1;
            continue;
        }
        if (!(await resolveConversationTarget(userId, "direct", peerId))) {
            result.skipped += 1;
            continue;
        }
        const inserted = await db
            .insert(directMessage)
            .values({
                id,
                senderId: userId,
                recipientId: peerId,
                text: row.text.slice(0, 4000),
                createdAt: parseDate(row.createdAt),
                updatedAt: parseDate(row.updatedAt),
            })
            .onConflictDoNothing()
            .returning({ id: directMessage.id });
        if (inserted.length > 0) result.directMessagesImported += 1;
        else result.skipped += 1;
    }

    for (const entry of channelRows) {
        const row = asStringRecord(entry);
        const id = row?.id;
        if (!id || typeof row?.channelId !== "string" || typeof row?.text !== "string" || !row.text.trim()) {
            result.skipped += 1;
            continue;
        }
        if (!(await resolveConversationTarget(userId, "channel", row.channelId))) {
            result.skipped += 1;
            continue;
        }
        const inserted = await db
            .insert(channelMessage)
            .values({
                id,
                channelId: row.channelId,
                senderId: userId,
                text: row.text.slice(0, 4000),
                createdAt: parseDate(row.createdAt),
                updatedAt: parseDate(row.updatedAt),
            })
            .onConflictDoNothing()
            .returning({ id: channelMessage.id });
        if (inserted.length > 0) result.channelMessagesImported += 1;
        else result.skipped += 1;
    }

    for (const entry of draftRows) {
        const row = asStringRecord(entry);
        if (
            !row ||
            (row.scope !== "direct" && row.scope !== "channel") ||
            typeof row.targetId !== "string" ||
            typeof row.text !== "string"
        ) {
            result.skipped += 1;
            continue;
        }
        const targetId = await resolveConversationTarget(userId, row.scope, row.targetId);
        if (!targetId) {
            result.skipped += 1;
            continue;
        }
        await db
            .insert(messageDraft)
            .values({
                id: crypto.randomUUID(),
                userId,
                scope: row.scope,
                targetId,
                text: row.text.slice(0, 4000),
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [messageDraft.userId, messageDraft.scope, messageDraft.targetId],
                set: { text: row.text.slice(0, 4000), updatedAt: new Date() },
            });
        result.draftsImported += 1;
    }

    return c.json({ restored: result }, 200);
}

function asStringRecord(value: unknown): Record<string, string | null | undefined> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as Record<string, string | null | undefined>;
}

function parseDate(value: unknown): Date {
    if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
}

/** Convenience helper used by tests to confirm a user can still read a channel. */
export async function canRestoreIntoChannel(userId: string, channelId: string) {
    const [membership] = await db
        .select({ userId: serverMember.userId })
        .from(serverMember)
        .innerJoin(
            serverChannel,
            and(eq(serverChannel.serverId, serverMember.serverId), eq(serverChannel.id, channelId)),
        )
        .where(and(eq(serverMember.userId, userId), eq(serverChannel.kind, "text")))
        .limit(1);
    return Boolean(membership);
}
