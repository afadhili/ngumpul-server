import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { channelMessage } from "../db/schema/channel-message";
import { directMessage } from "../db/schema/direct-message";
import { user } from "../db/schema/auth";
import { friendship, serverChannel, serverMember } from "../db/schema/community";
import { directConversationKey } from "../lib/conversation-key";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { getSessionUserId } from "../lib/request-auth";
import { loadChannelMessageMeta, loadDirectMessageMeta, metaFor } from "../services/message-meta.service";
import { toPublicMessage as toPublicChannelMessage } from "./channel-message.controller";
import { toPublicMessage as toPublicDirectMessage } from "./direct-message.controller";

type SearchQuery = {
    text: string;
    limit: number;
    senderId: string | null;
    hasAttachment: boolean;
    before: Date | null;
    after: Date | null;
};

export function parseSearchQuery(c: Context): { value: SearchQuery } | { error: string; status: number } {
    const url = new URL(c.req.url);
    const text = (url.searchParams.get("q") ?? "").trim();
    if (text.length === 0) return { error: "Search query (q) is required", status: 400 };
    if (text.length > 200) return { error: "Search query must not exceed 200 characters", status: 400 };
    const rawLimit = Number(url.searchParams.get("limit") ?? 25);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 25;
    const senderId = url.searchParams.get("senderId");
    if (senderId !== null && (senderId.length === 0 || senderId.length > 128)) {
        return { error: "senderId is invalid", status: 400 };
    }
    const parseDate = (value: string | null, field: string): Date | null | undefined => {
        if (value === null || value === "") return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return undefined;
        return parsed;
    };
    const before = parseDate(url.searchParams.get("before"), "before");
    const after = parseDate(url.searchParams.get("after"), "after");
    if (before === undefined) return { error: "before must be an ISO date", status: 400 };
    if (after === undefined) return { error: "after must be an ISO date", status: 400 };
    return {
        value: {
            text: text.replace(/[%_\\]/g, character => `\\${character}`),
            limit,
            senderId: senderId && senderId.length > 0 ? senderId : null,
            hasAttachment: url.searchParams.get("hasAttachment") === "true",
            before,
            after,
        },
    };
}

export async function searchDirectMessages(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const parsed = parseSearchQuery(c);
    if ("error" in parsed) return c.json({ error: parsed.error }, parsed.status as 400);
    const query = parsed.value;
    const peerId = c.req.query("peerId") ?? "";

    const scopeFilter = peerId
        ? or(
            and(eq(directMessage.senderId, userId), eq(directMessage.recipientId, peerId)),
            and(eq(directMessage.senderId, peerId), eq(directMessage.recipientId, userId)),
        )
        : or(eq(directMessage.senderId, userId), eq(directMessage.recipientId, userId));
    if (peerId && !await canAccessDirectConversation(userId, peerId)) {
        return c.json({ error: "You do not have access to this conversation" }, 403);
    }

    const conditions = [scopeFilter];
    if (!peerId) {
        // Without a peer filter only search threads where the viewer still has conversation access.
        const friendRows = await db.select({
            userId: friendship.userId,
            friendUserId: friendship.friendUserId,
        }).from(friendship).where(or(
            eq(friendship.userId, userId),
            eq(friendship.friendUserId, userId),
        ));
        const peerIds = friendRows.map(row => row.userId === userId ? row.friendUserId : row.userId);
        if (peerIds.length === 0) return c.json({ messages: [], nextCursor: null });
        conditions.push(or(
            and(eq(directMessage.senderId, userId), inArray(directMessage.recipientId, peerIds)),
            and(eq(directMessage.recipientId, userId), inArray(directMessage.senderId, peerIds)),
        )!);
    }
    conditions.push(isNull(directMessage.deletedAt));
    conditions.push(ilike(directMessage.text, `%${query.text}%`));
    if (query.senderId) conditions.push(eq(directMessage.senderId, query.senderId));
    if (query.hasAttachment) conditions.push(sql`${directMessage.attachmentId} is not null`);
    if (query.before) conditions.push(sql`${directMessage.createdAt} < ${query.before}`);
    if (query.after) conditions.push(sql`${directMessage.createdAt} > ${query.after}`);

    const rows = await db.select().from(directMessage)
        .where(and(...conditions))
        .orderBy(desc(directMessage.createdAt))
        .limit(query.limit);

    const meta = await loadDirectMessageMeta(rows, userId);
    const peerRows = await db.select({ id: user.id, username: user.username, name: user.name, image: user.image })
        .from(user)
        .where(inArray(user.id, [...new Set(rows.flatMap(row => [row.senderId, row.recipientId]))]
            .filter(id => id !== userId)));
    const peerMap = new Map(peerRows.map(row => [row.id, row]));
    return c.json({
        messages: rows.map(row => {
            const peerIdForRow = row.senderId === userId ? row.recipientId : row.senderId;
            const peer = peerMap.get(peerIdForRow);
            return {
                ...toPublicDirectMessage(row, metaFor(meta, row.id)),
                conversationId: directConversationKey(row.senderId, row.recipientId),
                peer: peer ? { id: peer.id, username: peer.username, name: peer.name, image: peer.image } : null,
            };
        }),
        nextCursor: rows.length === query.limit ? rows[rows.length - 1]?.id ?? null : null,
    });
}

