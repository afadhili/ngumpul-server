import { and, eq } from "drizzle-orm";
import { db, type DbExecutor } from "../db/index";
import { serverChannel, serverMember } from "../db/schema/community";

export type ServerRole = "owner" | "admin" | "member";

export type ChannelAccess = {
    channelId: string;
    serverId: string;
    kind: "text" | "voice";
    role: ServerRole;
};

export async function getChannelAccess(userId: string, channelId: string, serverId?: string, executor: DbExecutor = db) {
    const conditions = [eq(serverChannel.id, channelId), eq(serverMember.userId, userId)];
    if (serverId !== undefined) conditions.push(eq(serverChannel.serverId, serverId));

    const [row] = await executor.select({
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

export async function getServerRole(serverId: string, userId: string): Promise<ServerRole | null> {
    const [membership] = await db.select({ role: serverMember.role }).from(serverMember)
        .where(and(eq(serverMember.serverId, serverId), eq(serverMember.userId, userId))).limit(1);
    return membership?.role === "owner" || membership?.role === "admin" || membership?.role === "member"
        ? membership.role
        : null;
}

export function isServerManager(role: ServerRole) {
    return role === "owner" || role === "admin";
}
