import { attachmentPolicies } from "../models/attachment-policy";
import { array, boolean, choice, dateTime, integer, nullable, object, query, string, text, uri } from "./describe";
import type { Schema } from "./describe";

export const id = text(1, 128);
export const scope = choice("direct", "channel");
export const channelKind = choice("text", "voice");
export const memberRole = choice("owner", "admin", "member");
export const visibility = choice("everyone", "friends", "nobody");
export const presenceStatus = choice("online", "away", "offline");
export const scheduledStatus = choice("pending", "sent", "canceled", "failed");
export const receiptStatus = choice("delivered", "read");
export const username = { ...string, pattern: "^[A-Za-z0-9_]{3,24}$", example: "alice" };
export const historyQuery = [
    query("limit", { ...integer(1, 100), default: 50 }),
    query("before", id, false, "Gunakan nextCursor dari respons sebelumnya untuk mengambil pesan lebih lama."),
];
export const searchQuery = [
    query("q", text(1, 200), true),
    query("senderId", id),
    query("before", dateTime),
    query("after", dateTime),
    query("hasAttachment", boolean),
    query("limit", { ...integer(1, 50), default: 25 }),
];
export const deleteScopeQuery = [
    query("scope", choice("me", "everyone"), true, "Sembunyikan bagi akun ini atau hapus bagi semua."),
];

export const privacyFields = {
    photoVisibility: visibility,
    onlineStatusVisibility: visibility,
    lastSeenVisibility: visibility,
};

export const profileInput = object(
    {
        username,
        displayName: nullable(text(0, 60)),
        bio: nullable(text(0, 500)),
        avatar: nullable({ type: "string", format: "uri", maxLength: 2048 }),
        isPublic: boolean,
    },
    ["username"],
);

const profileFields = {
    username: nullable(string),
    displayName: nullable(string),
    bio: nullable(string),
    avatar: nullable(uri),
    banner: nullable(uri),
    location: nullable(string),
    website: nullable(string),
    pronouns: nullable(string),
};
export const profile = object({
    ...profileFields,
    isPublic: nullable(boolean),
    photoVisibility: nullable(visibility),
    onlineStatusVisibility: nullable(visibility),
    lastSeenVisibility: nullable(visibility),
});
export const savedProfile = object({
    ...profileFields,
    ...privacyFields,
    isPublic: boolean,
    id,
    userId: id,
    createdAt: dateTime,
    updatedAt: dateTime,
});

export const account = object(
    {
        id,
        name: string,
        email: { type: "string", format: "email" },
        username: nullable(string),
        emailVerified: boolean,
        image: nullable(uri),
        createdAt: dateTime,
        updatedAt: dateTime,
    },
    ["id", "name", "email", "emailVerified", "createdAt", "updatedAt"],
);

export const contactFields = {
    userId: id,
    username: nullable(string),
    displayName: nullable(string),
    avatar: nullable(uri),
};
export const contact = object(contactFields);
export const friendRequest = object({
    id,
    requesterId: id,
    recipientId: id,
    status: choice("pending", "accepted", "declined", "canceled"),
    createdAt: dateTime,
    updatedAt: dateTime,
});
export const pendingFriendRequest = object({
    id,
    userId: id,
    username: nullable(string),
    displayName: nullable(string),
    createdAt: dateTime,
});
export const friendQrUser = object({
    id,
    username: nullable(string),
    displayName: nullable(string),
    avatar: nullable(uri),
});

export const locationFields = {
    lat: { type: "number", minimum: -90, maximum: 90 } as const,
    lng: { type: "number", minimum: -180, maximum: 180 } as const,
    label: nullable(text(0, 200)),
};
const pollInput = object(
    {
        question: text(1, 300),
        options: { type: "array", minItems: 2, maxItems: 12, items: text(1, 100) },
        allowMultiple: boolean,
        anonymous: boolean,
        closesAt: nullable(dateTime),
    },
    ["question", "options"],
);

