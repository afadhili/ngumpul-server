import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, type DbExecutor, type DbTransaction } from "../db/index";
import { attachment } from "../db/schema/attachment";
import { channelMessage } from "../db/schema/channel-message";
import { directMessage } from "../db/schema/direct-message";
import type { ChannelAccess } from "../lib/channel-access";
import { isServerManager } from "../lib/channel-access";
import { extractMentionUsernames } from "../lib/mentions";
import type { MessageInput, MessageLocationInput } from "../lib/message-input";
import type { ChannelMessageRecord, DirectMessageRecord } from "../models/chat-message";
import {
    allowsNotification,
    disappearingSecondsFor,
    getConversationPreference,
    loadPreferencesForTarget,
} from "./conversation-preference.service";
import { loadChannelMessageMeta, loadDirectMessageMeta, metaFor } from "./message-meta.service";
import {
    createPollForMessage,
    expiresAtFrom,
    resolveForwardSource,
    saveMentions,
} from "./message-support.service";
import { persistNotifications, publishNotifications } from "./notification.service";
import { publishChatMessage as publishChat } from "./realtime.service";
import { getServerMemberIds } from "./server-event.service";
import { lockMessageSubmission, messageSubmissionKey, recordMessageSubmission } from "./message-submission.service";

type MessageResult<Message> =
    | { ok: true; message: Message; replyTo: Message | null }
    | { ok: false; status: 400 | 403 | 404 | 409; error: string };

type StoredMessage<Message> =
    | (Extract<MessageResult<Message>, { ok: true }> & { publish?: () => Promise<void> })
    | Extract<MessageResult<Message>, { ok: false }>;

type StoreOptions = { messageId?: string; isAnnouncement?: boolean };

async function publishStoredMessage<Message>(result: StoredMessage<Message>): Promise<MessageResult<Message>> {
    if (!result.ok) return result;
    const { publish, ...response } = result;
    await publish?.();
    return response;
}

function validPollDeadline(input: MessageInput) {
    const closesAt = input.poll?.closesAt?.getTime();
    const now = Date.now();
    return closesAt === undefined || (closesAt > now && closesAt <= now + 90 * 24 * 60 * 60 * 1_000);
}

