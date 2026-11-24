import { getChannelAccess } from "./channel-access";
import { directConversationKey } from "./conversation-key";
import { canAccessDirectConversation } from "./direct-conversation";

export type ConversationScope = "direct" | "channel";

export function isConversationScope(value: unknown): value is ConversationScope {
    return value === "direct" || value === "channel";
}

/**
 * A conversation target is either a DM conversation key (`"<userIdA>:<userIdB>"`, sorted)
 * or a channel ID. Returns whether the viewer may read/write that conversation.
 */
export async function canUseConversationTarget(
    userId: string,
    scope: ConversationScope,
    targetId: string,
): Promise<boolean> {
    if (targetId.length === 0 || targetId.length > 160) return false;
    if (scope === "direct") {
        return targetId.split(":").includes(userId);
    }
    const access = await getChannelAccess(userId, targetId);
    return Boolean(access && access.kind === "text");
}

/**
 * Canonicalizes a conversation target: for `direct`, a peer user ID or a
 * conversation key becomes the sorted `<userA>:<userB>` key; for `channel`,
 * the channel ID is returned unchanged. Returns `null` when the caller has no
 * access to the target.
 */
export async function resolveConversationTarget(
    userId: string,
    scope: ConversationScope,
    targetId: string,
): Promise<string | null> {
    if (targetId.length === 0 || targetId.length > 160) return null;
    if (scope === "channel") {
        const access = await getChannelAccess(userId, targetId);
        return access && access.kind === "text" ? targetId : null;
    }
    if (targetId.includes(":")) {
        const parts = targetId.split(":");
        if (parts.length !== 2 || !parts.includes(userId)) return null;
        const peerId = parts.find(part => part !== userId);
        if (!peerId) return null;
        return await canAccessDirectConversation(userId, peerId) ? directConversationKey(userId, peerId) : null;
    }
    return await canAccessDirectConversation(userId, targetId) ? directConversationKey(userId, targetId) : null;
}
