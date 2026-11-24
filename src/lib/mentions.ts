const MENTION_PATTERN = /@([a-z0-9_]{3,24})/gi;

/** Extracts unique lowercase usernames mentioned with `@username`, capped at 25. */
export function extractMentionUsernames(text: string | null | undefined) {
    if (!text) return [];
    const found = new Set<string>();
    for (const match of text.matchAll(MENTION_PATTERN)) {
        if (match[1]) found.add(match[1].toLowerCase());
    }
    return [...found].slice(0, 25);
}
