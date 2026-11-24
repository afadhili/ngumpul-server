import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { user } from "../db/schema/auth";
import { messageMention, messagePin } from "../db/schema/features";
import { directConversationKey } from "../lib/conversation-key";
import type { MessageMention, MessageReaction } from "../models/chat-message";
import type { PollSummary } from "../models/realtime-event";
import { loadPolls } from "./poll.service";
import { loadChannelReactions, loadDirectReactions } from "./reaction.service";

export type MessageMeta = {
    reactions: MessageReaction[];
    mentions: MessageMention[];
    poll: PollSummary | null;
    pinned: boolean;
};

const emptyMeta = (): MessageMeta => ({ reactions: [], mentions: [], poll: null, pinned: false });

export async function loadMentionMap(
    scope: "direct" | "channel",
    messageIds: string[],
): Promise<Map<string, MessageMention[]>> {
    const result = new Map<string, MessageMention[]>();
    if (messageIds.length === 0) return result;
    const rows = await db.select({
        messageId: messageMention.messageId,
        userId: messageMention.mentionedUserId,
        username: user.username,
    }).from(messageMention)
        .leftJoin(user, eq(user.id, messageMention.mentionedUserId))
        .where(and(eq(messageMention.scope, scope), inArray(messageMention.messageId, messageIds)));
    for (const row of rows) {
        const list = result.get(row.messageId) ?? [];
        list.push({ userId: row.userId, username: row.username ?? null });
        result.set(row.messageId, list);
    }
    return result;
}

async function loadPinSet(scope: "direct" | "channel", pairs: { messageId: string; targetId: string }[]) {
    const pinned = new Set<string>();
    if (pairs.length === 0) return pinned;
    const rows = await db.select({ messageId: messagePin.messageId, targetId: messagePin.targetId })
        .from(messagePin)
        .where(and(
            eq(messagePin.scope, scope),
            inArray(messagePin.targetId, [...new Set(pairs.map(pair => pair.targetId))]),
            inArray(messagePin.messageId, pairs.map(pair => pair.messageId)),
        ));
    const allowed = new Set(pairs.map(pair => `${pair.targetId}:${pair.messageId}`));
    for (const row of rows) {
        if (allowed.has(`${row.targetId}:${row.messageId}`)) pinned.add(row.messageId);
    }
    return pinned;
}

export async function loadDirectMessageMeta(
    rows: { id: string; senderId: string; recipientId: string }[],
    viewerId: string,
): Promise<Map<string, MessageMeta>> {
    const result = new Map<string, MessageMeta>();
    if (rows.length === 0) return result;
    const ids = rows.map(row => row.id);
    const [reactions, mentions, polls, pinned] = await Promise.all([
        loadDirectReactions(ids, viewerId),
        loadMentionMap("direct", ids),
        loadPolls("direct", ids, viewerId),
        loadPinSet("direct", rows.map(row => ({
            messageId: row.id,
            targetId: directConversationKey(row.senderId, row.recipientId),
        }))),
    ]);
    for (const id of ids) {
        result.set(id, {
            reactions: reactions.get(id) ?? [],
            mentions: mentions.get(id) ?? [],
            poll: polls.get(id) ?? null,
            pinned: pinned.has(id),
        });
    }
    return result;
}

export async function loadChannelMessageMeta(
    rows: { id: string; channelId: string }[],
    viewerId: string,
): Promise<Map<string, MessageMeta>> {
    const result = new Map<string, MessageMeta>();
    if (rows.length === 0) return result;
    const ids = rows.map(row => row.id);
    const [reactions, mentions, polls, pinned] = await Promise.all([
        loadChannelReactions(ids, viewerId),
        loadMentionMap("channel", ids),
        loadPolls("channel", ids, viewerId),
        loadPinSet("channel", rows.map(row => ({ messageId: row.id, targetId: row.channelId }))),
    ]);
    for (const id of ids) {
        result.set(id, {
            reactions: reactions.get(id) ?? [],
            mentions: mentions.get(id) ?? [],
            poll: polls.get(id) ?? null,
            pinned: pinned.has(id),
        });
    }
    return result;
}

export function metaFor(map: Map<string, MessageMeta>, id: string): MessageMeta {
    return map.get(id) ?? emptyMeta();
}
