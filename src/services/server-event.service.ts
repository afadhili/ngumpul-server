import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { serverMember } from "../db/schema/community";
import type { ChannelSummary, MemberSummary, ServerEvent, ServerEventName, ServerSummary } from "../models/realtime-event";
import { publishUserEvent } from "./event.service";

type EventExtras = {
    server?: ServerSummary;
    channel?: ChannelSummary;
    member?: MemberSummary;
};

export async function getServerMemberIds(serverId: string) {
    const rows = await db.select({ userId: serverMember.userId }).from(serverMember)
        .where(eq(serverMember.serverId, serverId));
    return rows.map(row => row.userId);
}

export async function publishServerEvent(
    serverId: string,
    actorId: string,
    event: ServerEventName,
    extras: EventExtras = {},
    recipients?: string[],
) {
    const audience = recipients ?? await getServerMemberIds(serverId);
    if (audience.length === 0) return;
    try {
        await publishUserEvent(audience, {
            type: "server_event",
            event,
            serverId,
            actorId,
            ...extras,
            createdAt: new Date().toISOString(),
        } satisfies ServerEvent);
    } catch (error) {
        console.error("Unable to publish server event:", error);
    }
}
