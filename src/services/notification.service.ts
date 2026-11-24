import { randomUUID } from "node:crypto";
import type { NotificationEvent } from "../models/realtime-event";
import { publishUserEvent } from "./event.service";

type NotificationInput = {
    recipients: string[];
    kind: NotificationEvent["notification"]["kind"];
    title: string;
    body: string;
    serverId?: string;
    channelId?: string;
    messageId?: string;
    actorId?: string;
};

export async function sendNotification(input: NotificationInput) {
    const notification: NotificationEvent["notification"] = {
        id: randomUUID(),
        kind: input.kind,
        title: input.title,
        body: input.body,
        ...(input.serverId ? { serverId: input.serverId } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
        ...(input.actorId ? { actorId: input.actorId } : {}),
        createdAt: new Date().toISOString(),
    };
    try {
        await publishUserEvent(input.recipients, { type: "notification", notification });
    } catch (error) {
        console.error("Unable to publish notification:", error);
    }
}
