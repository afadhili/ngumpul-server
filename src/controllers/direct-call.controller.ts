import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { AccessToken, RoomServiceClient, TwirpError } from "livekit-server-sdk";
import { db } from "../db/index";
import { directCall } from "../db/schema/direct-call";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { getSessionUserId } from "../lib/request-auth";
import { publishUserEvent } from "../services/event.service";

const RING_MS = 45_000;
const CALL_MS = 2 * 60 * 60_000;
type Call = typeof directCall.$inferSelect;

function publicCall(call: Call) {
    const expired = call.expiresAt <= new Date() && (call.status === "ringing" || call.status === "active");
    return { ...call, status: expired ? (call.status === "ringing" ? "missed" as const : "ended" as const) : call.status,
        endedAt: expired ? call.expiresAt : call.endedAt };
}

function liveKit() {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_PUBLIC_URL;
    if (!apiKey || !apiSecret || !url) return null;
    return { apiKey, apiSecret, url };
}

function roomName(id: string) {
    return `direct-call-${id}`;
}

async function emitCall(call: Call) {
    try {
        await publishUserEvent([call.callerId, call.recipientId], {
            type: "direct_call",
            callId: call.id,
            status: call.status,
        });
    } catch (error) {
        console.error("Unable to publish direct call update:", error);
    }
}

function involves(id: string) {
    return or(eq(directCall.callerId, id), eq(directCall.recipientId, id));
}

async function closeRoom(call: Call) {
    const config = liveKit();
    if (!config || !call.answeredAt) return;
    const host = (process.env.LIVEKIT_URL || config.url).replace(/^ws/i, "http");
    try {
        await new RoomServiceClient(host, config.apiKey, config.apiSecret).deleteRoom(roomName(call.id));
    } catch (error) {
        if (!(error instanceof TwirpError && error.code === "not_found"))
            console.error("Unable to close direct call room:", error);
    }
}

export async function endDirectCallsBetween(self: string, peer: string) {
    const now = new Date();
    const calls = await db.update(directCall).set({ status: "ended", endedAt: now })
        .where(and(involves(self), involves(peer),
            inArray(directCall.status, ["ringing", "active"]), gt(directCall.expiresAt, now)))
        .returning();
    await Promise.all(calls.flatMap(call => [emitCall(call), closeRoom(call)]));
}

export async function listDirectCalls(c: Context) {
    const self = await getSessionUserId(c);
    if (!self) return c.json({ error: "Unauthorized" }, 401);
    const rows = await db.select().from(directCall).where(involves(self)).orderBy(desc(directCall.createdAt)).limit(50);
    return c.json({ calls: rows.map(publicCall) }, 200);
}

export async function startDirectCall(c: Context) {
    const self = await getSessionUserId(c);
    if (!self) return c.json({ error: "Unauthorized" }, 401);
    if (!liveKit()) return c.json({ error: "Voice service is not configured" }, 503);
    const peer = c.req.param("peerId") ?? "";
    const body = await c.req.json<{ kind?: unknown }>().catch(() => null);
    const kind = body?.kind;
    if (kind !== "audio" && kind !== "video") return c.json({ error: "Invalid call kind" }, 400);

    const result = await db.transaction(async tx => {
        // Always lock accounts in the same order so two overlapping calls cannot both ring.
        for (const id of [self, peer].sort())
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"direct-call:" + id}, 0))`);
        if (!await canAccessDirectConversation(self, peer, tx)) return { status: 403 } as const;
        const now = new Date();
        const [active] = await tx.select().from(directCall).where(and(
            or(involves(self), involves(peer)), inArray(directCall.status, ["ringing", "active"]), gt(directCall.expiresAt, now),
        )).limit(1);
        if (active) {
            if (active.callerId === self && active.recipientId === peer && active.kind === kind && active.status === "ringing")
                return { status: 200, call: active } as const;
            return { status: 409 } as const;
        }
        const [call] = await tx.insert(directCall).values({
            id: randomUUID(), callerId: self, recipientId: peer, kind, status: "ringing",
            expiresAt: new Date(now.getTime() + RING_MS),
        }).returning();
        return { status: 201, call } as const;
    });
    if (result.status === 403) return c.json({ error: "You do not have access to this conversation" }, 403);
    if (result.status === 409) return c.json({ error: "A participant is already in a call" }, 409);
    await emitCall(result.call);
    return c.json({ call: publicCall(result.call) }, result.status);
}

export async function updateDirectCall(c: Context) {
    const self = await getSessionUserId(c);
    if (!self) return c.json({ error: "Unauthorized" }, 401);
    const id = c.req.param("callId") ?? "";
    const body = await c.req.json<{ action?: unknown }>().catch(() => null);
    const action = body?.action;
    if (action !== "accept" && action !== "decline" && action !== "end")
        return c.json({ error: "Invalid call action" }, 400);
    const [current] = await db.select().from(directCall).where(and(eq(directCall.id, id), involves(self))).limit(1);
    if (!current) return c.json({ error: "Call not found" }, 404);
    const now = new Date();
    const status = action === "accept" ? "active" : action === "decline" ? "declined" : "ended";
    if (status === current.status) return c.json({ call: publicCall(current) }, 200);
    if (action !== "end" && self !== current.recipientId) return c.json({ error: "Only the callee can answer" }, 403);
    if (action === "accept" && !await canAccessDirectConversation(self, current.callerId))
        return c.json({ error: "You do not have access to this conversation" }, 403);

    const [call] = await db.update(directCall).set(status === "active"
        ? { status, answeredAt: now, expiresAt: new Date(now.getTime() + CALL_MS) }
        : { status, endedAt: now })
        .where(and(eq(directCall.id, id), gt(directCall.expiresAt, now), action === "end"
            ? inArray(directCall.status, ["ringing", "active"])
            : eq(directCall.status, "ringing")))
        .returning();
    if (!call) return c.json({ error: "Call is no longer available" }, 409);
    await emitCall(call);

    if (call.status === "ended") await closeRoom(call);
    return c.json({ call: publicCall(call) }, 200);
}

export async function directCallToken(c: Context) {
    const self = await getSessionUserId(c);
    if (!self) return c.json({ error: "Unauthorized" }, 401);
    const config = liveKit();
    if (!config) return c.json({ error: "Voice service is not configured" }, 503);
    const id = c.req.param("callId") ?? "";
    const [call] = await db.select().from(directCall).where(and(
        eq(directCall.id, id), involves(self), eq(directCall.status, "active"), gt(directCall.expiresAt, new Date()),
    )).limit(1);
    if (!call) return c.json({ error: "Active call not found" }, 404);
    const peer = call.callerId === self ? call.recipientId : call.callerId;
    if (!await canAccessDirectConversation(self, peer)) return c.json({ error: "You do not have access to this conversation" }, 403);
    const room = roomName(call.id);
    const token = new AccessToken(config.apiKey, config.apiSecret, { identity: self, ttl: "1m" });
    token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false });
    return c.json({ url: config.url, token: await token.toJwt(), room }, 200);
}
