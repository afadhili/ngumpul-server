export type ReactionSummary = {
    emoji: string;
    count: number;
    userIds: string[];
};

export type PollOptionSummary = {
    id: string;
    label: string;
    position: number;
    votes: number;
    votedByMe: boolean;
};

export type PollSummary = {
    id: string;
    messageId: string;
    question: string;
    allowMultiple: boolean;
    anonymous: boolean;
    closesAt: string | null;
    closedAt: string | null;
    totalVotes: number;
    options: PollOptionSummary[];
};

export type ServerEventName =
    | "server.created"
    | "server.updated"
    | "server.deleted"
    | "server.channel_created"
    | "server.channel_updated"
    | "server.channel_deleted"
    | "server.member_added"
    | "server.member_updated"
    | "server.member_removed"
    | "server.invite_created";

export type ServerSummary = {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    ownerId: string;
    createdAt: string;
    updatedAt: string;
};

export type ChannelSummary = {
    id: string;
    serverId: string;
    name: string;
    description: string | null;
    kind: "text" | "voice";
    position: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
};

export type MemberSummary = {
    userId: string;
    username?: string | null;
    displayName?: string | null;
    role: "owner" | "admin" | "member";
    joinedAt?: string;
};

export type ServerEvent = {
    type: "server_event";
    event: ServerEventName;
    serverId: string;
    actorId: string;
    server?: ServerSummary;
    channel?: ChannelSummary;
    member?: MemberSummary;
    createdAt: string;
};

export type NotificationKind =
    | "direct_message"
    | "channel_message"
    | "reaction"
    | "server_added"
    | "member_joined"
    | "mention"
    | "poll"
    | "announcement"
    | "scheduled_message"
    | "friend_request";

export type NotificationEvent = {
    type: "notification";
    notification: {
        id: string;
        kind: NotificationKind;
        title: string;
        body: string;
        serverId?: string;
        channelId?: string;
        messageId?: string;
        actorId?: string;
        createdAt: string;
    };
};

export type MessageReactionEvent = {
    type: "message_reaction";
    event: "added" | "removed";
    scope: "direct" | "channel";
    messageId: string;
    userId: string;
    emoji: string;
    reactions: ReactionSummary[];
    createdAt: string;
    serverId?: string;
    channelId?: string;
    senderId?: string;
    recipientId?: string;
};

export type TypingEvent = {
    type: "typing";
    scope: "direct" | "channel";
    userId: string;
    peerId?: string;
    serverId?: string;
    channelId?: string;
    expiresAt: string;
};

export type PresenceEvent = {
    type: "presence";
    userId: string;
    status: "online" | "away" | "offline";
    lastSeenAt: string | null;
    updatedAt: string;
};

export type ReadStateEvent = {
    type: "read_state";
    scope: "direct" | "channel";
    userId: string;
    lastReadMessageId: string | null;
    lastReadAt: string;
    markedUnread: boolean;
    peerId?: string;
    serverId?: string;
    channelId?: string;
};

export type PollEvent = {
    type: "poll_event";
    event: "created" | "voted" | "closed";
    scope: "direct" | "channel";
    messageId: string;
    poll: PollSummary;
    actorId: string;
    peerId?: string;
    serverId?: string;
    channelId?: string;
};

export type PinEvent = {
    type: "pin_event";
    event: "pinned" | "unpinned";
    scope: "direct" | "channel";
    messageId: string;
    actorId: string;
    pinnedAt: string | null;
    peerId?: string;
    serverId?: string;
    channelId?: string;
};

export type ScheduledMessageSummary = {
    id: string;
    scope: "direct" | "channel";
    targetId: string;
    text: string | null;
    replyToMessageId: string | null;
    attachmentId: string | null;
    scheduledFor: string;
    status: "pending" | "sent" | "canceled" | "failed";
    sentMessageId: string | null;
    failureReason: string | null;
    createdAt: string;
};

export type ScheduledMessageEvent = {
    type: "scheduled_message";
    event: "created" | "updated" | "canceled" | "sent" | "failed";
    scheduled: ScheduledMessageSummary;
};

export type RealtimeEvent =
    | ServerEvent
    | NotificationEvent
    | MessageReactionEvent
    | TypingEvent
    | PresenceEvent
    | ReadStateEvent
    | PollEvent
    | PinEvent
    | ScheduledMessageEvent;

export function isRealtimeEvent(value: unknown): value is RealtimeEvent {
    if (typeof value !== "object" || value === null) return false;
    const event = value as Record<string, unknown>;
    if (event.type === "server_event") {
        return typeof event.event === "string"
            && typeof event.serverId === "string"
            && typeof event.actorId === "string"
            && typeof event.createdAt === "string";
    }
    if (event.type === "notification") {
        const notification = event.notification;
        if (typeof notification !== "object" || notification === null) return false;
        const item = notification as Record<string, unknown>;
        return typeof item.id === "string"
            && typeof item.kind === "string"
            && typeof item.title === "string"
            && typeof item.body === "string"
            && typeof item.createdAt === "string";
    }
    if (event.type === "message_reaction") {
        return (event.scope === "direct" || event.scope === "channel")
            && (event.event === "added" || event.event === "removed")
            && typeof event.messageId === "string"
            && typeof event.userId === "string"
            && typeof event.emoji === "string"
            && Array.isArray(event.reactions);
    }
    if (event.type === "typing") {
        return (event.scope === "direct" || event.scope === "channel")
            && typeof event.userId === "string"
            && typeof event.expiresAt === "string";
    }
    if (event.type === "presence") {
        return typeof event.userId === "string"
            && (event.status === "online" || event.status === "away" || event.status === "offline")
            && typeof event.updatedAt === "string";
    }
    if (event.type === "read_state") {
        return (event.scope === "direct" || event.scope === "channel")
            && typeof event.userId === "string"
            && typeof event.lastReadAt === "string";
    }
    if (event.type === "poll_event") {
        return typeof event.messageId === "string"
            && typeof event.actorId === "string"
            && typeof event.poll === "object"
            && event.poll !== null;
    }
    if (event.type === "pin_event") {
        return (event.scope === "direct" || event.scope === "channel")
            && (event.event === "pinned" || event.event === "unpinned")
            && typeof event.messageId === "string"
            && typeof event.actorId === "string";
    }
    if (event.type === "scheduled_message") {
        return typeof event.scheduled === "object" && event.scheduled !== null;
    }
    return false;
}
