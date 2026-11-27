import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbExecutor } from "../db/index";
import { messagePoll, messagePollOption, messagePollVote } from "../db/schema/features";
import type { PollSummary } from "../models/realtime-event";

type PollRow = typeof messagePoll.$inferSelect;

export async function loadPolls(
    scope: "direct" | "channel",
    messageIds: string[],
    viewerId: string,
    executor: DbExecutor = db,
): Promise<Map<string, PollSummary>> {
    const result = new Map<string, PollSummary>();
    if (messageIds.length === 0) return result;

    const polls = await executor.select().from(messagePoll).where(and(
        eq(messagePoll.scope, scope),
        inArray(messagePoll.messageId, messageIds),
    ));
    if (polls.length === 0) return result;

    const pollIds = polls.map(poll => poll.id);
    const loadOptions = () => executor.select().from(messagePollOption)
        .where(inArray(messagePollOption.pollId, pollIds))
        .orderBy(asc(messagePollOption.position));
    const loadVotes = () => executor.select().from(messagePollVote)
        .where(inArray(messagePollVote.pollId, pollIds));
    const [options, votes] = executor === db
        ? await Promise.all([loadOptions(), loadVotes()])
        : [await loadOptions(), await loadVotes()] as const;

    for (const poll of polls) {
        result.set(poll.messageId, buildSummary(poll, options, votes, viewerId));
    }
    return result;
}

export async function summarizePoll(pollId: string, viewerId: string): Promise<PollSummary | null> {
    const [poll] = await db.select().from(messagePoll).where(eq(messagePoll.id, pollId)).limit(1);
    if (!poll) return null;
    const [options, votes] = await Promise.all([
        db.select().from(messagePollOption)
            .where(eq(messagePollOption.pollId, pollId))
            .orderBy(asc(messagePollOption.position)),
        db.select().from(messagePollVote).where(eq(messagePollVote.pollId, pollId)),
    ]);
    return buildSummary(poll, options, votes, viewerId);
}

export async function summarizePollForMessage(scope: "direct" | "channel", messageId: string, viewerId: string) {
    const [poll] = await db.select().from(messagePoll)
        .where(and(eq(messagePoll.scope, scope), eq(messagePoll.messageId, messageId)))
        .limit(1);
    if (!poll) return null;
    const [options, votes] = await Promise.all([
        db.select().from(messagePollOption)
            .where(eq(messagePollOption.pollId, poll.id))
            .orderBy(asc(messagePollOption.position)),
        db.select().from(messagePollVote).where(eq(messagePollVote.pollId, poll.id)),
    ]);
    return buildSummary(poll, options, votes, viewerId);
}

function buildSummary(
    poll: PollRow,
    options: (typeof messagePollOption.$inferSelect)[],
    votes: (typeof messagePollVote.$inferSelect)[],
    viewerId: string,
): PollSummary {
    const voteCounts = new Map<string, number>();
    for (const vote of votes) voteCounts.set(vote.optionId, (voteCounts.get(vote.optionId) ?? 0) + 1);
    const viewerOptionIds = new Set(votes.filter(vote => vote.userId === viewerId).map(vote => vote.optionId));
    return {
        id: poll.id,
        messageId: poll.messageId,
        question: poll.question,
        allowMultiple: poll.allowMultiple,
        anonymous: poll.anonymous,
        closesAt: poll.closesAt?.toISOString() ?? null,
        closedAt: poll.closedAt?.toISOString() ?? null,
        totalVotes: votes.length,
        options: options.map(option => ({
            id: option.id,
            label: option.label,
            position: option.position,
            votes: voteCounts.get(option.id) ?? 0,
            votedByMe: viewerOptionIds.has(option.id),
        })),
    };
}
