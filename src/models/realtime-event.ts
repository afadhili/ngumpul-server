export type ReactionSummary = {
    emoji: string;
    count: number;
    userIds: string[];
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

export type NotificationEvent = {
    type: "notification";
    notification: {
        id: string;
        kind: "direct_message" | "channel_message" | "reaction" | "server_added" | "member_joined";
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

export type RealtimeEvent = ServerEvent | NotificationEvent | MessageReactionEvent;

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
    return false;
}
