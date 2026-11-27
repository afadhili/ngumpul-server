import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "../db/index";
import { messageSubmission } from "../db/schema/features";
import type { MessageInput } from "../lib/message-input";
import type { ConversationScope } from "./conversation-preference.service";

export function messageSubmissionKey(
    userId: string,
    scope: ConversationScope,
    targetId: string,
    input: MessageInput,
    isAnnouncement = false,
) {
    const { clientMessageId, ...payload } = input;
    if (!clientMessageId) return null;
    const requestHash = createHash("sha256").update(JSON.stringify([payload, isAnnouncement])).digest("hex");
    return { userId, scope, targetId, clientMessageId, requestHash };
}

type SubmissionKey = NonNullable<ReturnType<typeof messageSubmissionKey>>;

export async function lockMessageSubmission(executor: DbTransaction, key: SubmissionKey) {
    // Serializes retries for this sender and conversation until the transaction commits or rolls back.
    const lockName = JSON.stringify([key.userId, key.scope, key.targetId, key.clientMessageId]);
    await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockName}::text, 0))`);
    const [existing] = await executor.select().from(messageSubmission).where(and(
        eq(messageSubmission.userId, key.userId),
        eq(messageSubmission.scope, key.scope),
        eq(messageSubmission.targetId, key.targetId),
        eq(messageSubmission.clientMessageId, key.clientMessageId),
    )).limit(1);
    return existing;
}

export async function recordMessageSubmission(executor: DbTransaction, key: SubmissionKey, messageId: string) {
    await executor.insert(messageSubmission).values({ ...key, messageId });
}

export async function purgeExpiredMessageSubmissions() {
    await db.execute(sql`
        delete from ${messageSubmission}
        where (${messageSubmission.userId}, ${messageSubmission.scope}, ${messageSubmission.targetId},
            ${messageSubmission.clientMessageId}) in (
            select ${messageSubmission.userId}, ${messageSubmission.scope}, ${messageSubmission.targetId},
                ${messageSubmission.clientMessageId}
            from ${messageSubmission}
            where ${messageSubmission.createdAt} < now() - interval '24 hours'
            order by ${messageSubmission.createdAt}
            limit 1000
            for update skip locked
        )
    `);
}
