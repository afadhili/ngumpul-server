import "dotenv/config";
import { createClient } from "redis";
import { isChatMessage, type ChatMessage } from "../models/chat-message";

const channel = "pbp:chat:messages";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const publisher = createClient({ url: redisUrl });
const subscriber = publisher.duplicate();
const listeners = new Set<(message: ChatMessage) => void>();

publisher.on("error", error => console.error("Redis publisher error:", error.message));
subscriber.on("error", error => console.error("Redis subscriber error:", error.message));

export async function connectRealtimeService() {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    await subscriber.subscribe(channel, raw => {
        try {
            const message: unknown = JSON.parse(raw);
            if (!isChatMessage(message)) return;
            for (const listener of listeners) listener(message);
        } catch (error) {
            console.error("Invalid Redis chat message:", error);
        }
    });
}

export async function publishChatMessage(message: ChatMessage) {
    await publisher.publish(channel, JSON.stringify(message));
}

export function onChatMessage(listener: (message: ChatMessage) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export async function closeRealtimeService() {
    await Promise.all([publisher.quit(), subscriber.quit()]);
}
