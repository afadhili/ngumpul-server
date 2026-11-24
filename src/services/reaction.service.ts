import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { channelMessageReaction } from "../db/schema/reaction";
import { directMessageReaction } from "../db/schema/reaction";
import type { MessageReaction } from "../models/chat-message";
import type { ReactionSummary } from "../models/realtime-event";

type ReactionRow = {
    messageId: string;
    userId: string;
    emoji: string;
};

export function summarizeReactions(rows: ReactionRow[], currentUserId: string): MessageReaction[] {
    const grouped = new Map<string, { emoji: string; userIds: Set<string> }>();
    for (const row of rows) {
        const key = row.emoji;
        const entry = grouped.get(key) ?? { emoji: row.emoji, userIds: new Set<string>() };
        entry.userIds.add(row.userId);
        grouped.set(key, entry);
    }
    return [...grouped.values()]
        .map(entry => ({
            emoji: entry.emoji,
            count: entry.userIds.size,
            userIds: [...entry.userIds],
            me: entry.userIds.has(currentUserId),
        }))
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

export function publicReactionSummary(reactions: MessageReaction[]): ReactionSummary[] {
    return reactions.map(({ emoji, count, userIds }) => ({ emoji, count, userIds }));
}

export async function loadDirectReactions(messageIds: string[], currentUserId: string) {
    const result = new Map<string, MessageReaction[]>();
    if (messageIds.length === 0) return result;
    const rows = await db.select({
        messageId: directMessageReaction.messageId,
        userId: directMessageReaction.userId,
        emoji: directMessageReaction.emoji,
    }).from(directMessageReaction).where(inArray(directMessageReaction.messageId, messageIds));
    for (const messageId of messageIds) {
        result.set(messageId, summarizeReactions(rows.filter(row => row.messageId === messageId), currentUserId));
    }
    return result;
}

export async function loadChannelReactions(messageIds: string[], currentUserId: string) {
    const result = new Map<string, MessageReaction[]>();
    if (messageIds.length === 0) return result;
    const rows = await db.select({
        messageId: channelMessageReaction.messageId,
        userId: channelMessageReaction.userId,
        emoji: channelMessageReaction.emoji,
    }).from(channelMessageReaction).where(inArray(channelMessageReaction.messageId, messageIds));
    for (const messageId of messageIds) {
        result.set(messageId, summarizeReactions(rows.filter(row => row.messageId === messageId), currentUserId));
    }
    return result;
}

export async function directReactions(messageId: string, currentUserId: string) {
    const rows = await db.select({
        messageId: directMessageReaction.messageId,
        userId: directMessageReaction.userId,
        emoji: directMessageReaction.emoji,
    }).from(directMessageReaction).where(eq(directMessageReaction.messageId, messageId));
    return summarizeReactions(rows, currentUserId);
}

export async function channelReactions(messageId: string, currentUserId: string) {
    const rows = await db.select({
        messageId: channelMessageReaction.messageId,
        userId: channelMessageReaction.userId,
        emoji: channelMessageReaction.emoji,
    }).from(channelMessageReaction).where(eq(channelMessageReaction.messageId, messageId));
    return summarizeReactions(rows, currentUserId);
}