export async function searchChannelMessages(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const parsed = parseSearchQuery(c);
    if ("error" in parsed) return c.json({ error: parsed.error }, parsed.status as 400);
    const query = parsed.value;
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";

    let serverIds: string[];
    if (serverId) {
        const [membership] = await db.select({ role: serverMember.role }).from(serverMember)
            .where(and(eq(serverMember.serverId, serverId), eq(serverMember.userId, userId)))
            .limit(1);
        if (!membership) return c.json({ error: "Server not found or access denied" }, 404);
        serverIds = [serverId];
    } else {
        const rows = await db.select({ serverId: serverMember.serverId }).from(serverMember)
            .where(eq(serverMember.userId, userId));
        serverIds = rows.map(row => row.serverId);
        if (serverIds.length === 0) return c.json({ messages: [], nextCursor: null });
    }

    const channels = await db.select({ id: serverChannel.id, name: serverChannel.name, serverId: serverChannel.serverId })
        .from(serverChannel)
        .where(and(
            inArray(serverChannel.serverId, serverIds),
            eq(serverChannel.kind, "text"),
            channelId ? eq(serverChannel.id, channelId) : sql`true`,
        ));
    if (channelId && channels.length === 0) return c.json({ error: "Channel not found or access denied" }, 404);
    const channelIds = channels.map(channel => channel.id);
    if (channelIds.length === 0) return c.json({ messages: [], nextCursor: null });
    const channelNames = new Map(channels.map(channel => [channel.id, channel.name]));
    const channelServers = new Map(channels.map(channel => [channel.id, channel.serverId]));

    const conditions = [
        inArray(channelMessage.channelId, channelIds),
        isNull(channelMessage.deletedAt),
        ilike(channelMessage.text, `%${query.text}%`),
    ];
    if (query.senderId) conditions.push(eq(channelMessage.senderId, query.senderId));
    if (query.hasAttachment) conditions.push(sql`${channelMessage.attachmentId} is not null`);
    if (query.before) conditions.push(sql`${channelMessage.createdAt} < ${query.before}`);
    if (query.after) conditions.push(sql`${channelMessage.createdAt} > ${query.after}`);

    const rows = await db.select().from(channelMessage)
        .where(and(...conditions))
        .orderBy(desc(channelMessage.createdAt))
        .limit(query.limit);
    const meta = await loadChannelMessageMeta(rows, userId);
    const senderRows = await db.select({ id: user.id, username: user.username, name: user.name, image: user.image })
        .from(user)
        .where(inArray(user.id, [...new Set(rows.map(row => row.senderId))]));
    const senderMap = new Map(senderRows.map(row => [row.id, row]));
    return c.json({
        messages: rows.map(row => {
            const sender = senderMap.get(row.senderId);
            return {
                ...toPublicChannelMessage(row, metaFor(meta, row.id)),
                serverId: channelServers.get(row.channelId) ?? serverId,
                channelName: channelNames.get(row.channelId) ?? null,
                sender: sender ? { id: sender.id, username: sender.username, name: sender.name, image: sender.image } : null,
            };
        }),
        nextCursor: rows.length === query.limit ? rows[rows.length - 1]?.id ?? null : null,
    });
}
