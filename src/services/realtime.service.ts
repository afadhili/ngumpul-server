import { isChatMessage, type ChatMessage } from "../models/chat-message";
import { createRedisPubSub } from "./redis-pubsub";

const listeners = new Set<(message: ChatMessage) => void>();

const pubsub = createRedisPubSub("chat", "pbp:chat:messages", raw => {
    try {
        const message: unknown = JSON.parse(raw);
        if (!isChatMessage(message)) return;
        for (const listener of listeners) listener(message);
    } catch (error) {
        console.error("Invalid Redis chat message:", error);
    }
});

export const connectRealtimeService = pubsub.connect;
export const closeRealtimeService = pubsub.close;

export async function publishChatMessage(message: ChatMessage) {
    await pubsub.publish(JSON.stringify(message));
}

export function onChatMessage(listener: (message: ChatMessage) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
