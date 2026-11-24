export function directConversationKey(firstId: string, secondId: string) {
    return firstId < secondId ? `${firstId}:${secondId}` : `${secondId}:${firstId}`;
}

export function conversationKey(scope: "direct" | "channel", firstId: string, secondId?: string) {
    return scope === "direct" && secondId ? directConversationKey(firstId, secondId) : firstId;
}
