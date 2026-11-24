import type { PollSummary } from "./realtime-event";

export type MessageReaction = {
    emoji: string;
    count: number;
    userIds: string[];
    me: boolean;
};

export type MessageLocation = {
    lat: number;
    lng: number;
    label: string | null;
};

export type MessageMention = {
    userId: string;
    username: string | null;
};

export type DirectMessageRecord = {
    id: string;
    senderId: string;
    recipientId: string;
    text: string | null;
    attachmentId: string | null;
    replyToMessageId: string | null;
    status: "sent" | "delivered" | "read";
    deliveredAt: string | null;
    readAt: string | null;
    editedAt: string | null;
    deletedAt: string | null;
    forwardedFromId: string | null;
    location: MessageLocation | null;
    attachmentDurationMs: number | null;
    expiresAt: string | null;
    encrypted: boolean;
    createdAt: string;
    updatedAt: string;
    reactions: MessageReaction[];
    mentions: MessageMention[];
    poll: PollSummary | null;
    pinned: boolean;
};

export type DirectMessageEvent = {
    type: "direct_message";
    event: "created" | "updated" | "deleted" | "receipt";
    senderId: string;
    recipientId: string;
    message: DirectMessageRecord;
};

export type ChannelMessageRecord = {
    id: string;
    channelId: string;
    senderId: string;
    text: string | null;
    attachmentId: string | null;
    replyToMessageId: string | null;
    editedAt: string | null;
    deletedAt: string | null;
    forwardedFromId: string | null;
    location: MessageLocation | null;
    attachmentDurationMs: number | null;
    expiresAt: string | null;
    encrypted: boolean;
    isAnnouncement: boolean;
    createdAt: string;
    updatedAt: string;
    reactions: MessageReaction[];
    mentions: MessageMention[];
    poll: PollSummary | null;
    pinned: boolean;
};

export type ChannelMessageEvent = {
    type: "channel_message";
    event: "created" | "updated" | "deleted";
    serverId: string;
    channelId: string;
    message: ChannelMessageRecord;
};

export type ChatMessage = DirectMessageEvent | ChannelMessageEvent;

export function isChatMessage(value: unknown): value is ChatMessage {
    if (typeof value !== "object" || value === null) return false;
    const message = value as Record<string, unknown>;

    if (message.type === "direct_message" && (message.event === "created" || message.event === "updated" || message.event === "deleted" || message.event === "receipt")) {
        const record = message.message;
        if (typeof record !== "object" || record === null) return false;
        const direct = record as Record<string, unknown>;
        return typeof message.senderId === "string"
            && typeof message.recipientId === "string"
            && typeof direct.id === "string"
            && typeof direct.status === "string"
            && Array.isArray(direct.reactions);
    }

    if (message.type === "channel_message" && (message.event === "created" || message.event === "updated" || message.event === "deleted")) {
        const record = message.message;
        if (typeof record !== "object" || record === null) return false;
        const channel = record as Record<string, unknown>;
        return typeof message.serverId === "string"
            && typeof message.channelId === "string"
            && typeof channel.id === "string"
            && typeof channel.channelId === "string"
            && channel.channelId === message.channelId
            && Array.isArray(channel.reactions);
    }

    return false;
}