const messageInputFields = {
    text: nullable(text(0, 4000)),
    attachmentId: nullable(id),
    replyToMessageId: nullable(id),
    forwardedFromId: nullable(id),
    location: nullable(object(locationFields, ["lat", "lng"])),
    attachmentDurationMs: nullable(integer(0, 86_400_000)),
    expiresInSeconds: nullable(integer(5, 604_800)),
    encrypted: boolean,
    poll: nullable(pollInput),
};
const requiredMessageContent: Schema[] = [
    { required: ["text"], properties: { text: text(1, 4000) } },
    { required: ["attachmentId"], properties: { attachmentId: id } },
    { required: ["location"], properties: { location: object(locationFields, ["lat", "lng"]) } },
    { required: ["poll"], properties: { poll: pollInput } },
];
export const directMessageInput: Schema = {
    ...object(messageInputFields, []),
    anyOf: requiredMessageContent,
    example: { text: "Halo!" },
    description: "Sertakan minimal satu dari text, attachmentId, location, atau poll.",
};
export const channelMessageInput: Schema = {
    ...object({ ...messageInputFields, isAnnouncement: boolean }, []),
    anyOf: requiredMessageContent,
    example: { text: "Selamat datang di channel ini!" },
    description:
        "Sertakan minimal satu dari text, attachmentId, location, atau poll. Pengumuman memerlukan peran owner atau admin.",
};

export const editMessageInput = object({ text: text(1, 4000) });
export const reactionInput = object({ emoji: text(1, 32) });
export const reactions = object({
    messageId: id,
    reactions: array(object({ emoji: string, count: integer(0), userIds: array(id), me: boolean })),
});
export const pinned = object({ pinned: boolean, messageId: id });

const poll = object({
    id,
    messageId: id,
    question: string,
    allowMultiple: boolean,
    anonymous: boolean,
    closesAt: nullable(dateTime),
    closedAt: nullable(dateTime),
    totalVotes: integer(0),
    options: array(object({ id, label: string, position: integer(0), votes: integer(0), votedByMe: boolean })),
});
const messageFields = {
    id,
    senderId: id,
    text: nullable(string),
    attachmentId: nullable(id),
    replyToMessageId: nullable(id),
    editedAt: nullable(dateTime),
    deletedAt: nullable(dateTime),
    forwardedFromId: nullable(id),
    location: nullable(object(locationFields)),
    attachmentDurationMs: nullable(integer(0)),
    expiresAt: nullable(dateTime),
    encrypted: boolean,
    createdAt: dateTime,
    updatedAt: dateTime,
    pinned: boolean,
    poll: nullable({ $ref: "#/components/schemas/Poll" }),
};
const messageMetadata = {
    reactions: array(object({ emoji: string, count: integer(0), userIds: array(id), me: boolean })),
    mentions: array(object({ userId: id, username: nullable(string) })),
    replyTo: nullable(
        object({ id, senderId: id, text: nullable(string), attachmentId: nullable(id), deletedAt: nullable(dateTime) }),
    ),
};
const directMessageFields = {
    ...messageFields,
    ...messageMetadata,
    recipientId: id,
    status: choice("sent", "delivered", "read"),
    deliveredAt: nullable(dateTime),
    readAt: nullable(dateTime),
};
const channelMessageFields = { ...messageFields, ...messageMetadata, channelId: id, isAnnouncement: boolean };

export const pollResult = object({ poll: { $ref: "#/components/schemas/Poll" } });
export const directMessage = { $ref: "#/components/schemas/DirectMessage" };
export const channelMessage = { $ref: "#/components/schemas/ChannelMessage" };

export const messageComponents = {
    Poll: poll,
    DirectMessage: object(
        directMessageFields,
        Object.keys(directMessageFields).filter(key => key !== "replyTo"),
    ),
    ChannelMessage: object(
        channelMessageFields,
        Object.keys(channelMessageFields).filter(key => key !== "replyTo"),
    ),
} satisfies Record<string, Schema>;

export function messagePage(message: Schema) {
    return object({ messages: array(message), nextCursor: nullable(string) });
}

export const readState = object({
    readState: object({
        channelId: id,
        lastReadMessageId: nullable(id),
        lastReadAt: nullable(dateTime),
        markedUnread: boolean,
    }),
});

const preferenceFields = {
    favorite: boolean,
    archived: boolean,
    markedUnread: boolean,
    mutedUntil: nullable(dateTime),
    notificationLevel: choice("all", "mentions", "none"),
    disappearingSeconds: nullable(integer(5, 604_800)),
    sortOrder: integer(),
};
export const conversationPreference = object({
    scope,
    targetId: string,
    ...preferenceFields,
    updatedAt: nullable(dateTime),
});
export const conversationInput: Schema = {
    ...object({ ...preferenceFields, muteForSeconds: integer(1, 31_536_000) }, []),
    minProperties: 1,
};
export const draft = object({
    scope,
    targetId: string,
    text: string,
    replyToMessageId: nullable(id),
    updatedAt: dateTime,
});
export const scheduledMessage = object({
    id,
    scope,
    targetId: string,
    text: nullable(string),
    attachmentId: nullable(id),
    replyToMessageId: nullable(id),
    status: scheduledStatus,
    scheduledFor: dateTime,
    sentMessageId: nullable(id),
    failureReason: nullable(string),
    createdAt: dateTime,
});
export const scheduledInput: Schema = {
    ...object(
        {
            scope,
            targetId: text(1, 160),
            text: text(1, 4000),
            attachmentId: id,
            replyToMessageId: nullable(id),
            scheduledFor: dateTime,
        },
        ["scope", "targetId", "scheduledFor"],
    ),
    anyOf: [{ required: ["text"] }, { required: ["attachmentId"] }],
    description: "Jadwalkan 5 detik hingga 1 tahun dari sekarang.",
};

