import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import { user } from "../db/schema/auth";
import { channelMessage } from "../db/schema/channel-message";
import { directMessage } from "../db/schema/direct-message";
import {
    messageMention,
    messagePin,
    messagePoll,
    messagePollOption,
    messagePollVote,
} from "../db/schema/features";
import { getChannelAccess } from "../lib/channel-access";
import type { MessageLocationInput, MessagePollInput } from "../lib/message-input";
import type { MessageLocation } from "../models/chat-message";
import type { PollSummary } from "../models/realtime-event";

/** Persists a poll attached to a freshly created message. */
export async function createPollForMessage(
    scope: "direct" | "channel",
    messageId: string,
    poll: MessagePollInput,
    createdBy: string,
): Promise<PollSummary | null> {
    const pollId = randomUUID();
    const options = poll.options.map((label, index) => ({ id: randomUUID(), label, position: index }));
    await db.insert(messagePoll).values({
        id: pollId,
        scope,
        messageId,
        question: poll.question,
        allowMultiple: poll.allowMultiple,
        anonymous: poll.anonymous,
        closesAt: poll.closesAt,
        createdBy,
    });
    await db.insert(messagePollOption).values(options.map(option => ({ ...option, pollId })));
    return {
        id: pollId,
        messageId,
        question: poll.question,
        allowMultiple: poll.allowMultiple,
        anonymous: poll.anonymous,
        closesAt: poll.closesAt?.toISOString() ?? null,
        closedAt: null,
        totalVotes: 0,
        options: options.map(option => ({
            id: option.id,
            label: option.label,
            position: option.position,
            votes: 0,
            votedByMe: false,
        })),
    };
}

/**
 * Resolves `@username` mentions to user IDs and stores them. When
 * `allowedUserIds` is provided (channel scope), users outside the server are
 * silently ignored so a mention cannot leak membership.
 */
export async function saveMentions(input: {
    scope: "direct" | "channel";
    messageId: string;
    mentionerId: string;
    channelId?: string | null;
    usernames: string[];
    allowedUserIds?: Set<string>;
}): Promise<string[]> {
    const unique = [...new Set(input.usernames.map(name => name.toLowerCase()))]
        .filter(Boolean)
        .slice(0, 25);
    if (unique.length === 0) return [];

    const rows = await db.select({ id: user.id, username: user.username }).from(user)
        .where(inArray(sql`lower(${user.username})`, unique));
    const matched = rows
        .filter(row => row.username && unique.includes(row.username.toLowerCase()))
        .filter(row => row.id !== input.mentionerId)
        .filter(row => !input.allowedUserIds || input.allowedUserIds.has(row.id));
    if (matched.length === 0) return [];

    await db.insert(messageMention).values(matched.map(row => ({
        id: randomUUID(),
        scope: input.scope,
        messageId: input.messageId,
        mentionedUserId: row.id,
        mentionerId: input.mentionerId,
        channelId: input.channelId ?? null,
    }))).onConflictDoNothing();

    return matched.map(row => row.id);
}

export type ForwardSource = {
    text: string | null;
    location: MessageLocation | null;
    attachmentId: string | null;
    attachmentDurationMs: number | null;
};

function locationFrom(lat: number | null, lng: number | null, label: string | null): MessageLocation | null {
    if (lat === null || lng === null) return null;
    return { lat, lng, label };
}

/**
 * Resolves a message the viewer is allowed to see so its content can be
 * forwarded. Only text/location messages can be forwarded: attachments are
 * bound to their uploader and target, so a forward of them would break the
 * attachment authorization model.
 */
export async function resolveForwardSource(userId: string, messageId: string): Promise<ForwardSource | null> {
    const [direct] = await db.select().from(directMessage).where(and(
        eq(directMessage.id, messageId),
        isNull(directMessage.deletedAt),
        or(eq(directMessage.senderId, userId), eq(directMessage.recipientId, userId)),
    )).limit(1);
    if (direct) {
        return {
            text: direct.text,
            location: locationFrom(direct.locationLat, direct.locationLng, direct.locationLabel),
            attachmentId: direct.attachmentId,
            attachmentDurationMs: direct.attachmentDurationMs,
        };
    }

    const [channel] = await db.select().from(channelMessage)
        .where(and(eq(channelMessage.id, messageId), isNull(channelMessage.deletedAt))).limit(1);
    if (!channel) return null;
    if (!await getChannelAccess(userId, channel.channelId)) return null;
    return {
        text: channel.text,
        location: locationFrom(channel.locationLat, channel.locationLng, channel.locationLabel),
        attachmentId: channel.attachmentId,
        attachmentDurationMs: channel.attachmentDurationMs,
    };
}

/** Removes mentions, pins and poll data that belong to a deleted message. */
export async function deleteMessageSideData(scope: "direct" | "channel", messageId: string) {
    const polls = await db.select({ id: messagePoll.id }).from(messagePoll)
        .where(and(eq(messagePoll.scope, scope), eq(messagePoll.messageId, messageId)));
    const pollIds = polls.map(poll => poll.id);
    if (pollIds.length > 0) {
        await db.delete(messagePollVote).where(inArray(messagePollVote.pollId, pollIds));
        await db.delete(messagePollOption).where(inArray(messagePollOption.pollId, pollIds));
        await db.delete(messagePoll).where(inArray(messagePoll.id, pollIds));
    }
    await db.delete(messageMention).where(and(eq(messageMention.scope, scope), eq(messageMention.messageId, messageId)));
    await db.delete(messagePin).where(and(eq(messagePin.scope, scope), eq(messagePin.messageId, messageId)));
}

export function expiresAtFrom(seconds: number | null) {
    if (!seconds) return null;
    return new Date(Date.now() + seconds * 1000);
}

export type { MessageLocationInput };
