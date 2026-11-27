import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "../db/index";
import { isReady } from "./runtime-health";
import { channelMessage } from "../db/schema/channel-message";
import { directMessage } from "../db/schema/direct-message";
import {
    messagePoll,
} from "../db/schema/features";
import { attachment } from "../db/schema/attachment";
import { channelMessageReaction } from "../db/schema/reaction";
import { directMessageReaction } from "../db/schema/reaction";
import { deleteObject } from "./object-storage.service";
import { purgeExpiredMessageSubmissions } from "./message-submission.service";
import { deleteMessageSideData } from "./message-support.service";
import { dispatchDueScheduledMessages } from "../controllers/scheduled-message.controller";

const TICK_MS = 15_000;
let timer: NodeJS.Timeout | null = null;
let activeTick: Promise<void> | undefined;
let worker: AbortController | undefined;

/** Removes messages whose disappearing timer elapsed, including attachment bytes. */
export async function purgeExpiredMessages(limit = 100): Promise<number> {
    let removed = 0;
    const now = new Date();

    const expiredDirect = await db.select().from(directMessage).where(and(
        isNotNull(directMessage.expiresAt),
        lte(directMessage.expiresAt, now),
    )).limit(limit);
    for (const row of expiredDirect) {
        if (row.attachmentId) await removeAttachmentObject(row.attachmentId);
        await db.delete(directMessageReaction).where(eq(directMessageReaction.messageId, row.id));
        await deleteMessageSideData("direct", row.id);
        await db.delete(directMessage).where(eq(directMessage.id, row.id));
        removed += 1;
    }

    const expiredChannel = await db.select().from(channelMessage).where(and(
        isNotNull(channelMessage.expiresAt),
        lte(channelMessage.expiresAt, now),
    )).limit(limit);
    for (const row of expiredChannel) {
        if (row.attachmentId) await removeAttachmentObject(row.attachmentId);
        await db.delete(channelMessageReaction).where(eq(channelMessageReaction.messageId, row.id));
        await deleteMessageSideData("channel", row.id);
        await db.delete(channelMessage).where(eq(channelMessage.id, row.id));
        removed += 1;
    }
    return removed;
}

async function removeAttachmentObject(attachmentId: string) {
    const [file] = await db.select({ storageKey: attachment.storageKey, uploadKey: attachment.uploadKey })
        .from(attachment).where(eq(attachment.id, attachmentId)).limit(1);
    if (!file) return;
    try {
        await Promise.all([deleteObject(file.storageKey), deleteObject(file.uploadKey)]);
    } catch (error) {
        console.error("Unable to delete expired attachment object:", error);
    }
    await db.delete(attachment).where(eq(attachment.id, attachmentId));
}

/** Closes polls once their deadline passes. */
export async function closeDuePolls(): Promise<number> {
    const now = new Date();
    const closed = await db.update(messagePoll)
        .set({ closedAt: now })
        .where(and(
            isNull(messagePoll.closedAt),
            isNotNull(messagePoll.closesAt),
            lte(messagePoll.closesAt, now),
        )).returning({ id: messagePoll.id });
    return closed.length;
}

async function runTick(signal: AbortSignal) {
    if (!await isReady()) return;
    const tasks = [
        { run: () => dispatchDueScheduledMessages(25, signal), action: "dispatched scheduled messages" },
        { run: purgeExpiredMessages, action: "purged expired messages" },
        { run: closeDuePolls, action: "closed polls" },
        { run: purgeExpiredMessageSubmissions, action: "purged expired message submissions" },
    ];
    for (const { run, action } of tasks) {
        if (signal.aborted) break;
        try {
            const count = await run();
            if (count) console.log(`[worker] ${action}: ${count}`);
        } catch (error) {
            console.error(`[worker] failed task (${action}):`, error);
        }
    }
}

export function startBackgroundWorker() {
    if (timer) return;
    const controller = new AbortController();
    worker = controller;
    const tick = () => {
        activeTick ??= runTick(controller.signal).finally(() => { activeTick = undefined; });
    };
    timer = setInterval(tick, TICK_MS);
    timer.unref();
    console.log("[worker] scheduled/disappearing message worker started");
    tick();
}

export async function stopBackgroundWorker() {
    if (timer) clearInterval(timer);
    timer = null;
    worker?.abort();
    worker = undefined;
    await activeTick;
}