function summarizeNotificationBody(text: string | null) {
    if (!text) return "Mengirim lampiran";
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

type ForwardedContent =
    | { ok: true; text: string | null; location: MessageLocationInput | null; attachmentDurationMs: number | null }
    | { ok: false; status: 400 | 404; error: string };

async function resolveForwardedContent(
    executor: DbExecutor,
    userId: string,
    input: MessageInput,
    text: string | null,
): Promise<ForwardedContent> {
    if (!input.forwardedFromId) {
        return { ok: true as const, text, location: input.location, attachmentDurationMs: input.attachmentDurationMs };
    }
    const source = await resolveForwardSource(userId, input.forwardedFromId, executor);
    if (!source) return { ok: false as const, status: 404, error: "Forwarded message not found" };
    if (source.attachmentId) {
        return { ok: false as const, status: 400, error: "Messages with attachments cannot be forwarded" };
    }
    if (!source.text && !source.location) {
        return { ok: false as const, status: 400, error: "Forwarded message has no content to forward" };
    }
    return {
        ok: true as const,
        text: source.text,
        location: source.location,
        attachmentDurationMs: source.attachmentDurationMs,
    };
}

export async function createDirectMessage(
    userId: string,
    peerId: string,
    input: MessageInput,
): Promise<MessageResult<DirectMessageRecord>> {
    return publishStoredMessage(await db.transaction(tx => storeDirectMessage(tx, userId, peerId, input)));
}

export async function storeDirectMessage(
    executor: DbTransaction,
    userId: string,
    peerId: string,
    input: MessageInput,
    { messageId = randomUUID() }: StoreOptions = {},
): Promise<StoredMessage<DirectMessageRecord>> {
    const key = messageSubmissionKey(userId, "direct", peerId, input);
    const previous = key && await lockMessageSubmission(executor, key);
    if (previous && key) {
        if (previous.requestHash !== key.requestHash) return conflictingSubmission();
        const [row] = await executor.select().from(directMessage).where(and(
            eq(directMessage.id, previous.messageId),
            eq(directMessage.senderId, userId),
            eq(directMessage.recipientId, peerId),
        )).limit(1);
        if (!row || row.deletedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
            return unavailableSubmission();
        }
        const message = toDirectRecord(row, metaFor(await loadDirectMessageMeta([row], userId, executor), row.id));
        const replyTo = await getDirectReply(executor, userId, peerId, row.replyToMessageId);
        return { ok: true, message, replyTo };
    }
    if (!validPollDeadline(input)) return invalidPollDeadline();

    if (input.attachmentId) {
        const [item] = await executor.select({ id: attachment.id }).from(attachment).where(and(
            eq(attachment.id, input.attachmentId),
            eq(attachment.uploaderId, userId),
            eq(attachment.targetType, "direct"),
            eq(attachment.targetId, peerId),
            eq(attachment.status, "ready"),
        )).limit(1);
        if (!item) return { ok: false, status: 404, error: "Ready attachment not found for this conversation" };
    }

    const replyTo = await getDirectReply(executor, userId, peerId, input.replyToMessageId);
    if (input.replyToMessageId && !replyTo) {
        return { ok: false, status: 404, error: "Reply target not found in this conversation" };
    }

    const forwarded = await resolveForwardedContent(executor, userId, input, input.text);
    if (!forwarded.ok) return forwarded;

    const preferenceSeconds = await disappearingSecondsFor(userId, "direct", peerId, executor);
    const expiresAt = expiresAtFrom(input.expiresInSeconds ?? preferenceSeconds);

    const [row] = await executor.insert(directMessage).values({
        id: messageId,
        senderId: userId,
        recipientId: peerId,
        text: forwarded.text,
        attachmentId: input.attachmentId,
        replyToMessageId: input.replyToMessageId,
        forwardedFromId: input.forwardedFromId,
        locationLat: forwarded.location?.lat ?? null,
        locationLng: forwarded.location?.lng ?? null,
        locationLabel: forwarded.location?.label ?? null,
        attachmentDurationMs: forwarded.attachmentDurationMs,
        expiresAt,
        encrypted: input.encrypted,
        hasPoll: Boolean(input.poll),
    }).onConflictDoNothing().returning();
    if (!row) return messageConflict();

    if (input.poll) await createPollForMessage("direct", row.id, input.poll, userId, executor);
    const mentionIds = await saveMentions({
        scope: "direct",
        messageId: row.id,
        mentionerId: userId,
        usernames: extractMentionUsernames(forwarded.text),
        allowedUserIds: new Set([peerId]),
    }, executor);

    const message = toDirectRecord(row, metaFor(await loadDirectMessageMeta([row], userId, executor), row.id));
    const peerPreference = await getConversationPreference(peerId, "direct", userId, executor);
    const notifications = allowsNotification(peerPreference, mentionIds.length > 0)
        ? await persistNotifications(executor, {
            recipients: [peerId],
            kind: mentionIds.length > 0 ? "mention" : "direct_message",
            title: mentionIds.length > 0 ? "Anda disebut dalam pesan" : "Pesan langsung baru",
            body: summarizeNotificationBody(forwarded.text),
            messageId: message.id,
            actorId: userId,
        }) : [];
    if (key) await recordMessageSubmission(executor, key, row.id);
    return {
        ok: true,
        message,
        replyTo,
        publish: async () => {
            await Promise.all([emitDirectMessage("created", message), publishNotifications(notifications)]);
        },
    };
}

export async function createChannelMessage(
    userId: string,
    access: ChannelAccess,
    input: MessageInput,
    options: { isAnnouncement?: boolean } = {},
): Promise<MessageResult<ChannelMessageRecord>> {
    return publishStoredMessage(await db.transaction(tx => storeChannelMessage(tx, userId, access, input, options)));
}

export async function storeChannelMessage(
    executor: DbTransaction,
    userId: string,
    access: ChannelAccess,
    input: MessageInput,
    { messageId = randomUUID(), isAnnouncement = false }: StoreOptions = {},
): Promise<StoredMessage<ChannelMessageRecord>> {
    const channelId = access.channelId;
    if (isAnnouncement && !isServerManager(access.role)) {
        return { ok: false, status: 403, error: "Only server administrators can post announcements" };
    }

    const key = messageSubmissionKey(userId, "channel", channelId, input, isAnnouncement);
    const previous = key && await lockMessageSubmission(executor, key);
    if (previous && key) {
        if (previous.requestHash !== key.requestHash) return conflictingSubmission();
        const [row] = await executor.select().from(channelMessage).where(and(
            eq(channelMessage.id, previous.messageId),
            eq(channelMessage.senderId, userId),
            eq(channelMessage.channelId, channelId),
        )).limit(1);
        if (!row || row.deletedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
            return unavailableSubmission();
        }
        const message = toChannelRecord(row, metaFor(await loadChannelMessageMeta([row], userId, executor), row.id));
        const replyTo = await getChannelReply(executor, userId, channelId, row.replyToMessageId);
        return { ok: true, message, replyTo };
    }
    if (!validPollDeadline(input)) return invalidPollDeadline();

    if (input.attachmentId) {
        const [item] = await executor.select({ id: attachment.id }).from(attachment).where(and(
            eq(attachment.id, input.attachmentId),
            eq(attachment.uploaderId, userId),
            eq(attachment.targetType, "channel"),
            eq(attachment.targetId, channelId),
            eq(attachment.status, "ready"),
        )).limit(1);
        if (!item) return { ok: false, status: 404, error: "Ready attachment not found for this channel" };
    }

    const replyTo = await getChannelReply(executor, userId, channelId, input.replyToMessageId);
    if (input.replyToMessageId && !replyTo) {
        return { ok: false, status: 404, error: "Reply target not found in this channel" };
    }

    const forwarded = await resolveForwardedContent(executor, userId, input, input.text);
    if (!forwarded.ok) return forwarded;

    const preferenceSeconds = await disappearingSecondsFor(userId, "channel", channelId, executor);
    const expiresAt = expiresAtFrom(input.expiresInSeconds ?? preferenceSeconds);

    const [row] = await executor.insert(channelMessage).values({
        id: messageId,
        channelId,
        senderId: userId,
        text: forwarded.text,
        attachmentId: input.attachmentId,
        replyToMessageId: input.replyToMessageId,
        forwardedFromId: input.forwardedFromId,
        locationLat: forwarded.location?.lat ?? null,
        locationLng: forwarded.location?.lng ?? null,
        locationLabel: forwarded.location?.label ?? null,
        attachmentDurationMs: forwarded.attachmentDurationMs,
        expiresAt,
        encrypted: input.encrypted,
        hasPoll: Boolean(input.poll),
        isAnnouncement,
    }).onConflictDoNothing().returning();
    if (!row) return messageConflict();

    if (input.poll) await createPollForMessage("channel", row.id, input.poll, userId, executor);
    const memberIds = (await getServerMemberIds(access.serverId, executor)).filter(id => id !== userId);
    const mentionIds = await saveMentions({
        scope: "channel",
        messageId: row.id,
        mentionerId: userId,
        channelId,
        usernames: extractMentionUsernames(forwarded.text),
        allowedUserIds: new Set(memberIds),
    }, executor);

    const message = toChannelRecord(row, metaFor(await loadChannelMessageMeta([row], userId, executor), row.id));
    const notifications: Awaited<ReturnType<typeof persistNotifications>> = [];

    if (memberIds.length > 0) {
        const preferences = await loadPreferencesForTarget("channel", channelId, memberIds, executor);
        const mentioned = new Set(mentionIds);
        const mentionRecipients = mentionIds.filter(id => memberIds.includes(id)
            && allowsNotification(preferences.get(id) ?? null, true));
        const generic = memberIds.filter(id => !mentioned.has(id)
            && allowsNotification(preferences.get(id) ?? null, false));
        if (mentionRecipients.length > 0) {
            notifications.push(...await persistNotifications(executor, {
                recipients: mentionRecipients,
                kind: "mention",
                title: "Anda disebut dalam pesan",
                body: summarizeNotificationBody(forwarded.text),
                serverId: access.serverId,
                channelId,
                messageId: message.id,
                actorId: userId,
            }));
        }
        if (isAnnouncement) {
            const announcementRecipients = memberIds.filter(id => allowsNotification(preferences.get(id) ?? null, true));
            if (announcementRecipients.length > 0) {
                notifications.push(...await persistNotifications(executor, {
                    recipients: announcementRecipients,
                    kind: "announcement",
                    title: "Pengumuman server",
                    body: summarizeNotificationBody(forwarded.text),
                    serverId: access.serverId,
                    channelId,
                    messageId: message.id,
                    actorId: userId,
                }));
            }
        } else if (generic.length > 0) {
            notifications.push(...await persistNotifications(executor, {
                recipients: generic,
                kind: "channel_message",
                title: "Pesan channel baru",
                body: summarizeNotificationBody(forwarded.text),
                serverId: access.serverId,
                channelId,
                messageId: message.id,
                actorId: userId,
            }));
        }
    }
    if (key) await recordMessageSubmission(executor, key, row.id);
    return {
        ok: true,
        message,
        replyTo,
        publish: async () => {
            await Promise.all([emitChannelMessage("created", access.serverId, message), publishNotifications(notifications)]);
        },
    };
}

async function getDirectReply(executor: DbExecutor, userId: string, peerId: string, messageId: string | null) {
    if (!messageId) return null;
    const [parent] = await executor.select().from(directMessage).where(and(
        eq(directMessage.id, messageId),
        or(
            and(eq(directMessage.senderId, userId), eq(directMessage.recipientId, peerId)),
            and(eq(directMessage.senderId, peerId), eq(directMessage.recipientId, userId)),
        ),
    )).limit(1);
    return parent ? toDirectRecord(parent, metaFor(await loadDirectMessageMeta([parent], userId, executor), parent.id)) : null;
}

async function getChannelReply(executor: DbExecutor, userId: string, channelId: string, messageId: string | null) {
    if (!messageId) return null;
    const [parent] = await executor.select().from(channelMessage).where(and(
        eq(channelMessage.id, messageId),
        eq(channelMessage.channelId, channelId),
    )).limit(1);
    return parent ? toChannelRecord(parent, metaFor(await loadChannelMessageMeta([parent], userId, executor), parent.id)) : null;
}

function conflictingSubmission() {
    return { ok: false, status: 409, error: "clientMessageId was already used with a different payload" } as const;
}

function unavailableSubmission() {
    return { ok: false, status: 409, error: "The message for this clientMessageId is no longer available" } as const;
}

function messageConflict() {
    return { ok: false, status: 409, error: "The message or attachment has already been used" } as const;
}

function invalidPollDeadline() {
    return { ok: false, status: 400, error: "poll.closesAt must be in the future and within 90 days" } as const;
}

export function toDirectRecord(row: typeof directMessage.$inferSelect, meta: import("./message-meta.service").MessageMeta): DirectMessageRecord {
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
        forwardedFromId: row.forwardedFromId,
        location: row.locationLat !== null && row.locationLng !== null
            ? { lat: row.locationLat, lng: row.locationLng, label: row.locationLabel }
            : null,
        attachmentDurationMs: row.attachmentDurationMs,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        encrypted: row.encrypted,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        reactions: meta.reactions,
        mentions: meta.mentions,
        poll: meta.poll,
        pinned: meta.pinned,
    };
}

