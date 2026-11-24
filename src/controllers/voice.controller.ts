import { and, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { RoomServiceClient } from "livekit-server-sdk";
import { db } from "../db/index";
import { profile, user } from "../db/schema/auth";
import { serverChannel } from "../db/schema/community";
import { getServerRole } from "../lib/channel-access";
import { getSessionUserId } from "../lib/request-auth";
import { summarizeVoiceTracks } from "../lib/voice-tracks";

function liveKitHttpUrl() {
    const publicUrl = process.env.LIVEKIT_PUBLIC_URL ?? "ws://localhost:7880";
    return publicUrl.replace(/^ws/i, "http");
}

export async function listVoiceParticipants(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found or access denied" }, 404);

    const [channel] = await db.select({ id: serverChannel.id, kind: serverChannel.kind })
        .from(serverChannel)
        .where(and(eq(serverChannel.id, channelId), eq(serverChannel.serverId, serverId)))
        .limit(1);
    if (!channel || channel.kind !== "voice") return c.json({ error: "Voice channel not found" }, 404);

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) return c.json({ error: "Voice service is not configured" }, 503);

    const room = `server-${serverId}-channel-${channelId}`;
    const client = new RoomServiceClient(liveKitHttpUrl(), apiKey, apiSecret);
    let participants;
    try {
        participants = await client.listParticipants(room);
    } catch (error) {
        // LiveKit answers with a not-found error (404) when nobody has joined the room yet.
        const message = error instanceof Error ? error.message : String(error);
        if (/not\s*found|404/i.test(message)) return c.json({ room, participants: [] });
        console.error("Unable to list LiveKit participants:", error);
        return c.json({ error: "Voice service is unavailable" }, 502);
    }

    const identities = participants.map(participant => participant.identity).filter(Boolean);
    const people = identities.length === 0 ? [] : await db.select({
        id: user.id,
        username: user.username,
        name: user.name,
        image: user.image,
        displayName: profile.displayName,
    }).from(user).leftJoin(profile, eq(profile.userId, user.id)).where(inArray(user.id, identities));
    const peopleMap = new Map(people.map(person => [person.id, person]));

    return c.json({
        room,
        participants: participants.map(participant => {
            const person = peopleMap.get(participant.identity);
            return {
                identity: participant.identity,
                name: participant.name || person?.displayName || person?.name || null,
                username: person?.username ?? null,
                image: person?.image ?? null,
                joinedAt: participant.joinedAt ? new Date(Number(participant.joinedAt) * 1000).toISOString() : null,
                ...summarizeVoiceTracks(participant.tracks ?? []),
                metadata: participant.metadata || null,
            };
        }),
    });
}

/**
 * Server managers can mute/unmute or disconnect a participant; members may only
 * mute themselves. Actions run through LiveKit so the media server enforces them.
 */
export async function updateVoiceParticipant(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const serverId = c.req.param("serverId") ?? "";
    const channelId = c.req.param("channelId") ?? "";
    const identity = c.req.param("identity") ?? "";
    if (!identity) return c.json({ error: "A participant identity is required" }, 400);

    const role = await getServerRole(serverId, userId);
    if (!role) return c.json({ error: "Server not found or access denied" }, 404);
    const isManager = role === "owner" || role === "admin";
    if (!isManager && identity !== userId) return c.json({ error: "Only server managers can control other participants" }, 403);

    const [channel] = await db.select({ id: serverChannel.id, kind: serverChannel.kind })
        .from(serverChannel)
        .where(and(eq(serverChannel.id, channelId), eq(serverChannel.serverId, serverId)))
        .limit(1);
    if (!channel || channel.kind !== "voice") return c.json({ error: "Voice channel not found" }, 404);

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) return c.json({ error: "Voice service is not configured" }, 503);

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return c.json({ error: "Request body must be an object" }, 400);
    }
    const record = body as Record<string, unknown>;
    const muted = record.muted;
    const remove = record.remove === true;
    if (!remove && typeof muted !== "boolean") {
        return c.json({ error: "Provide muted (boolean) or remove (true)" }, 400);
    }
    if (remove && !isManager) return c.json({ error: "Only server managers can disconnect participants" }, 403);

    const room = `server-${serverId}-channel-${channelId}`;
    const client = new RoomServiceClient(liveKitHttpUrl(), apiKey, apiSecret);
    try {
        if (remove) {
            await client.removeParticipant(room, identity);
        } else {
            await client.updateParticipant(room, identity, {
                permission: {
                    canPublish: !muted,
                    canSubscribe: true,
                    canPublishData: true,
                },
            });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not\s*found|404/i.test(message)) return c.json({ error: "Participant not found" }, 404);
        console.error("Unable to update LiveKit participant:", error);
        return c.json({ error: "Voice service is unavailable" }, 502);
    }

    return c.json({ ok: true, identity, muted: typeof muted === "boolean" ? muted : null, removed: remove });
}
