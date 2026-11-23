export type LobbyChatMessage = {
    type: "message";
    id: string;
    room: string;
    text: string;
    sentAt: string;
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
    createdAt: string;
    updatedAt: string;
};

export type DirectMessageEvent = {
    type: "direct_message";
    event: "created" | "updated" | "deleted" | "receipt";
    senderId: string;
    recipientId: string;
    message: DirectMessageRecord;
};

export type ChatMessage = LobbyChatMessage | DirectMessageEvent;

export function parseChatMessage(raw: string, room: string): { text: string } | null {
    try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== "object" || value === null || !("type" in value) || !("text" in value)) {
            return null;
        }

        const message = value as { type: unknown; text: unknown };
        if (message.type !== "message" || typeof message.text !== "string") return null;

        const text = message.text.trim();
        if (!room || room.length > 100 || !text || text.length > 4000) return null;
        return { text };
    } catch {
        return null;
    }
}

export function isChatMessage(value: unknown): value is ChatMessage {
    if (typeof value !== "object" || value === null) return false;
    const message = value as Record<string, unknown>;
    if (message.type === "message") {
        return typeof message.id === "string"
            && typeof message.room === "string"
            && typeof message.text === "string"
            && typeof message.sentAt === "string";
    }
    if (message.type === "direct_message" && (message.event === "created" || message.event === "updated" || message.event === "deleted" || message.event === "receipt")) {
        const record = message.message;
        if (typeof record !== "object" || record === null) return false;
        const direct = record as Record<string, unknown>;
        return typeof message.senderId === "string"
            && typeof message.recipientId === "string"
            && typeof direct.id === "string"
            && typeof direct.status === "string";
    }
    return false;
}
