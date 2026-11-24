import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { channelMessage } from "../db/schema/channel-message";
import { directMessage } from "../db/schema/direct-message";
import { messagePoll, messagePollOption, messagePollVote } from "../db/schema/features";
import { getChannelAccess, isServerManager } from "../lib/channel-access";
import { getSessionUserId } from "../lib/request-auth";
import type { PollEvent } from "../models/realtime-event";
import { publishUserEvent } from "../services/event.service";
import { getServerMemberIds } from "../services/server-event.service";
import { summarizePoll } from "../services/poll.service";

type PollContext = {
    poll: typeof messagePoll.$inferSelect;
    recipients: string[];
    serverId?: string;
    channelId?: string;
    peerId?: string;
    manager: boolean;
};

async function resolvePollContext(userId: string, pollId: string): Promise<PollContext | null> {
    const [poll] = await db.select().from(messagePoll).where(eq(messagePoll.id, pollId)).limit(1);
    if (!poll) return null;

    if (poll.scope === "direct") {
        const [message] = await db.select().from(directMessage)
            .where(eq(directMessage.id, poll.messageId)).limit(1);
        if (!message) return null;
        if (message.senderId !== userId && message.recipientId !== userId) return null;
        const peerId = message.senderId === userId ? message.recipientId : message.senderId;
        return { poll, recipients: [message.senderId, message.recipientId], peerId, manager: message.senderId === userId };
    }

    const [message] = await db.select().from(channelMessage)
        .where(eq(channelMessage.id, poll.messageId)).limit(1);
    if (!message) return null;
    const access = await getChannelAccess(userId, message.channelId);
    if (!access) return null;
    const members = await getServerMemberIds(access.serverId);
    return {
        poll,
        recipients: members,
        serverId: access.serverId,
        channelId: message.channelId,
        manager: isServerManager(access.role),
    };
}

function emitPoll(context: PollContext, event: PollEvent["event"], poll: PollEvent["poll"], actorId: string) {
    const payload: PollEvent = {
        type: "poll_event",
        event,
        scope: context.poll.scope as "direct" | "channel",
        messageId: context.poll.messageId,
        poll,
        actorId,
        ...(context.serverId ? { serverId: context.serverId } : {}),
        ...(context.channelId ? { channelId: context.channelId } : {}),
        ...(context.peerId ? { peerId: context.peerId } : {}),
    };
    return publishUserEvent(context.recipients, payload).catch(error => {
        console.error("Unable to publish poll event:", error);
    });
}

export async function voteOnPoll(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const pollId = c.req.param("pollId") ?? "";
    const context = await resolvePollContext(userId, pollId);
    if (!context) return c.json({ error: "Poll not found or access denied" }, 404);
    const { poll } = context;
    if (poll.closedAt || (poll.closesAt && poll.closesAt.getTime() <= Date.now())) {
        return c.json({ error: "This poll is closed" }, 409);
    }

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    const record = typeof body === "object" && body !== null && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {};
    const rawOptionIds = record.optionIds ?? (typeof record.optionId === "string" ? [record.optionId] : undefined);
    if (!Array.isArray(rawOptionIds) || rawOptionIds.length === 0) {
        return c.json({ error: "optionIds must be a non-empty array" }, 400);
    }
    const optionIds = [...new Set(rawOptionIds)];
    if (optionIds.some(id => typeof id !== "string")) return c.json({ error: "optionIds must be poll option IDs" }, 400);
    if (!poll.allowMultiple && optionIds.length > 1) {
        return c.json({ error: "This poll only allows a single option" }, 400);
    }
    const options = await db.select().from(messagePollOption).where(and(
        eq(messagePollOption.pollId, pollId),
        inArray(messagePollOption.id, optionIds as string[]),
    ));
    if (options.length !== optionIds.length) return c.json({ error: "One or more options do not belong to this poll" }, 400);

    if (!poll.allowMultiple) {
        await db.delete(messagePollVote).where(and(eq(messagePollVote.pollId, pollId), eq(messagePollVote.userId, userId)));
    }
    await db.insert(messagePollVote).values((optionIds as string[]).map(optionId => ({
        id: randomUUID(),
        pollId,
        optionId,
        userId,
    }))).onConflictDoNothing();

    const summary = await summarizePoll(pollId, userId);
    if (summary) await emitPoll(context, "voted", summary, userId);
    return c.json({ poll: summary });
}

export async function retractPollVote(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const pollId = c.req.param("pollId") ?? "";
    const context = await resolvePollContext(userId, pollId);
    if (!context) return c.json({ error: "Poll not found or access denied" }, 404);
    if (context.poll.closedAt) return c.json({ error: "This poll is closed" }, 409);
    await db.delete(messagePollVote).where(and(eq(messagePollVote.pollId, pollId), eq(messagePollVote.userId, userId)));
    const summary = await summarizePoll(pollId, userId);
    if (summary) await emitPoll(context, "voted", summary, userId);
    return c.json({ poll: summary });
}

export async function closePoll(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const pollId = c.req.param("pollId") ?? "";
    const context = await resolvePollContext(userId, pollId);
    if (!context) return c.json({ error: "Poll not found or access denied" }, 404);
    if (context.poll.createdBy !== userId && !context.manager) {
        return c.json({ error: "Only the poll creator or a server administrator can close this poll" }, 403);
    }
    if (context.poll.closedAt) return c.json({ error: "This poll is already closed" }, 409);
    await db.update(messagePoll).set({ closedAt: new Date() }).where(eq(messagePoll.id, pollId));
    const summary = await summarizePoll(pollId, userId);
    if (summary) await emitPoll(context, "closed", summary, userId);
    return c.json({ poll: summary });
}

export async function getPoll(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const pollId = c.req.param("pollId") ?? "";
    const context = await resolvePollContext(userId, pollId);
    if (!context) return c.json({ error: "Poll not found or access denied" }, 404);
    return c.json({ poll: await summarizePoll(pollId, userId) });
}
