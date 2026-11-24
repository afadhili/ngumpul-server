import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../db/index";
import { attachment } from "../db/schema/attachment";
import { channelMessage } from "../db/schema/channel-message";
import { directMessage } from "../db/schema/direct-message";
import type { ChannelAccess } from "../lib/channel-access";
import { isServerManager } from "../lib/channel-access";
import { isUniqueViolation } from "../lib/db-errors";
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
import { sendNotification } from "./notification.service";
import { publishChatMessage as publishChat } from "./realtime.service";
import { getServerMemberIds } from "./server-event.service";

export type CreateDirectResult =
    | { ok: true; message: DirectMessageRecord; replyTo: DirectMessageRecord | null }
    | { ok: false; status: 400 | 403 | 404 | 409; error: string };

export type CreateChannelResult =
    | { ok: true; message: ChannelMessageRecord; replyTo: ChannelMessageRecord | null }
    | { ok: false; status: 400 | 403 | 404 | 409; error: string };

function summarizeNotificationBody(text: string | null) {
    if (!text) return "Mengirim lampiran";
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

type ForwardedContent =
    | { ok: true; text: string | null; location: MessageLocationInput | null; attachmentDurationMs: number | null }
    | { ok: false; status: 400 | 404; error: string };

async function resolveForwardedContent(
    userId: string,
    input: MessageInput,
    text: string | null,
): Promise<ForwardedContent> {
    if (!input.forwardedFromId) {
        return { ok: true as const, text, location: input.location, attachmentDurationMs: input.attachmentDurationMs };
    }
    const source = await resolveForwardSource(userId, input.forwardedFromId);
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
): Promise<CreateDirectResult> {
    if (input.attachmentId) {
        const [item] = await db.select({ id: attachment.id }).from(attachment).where(and(
            eq(attachment.id, input.attachmentId),
            eq(attachment.uploaderId, userId),
            eq(attachment.targetType, "direct"),
            eq(attachment.targetId, peerId),
            eq(attachment.status, "ready"),
        )).limit(1);
        if (!item) return { ok: false, status: 404, error: "Ready attachment not found for this conversation" };
    }

    let replyTo: DirectMessageRecord | null = null;
    if (input.replyToMessageId) {
        const [parent] = await db.select().from(directMessage).where(and(
            eq(directMessage.id, input.replyToMessageId),
            or(
                and(eq(directMessage.senderId, userId), eq(directMessage.recipientId, peerId)),
                and(eq(directMessage.senderId, peerId), eq(directMessage.recipientId, userId)),
            ),
        )).limit(1);
        if (!parent) return { ok: false, status: 404, error: "Reply target not found in this conversation" };
        replyTo = toDirectRecord(parent, metaFor(await loadDirectMessageMeta([parent], userId), parent.id));
    }

    const forwarded = await resolveForwardedContent(userId, input, input.text);
    if (!forwarded.ok) return forwarded;

    const preferenceSeconds = await disappearingSecondsFor(userId, "direct", peerId);
    const expiresAt = expiresAtFrom(input.expiresInSeconds ?? preferenceSeconds);

    const [row] = await db.insert(directMessage).values({
        id: randomUUID(),
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
    }).returning();

    if (input.poll) await createPollForMessage("direct", row.id, input.poll, userId);
    const mentionIds = await saveMentions({
        scope: "direct",
        messageId: row.id,
        mentionerId: userId,
        usernames: extractMentionUsernames(forwarded.text),
        allowedUserIds: new Set([peerId]),
    });

    const message = toDirectRecord(row, metaFor(await loadDirectMessageMeta([row], userId), row.id));
    await emitDirectMessage("created", message);

    const peerPreference = await getConversationPreference(peerId, "direct", userId);
    if (allowsNotification(peerPreference, mentionIds.length > 0)) {
        await sendNotification({
            recipients: [peerId],
            kind: mentionIds.length > 0 ? "mention" : "direct_message",
            title: mentionIds.length > 0 ? "Anda disebut dalam pesan" : "Pesan langsung baru",
            body: summarizeNotificationBody(forwarded.text),
            messageId: message.id,
            actorId: userId,
        });
    }
    return { ok: true, message, replyTo };
}

export async function createChannelMessage(
    userId: string,
    access: ChannelAccess,
    input: MessageInput,
    options: { isAnnouncement?: boolean } = {},
): Promise<CreateChannelResult> {
    const channelId = access.channelId;
    const isAnnouncement = options.isAnnouncement === true;
    if (isAnnouncement && !isServerManager(access.role)) {
        return { ok: false, status: 403, error: "Only server administrators can post announcements" };
    }

    if (input.attachmentId) {
        const [item] = await db.select({ id: attachment.id }).from(attachment).where(and(
            eq(attachment.id, input.attachmentId),
            eq(attachment.uploaderId, userId),
            eq(attachment.targetType, "channel"),
            eq(attachment.targetId, channelId),
            eq(attachment.status, "ready"),
        )).limit(1);
        if (!item) return { ok: false, status: 404, error: "Ready attachment not found for this channel" };
    }

    let replyTo: ChannelMessageRecord | null = null;
    if (input.replyToMessageId) {
        const [parent] = await db.select().from(channelMessage).where(and(
            eq(channelMessage.id, input.replyToMessageId),
            eq(channelMessage.channelId, channelId),
        )).limit(1);
        if (!parent) return { ok: false, status: 404, error: "Reply target not found in this channel" };
        replyTo = toChannelRecord(parent, metaFor(await loadChannelMessageMeta([parent], userId), parent.id));
    }

    const forwarded = await resolveForwardedContent(userId, input, input.text);
    if (!forwarded.ok) return forwarded;

    const preferenceSeconds = await disappearingSecondsFor(userId, "channel", channelId);
    const expiresAt = expiresAtFrom(input.expiresInSeconds ?? preferenceSeconds);

    let row: typeof channelMessage.$inferSelect;
    try {
        [row] = await db.insert(channelMessage).values({
            id: randomUUID(),
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
        }).returning();
    } catch (error) {
        if (isUniqueViolation(error)) {
            return { ok: false, status: 409, error: "Attachment is already attached to a message" };
        }
        throw error;
    }

    if (input.poll) await createPollForMessage("channel", row.id, input.poll, userId);
    const memberIds = (await getServerMemberIds(access.serverId)).filter(id => id !== userId);
    const mentionIds = await saveMentions({
        scope: "channel",
        messageId: row.id,
        mentionerId: userId,
        channelId,
        usernames: extractMentionUsernames(forwarded.text),
        allowedUserIds: new Set(memberIds),
    });

    const message = toChannelRecord(row, metaFor(await loadChannelMessageMeta([row], userId), row.id));
    await emitChannelMessage("created", access.serverId, message);

    if (memberIds.length > 0) {
        const preferences = await loadPreferencesForTarget("channel", channelId, memberIds);
        const mentioned = new Set(mentionIds);
        const mentionRecipients = mentionIds.filter(id => memberIds.includes(id)
            && allowsNotification(preferences.get(id) ?? null, true));
        const generic = memberIds.filter(id => !mentioned.has(id)
            && allowsNotification(preferences.get(id) ?? null, false));
        if (mentionRecipients.length > 0) {
            await sendNotification({
                recipients: mentionRecipients,
                kind: "mention",
                title: "Anda disebut dalam pesan",
                body: summarizeNotificationBody(forwarded.text),
                serverId: access.serverId,
                channelId,
                messageId: message.id,
                actorId: userId,
            });
        }
        if (isAnnouncement) {
            const announcementRecipients = memberIds.filter(id => allowsNotification(preferences.get(id) ?? null, true));
            if (announcementRecipients.length > 0) {
                await sendNotification({
                    recipients: announcementRecipients,
                    kind: "announcement",
                    title: "Pengumuman server",
                    body: summarizeNotificationBody(forwarded.text),
                    serverId: access.serverId,
                    channelId,
                    messageId: message.id,
                    actorId: userId,
                });
            }
        } else if (generic.length > 0) {
            await sendNotification({
                recipients: generic,
                kind: "channel_message",
                title: "Pesan channel baru",
                body: summarizeNotificationBody(forwarded.text),
                serverId: access.serverId,
                channelId,
                messageId: message.id,
                actorId: userId,
            });
        }
    }
    return { ok: true, message, replyTo };
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