export function toChannelRecord(row: typeof channelMessage.$inferSelect, meta: import("./message-meta.service").MessageMeta): ChannelMessageRecord {
    return {
        id: row.id,
        channelId: row.channelId,
        senderId: row.senderId,
        text: row.text,
        attachmentId: row.attachmentId,
        replyToMessageId: row.replyToMessageId,
        editedAt: row.editedAt?.toISOString() ?? null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        forwardedFromId: row.forwardedFromId,
        location: row.locationLat !== null && row.locationLng !== null
            ? { lat: row.locationLat, lng: row.locationLng, label: row.locationLabel }
            : null,
        attachmentDurationMs: row.attachmentDurationMs,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        encrypted: row.encrypted,
        isAnnouncement: row.isAnnouncement,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        reactions: meta.reactions,
        mentions: meta.mentions,
        poll: meta.poll,
        pinned: meta.pinned,
    };
}

export async function emitDirectMessage(
    event: "created" | "updated" | "deleted" | "receipt",
    message: DirectMessageRecord,
) {
    try {
        await publishChat({
            type: "direct_message",
            event,
            senderId: message.senderId,
            recipientId: message.recipientId,
            message,
        });
    } catch (error) {
        console.error("Unable to publish direct message event:", error);
    }
}

export async function emitChannelMessage(
    event: "created" | "updated" | "deleted",
    serverId: string,
    message: ChannelMessageRecord,
) {
    try {
        await publishChat({
            type: "channel_message",
            event,
            serverId,
            channelId: message.channelId,
            message,
        });
    } catch (error) {
        console.error("Unable to publish channel message event:", error);
    }
}
