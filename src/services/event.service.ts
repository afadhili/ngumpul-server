import { isRealtimeEvent, type RealtimeEvent } from "../models/realtime-event";
import { createRedisPubSub } from "./redis-pubsub";

const listeners = new Set<(recipients: string[], event: RealtimeEvent) => void>();
type Envelope = { recipients: string[]; event: RealtimeEvent };

const pubsub = createRedisPubSub("events", "pbp:realtime:events", raw => {
    try {
        const value: unknown = JSON.parse(raw);
        if (!isEnvelope(value)) return;
        for (const listener of listeners) listener(value.recipients, value.event);
    } catch (error) {
        console.error("Invalid Redis realtime event:", error);
    }
});

export const connectEventService = pubsub.connect;
export const closeEventService = pubsub.close;

export async function publishUserEvent(recipients: string[], event: RealtimeEvent) {
    const unique = [...new Set(recipients.filter(Boolean))];
    if (unique.length === 0) return;
    await pubsub.publish(JSON.stringify({ recipients: unique, event } satisfies Envelope));
}

export function onUserEvent(listener: (recipients: string[], event: RealtimeEvent) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function isEnvelope(value: unknown): value is Envelope {
    if (typeof value !== "object" || value === null) return false;
    const envelope = value as Record<string, unknown>;
    return Array.isArray(envelope.recipients)
        && envelope.recipients.every(item => typeof item === "string")
        && isRealtimeEvent(envelope.event);
}
