import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { serverChannel, serverMember } from "../db/schema/community";

export type ServerRole = "owner" | "admin" | "member";

export type ChannelAccess = {
    channelId: string;
    serverId: string;
    kind: "text" | "voice";
    role: ServerRole;
};

export async function getChannelAccess(userId: string, channelId: string, serverId?: string) {
    const conditions = [eq(serverChannel.id, channelId), eq(serverMember.userId, userId)];
    if (serverId !== undefined) conditions.push(eq(serverChannel.serverId, serverId));

    const [row] = await db.select({
        channelId: serverChannel.id,
        serverId: serverChannel.serverId,
        kind: serverChannel.kind,
        role: serverMember.role,
    }).from(serverChannel)
        .innerJoin(serverMember, and(
            eq(serverMember.serverId, serverChannel.serverId),
            eq(serverMember.userId, userId),
        ))
        .where(and(...conditions))
        .limit(1);

    if (!row) return null;
    if (row.role !== "owner" && row.role !== "admin" && row.role !== "member") return null;
    if (row.kind !== "text" && row.kind !== "voice") return null;
    return row as ChannelAccess;
}

export function isServerManager(role: ServerRole) {
    return role === "owner" || role === "admin";
}
