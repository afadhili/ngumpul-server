import "dotenv/config";
import { createClient } from "redis";
import { isRealtimeEvent, type RealtimeEvent } from "../models/realtime-event";

const channel = "pbp:realtime:events";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const publisher = createClient({ url: redisUrl });
const subscriber = publisher.duplicate();
const listeners = new Set<(recipients: string[], event: RealtimeEvent) => void>();

type Envelope = { recipients: string[]; event: RealtimeEvent };

publisher.on("error", error => console.error("Realtime publisher error:", error.message));
subscriber.on("error", error => console.error("Realtime subscriber error:", error.message));

export async function connectEventService() {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    await subscriber.subscribe(channel, raw => {
        try {
            const value: unknown = JSON.parse(raw);
            if (!isEnvelope(value)) return;
            for (const listener of listeners) listener(value.recipients, value.event);
        } catch (error) {
            console.error("Invalid Redis realtime event:", error);
        }
    });
}

export async function publishUserEvent(recipients: string[], event: RealtimeEvent) {
    const unique = [...new Set(recipients.filter(Boolean))];
    if (unique.length === 0) return;
    await publisher.publish(channel, JSON.stringify({ recipients: unique, event } satisfies Envelope));
}

export function onUserEvent(listener: (recipients: string[], event: RealtimeEvent) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export async function closeEventService() {
    await Promise.all([publisher.quit(), subscriber.quit()]);
}

function isEnvelope(value: unknown): value is Envelope {
    if (typeof value !== "object" || value === null) return false;
    const envelope = value as Record<string, unknown>;
    return Array.isArray(envelope.recipients)
        && envelope.recipients.every(item => typeof item === "string")
        && isRealtimeEvent(envelope.event);
}
