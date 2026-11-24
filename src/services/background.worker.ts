import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "../db/index";
import { channelMessage } from "../db/schema/channel-message";
import { directMessage } from "../db/schema/direct-message";
import {
    messagePoll,
} from "../db/schema/features";
import { attachment } from "../db/schema/attachment";
import { channelMessageReaction } from "../db/schema/reaction";
import { directMessageReaction } from "../db/schema/reaction";
import { deleteObject } from "./object-storage.service";
import { deleteMessageSideData } from "./message-support.service";
import { dispatchDueScheduledMessages } from "../controllers/scheduled-message.controller";

const TICK_MS = 15_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

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

async function tick() {
    if (running) return;
    running = true;
    try {
        const sent = await dispatchDueScheduledMessages();
        if (sent > 0) console.log(`[worker] dispatched ${sent} scheduled message(s)`);
        const purged = await purgeExpiredMessages();
        if (purged > 0) console.log(`[worker] purged ${purged} expired message(s)`);
        const closed = await closeDuePolls();
        if (closed > 0) console.log(`[worker] closed ${closed} poll(s)`);
    } catch (error) {
        console.error("[worker] background task failed:", error);
    } finally {
        running = false;
    }
}

export function startBackgroundWorker() {
    if (timer) return;
    timer = setInterval(() => {
        void tick();
    }, TICK_MS);
    timer.unref();
    console.log("[worker] scheduled/disappearing message worker started");
    void tick();
}

export function stopBackgroundWorker() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}