export const notification = object({
    id,
    kind: string,
    title: string,
    body: string,
    serverId: nullable(id),
    channelId: nullable(id),
    messageId: nullable(id),
    actorId: nullable(id),
    createdAt: dateTime,
    readAt: nullable(dateTime),
});
export const presence = object({
    userId: id,
    status: presenceStatus,
    lastSeenAt: nullable(dateTime),
    updatedAt: dateTime,
});

const settings: Schema = { type: "object", properties: { presenceVisibility: visibility }, additionalProperties: true };
export const userPreferenceFields = {
    theme: choice("system", "light", "dark"),
    wallpaper: nullable(text(0, 2048)),
    bubbleColor: nullable(text(0, 2048)),
    textSize: choice("small", "medium", "large"),
    chatListSort: choice("recent", "unread", "name"),
    chatListFilter: choice("all", "unread", "favorites", "direct", "groups"),
    notifyDirectMessages: boolean,
    notifyChannels: boolean,
    notifyMentions: boolean,
    settings,
};

const storedRecords = array({ type: "object" });
const archiveFields = {
    version: { type: "integer", const: 1 } as const,
    drafts: storedRecords,
    directMessages: storedRecords,
    channelMessages: storedRecords,
};
export const backup = object(
    {
        ...archiveFields,
        exportedAt: dateTime,
        account: object({
            id,
            name: string,
            username: nullable(string),
            email: string,
            image: nullable(uri),
            createdAt: dateTime,
        }),
        profile: nullable({ type: "object" }),
        preferences: nullable({ type: "object" }),
        conversationPreferences: storedRecords,
        pins: storedRecords,
        scheduledMessages: storedRecords,
        notifications: storedRecords,
        servers: storedRecords,
    },
    ["version", "exportedAt", "drafts", "directMessages", "channelMessages", "servers"],
);
export const backupInput: Schema = {
    ...object(archiveFields, []),
    description: "Gunakan arsip versi 1 dari GET /api/backup. Server mengimpor pesan pribadi, pesan channel, dan draf.",
};

export const attachmentInputFields = {
    targetType: scope,
    targetId: id,
    fileName: text(1, 180),
    mimeType: choice(...attachmentPolicies.keys()),
    sizeBytes: integer(1),
};
export const attachment = object({
    ...attachmentInputFields,
    id,
    uploaderId: id,
    uploadedAt: nullable(dateTime),
    createdAt: dateTime,
    previewUrl: uri,
});

export const serverFields = { id, name: string, description: nullable(string), icon: nullable(uri), ownerId: id };
export const server = object({ ...serverFields, createdAt: dateTime, updatedAt: dateTime });
export const serverInputFields = { name: text(2, 80), description: nullable(text(0, 500)) };
export const channel = object({
    id,
    serverId: id,
    name: string,
    description: nullable(string),
    kind: channelKind,
    position: integer(0),
    createdBy: id,
    createdAt: dateTime,
    updatedAt: dateTime,
});
export const channelInputFields = {
    name: { ...text(1, 100), description: "Nama dinormalisasi ke huruf kecil dan tanda hubung." },
    description: nullable(text(0, 500)),
};
export const member = object({ ...contactFields, role: memberRole, joinedAt: dateTime }, ["userId", "role"]);
export const voiceParticipant = object({
    identity: string,
    name: nullable(string),
    username: nullable(string),
    image: nullable(uri),
    joinedAt: nullable(dateTime),
    isPublisher: boolean,
    audioMuted: boolean,
    videoEnabled: boolean,
    screenShareEnabled: boolean,
    metadata: nullable(string),
});

const searchUser = object({ id, username: nullable(string), name: string, image: nullable(uri) });
export const directMessageSearchResult: Schema = {
    allOf: [directMessage, object({ conversationId: string, peer: nullable(searchUser) })],
};
export const channelMessageSearchResult: Schema = {
    allOf: [channelMessage, object({ serverId: id, channelName: nullable(string), sender: nullable(searchUser) })],
};
