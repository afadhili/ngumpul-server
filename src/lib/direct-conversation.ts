import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index";
import { friendship, userBlock } from "../db/schema/community";

export async function canAccessDirectConversation(userId: string, peerId: string) {
    if (!peerId || userId === peerId) return false;
    const firstId = userId < peerId ? userId : peerId;
    const secondId = userId < peerId ? peerId : userId;
    const [[link], [block]] = await Promise.all([
        db.select({ userId: friendship.userId }).from(friendship)
            .where(and(eq(friendship.userId, firstId), eq(friendship.friendUserId, secondId))).limit(1),
        db.select({ blockerId: userBlock.blockerId }).from(userBlock)
            .where(or(
                and(eq(userBlock.blockerId, userId), eq(userBlock.blockedId, peerId)),
                and(eq(userBlock.blockerId, peerId), eq(userBlock.blockedId, userId)),
            )).limit(1),
    ]);
    return Boolean(link) && !block;
}
