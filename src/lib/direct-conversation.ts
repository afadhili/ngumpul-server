import { and, eq, notExists, or } from "drizzle-orm";
import { db, type DbExecutor } from "../db/index";
import { friendship, userBlock } from "../db/schema/community";

export async function canAccessDirectConversation(userId: string, peerId: string, executor: DbExecutor = db) {
    if (!peerId || userId === peerId) return false;
    const firstId = userId < peerId ? userId : peerId;
    const secondId = userId < peerId ? peerId : userId;
    const blocks = executor.select({ blockerId: userBlock.blockerId }).from(userBlock)
        .where(or(
            and(eq(userBlock.blockerId, userId), eq(userBlock.blockedId, peerId)),
            and(eq(userBlock.blockerId, peerId), eq(userBlock.blockedId, userId)),
        ));
    const [link] = await executor.select({ userId: friendship.userId }).from(friendship)
        .where(and(eq(friendship.userId, firstId), eq(friendship.friendUserId, secondId), notExists(blocks))).limit(1);
    return Boolean(link);
}
