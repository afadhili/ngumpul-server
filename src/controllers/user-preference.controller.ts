import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { userPreference } from "../db/schema/features";
import { getSessionUserId } from "../lib/request-auth";

const THEMES = ["system", "light", "dark"] as const;
const TEXT_SIZES = ["small", "medium", "large"] as const;
const CHAT_LIST_SORTS = ["recent", "unread", "name"] as const;
const CHAT_LIST_FILTERS = ["all", "unread", "favorites", "direct", "groups"] as const;

type PreferenceRow = typeof userPreference.$inferSelect;

const defaults = {
    theme: "system",
    wallpaper: null as string | null,
    bubbleColor: null as string | null,
    textSize: "medium",
    chatListSort: "recent",
    chatListFilter: "all",
    notifyDirectMessages: true,
    notifyChannels: true,
    notifyMentions: true,
    settings: {} as Record<string, unknown>,
};

function toPublicPreference(row: PreferenceRow | undefined) {
    const settings = row?.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
        ? row.settings as Record<string, unknown>
        : {};
    return {
        theme: row?.theme ?? defaults.theme,
        wallpaper: row?.wallpaper ?? defaults.wallpaper,
        bubbleColor: row?.bubbleColor ?? defaults.bubbleColor,
        textSize: row?.textSize ?? defaults.textSize,
        chatListSort: row?.chatListSort ?? defaults.chatListSort,
        chatListFilter: row?.chatListFilter ?? defaults.chatListFilter,
        notifyDirectMessages: row?.notifyDirectMessages ?? defaults.notifyDirectMessages,
        notifyChannels: row?.notifyChannels ?? defaults.notifyChannels,
        notifyMentions: row?.notifyMentions ?? defaults.notifyMentions,
        settings,
        updatedAt: row?.updatedAt.toISOString() ?? null,
    };
}

export async function getMyPreferences(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const [row] = await db.select().from(userPreference).where(eq(userPreference.userId, userId)).limit(1);
    return c.json({ preferences: toPublicPreference(row) });
}

export async function updateMyPreferences(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return c.json({ error: "Request body must be an object" }, 400);
    }
    const record = body as Record<string, unknown>;
    const patch: Partial<typeof userPreference.$inferInsert> = {};

    if (record.theme !== undefined) {
        if (typeof record.theme !== "string" || !THEMES.includes(record.theme as typeof THEMES[number])) {
            return c.json({ error: `theme must be one of ${THEMES.join(", ")}` }, 400);
        }
        patch.theme = record.theme;
    }
    if (record.textSize !== undefined) {
        if (typeof record.textSize !== "string" || !TEXT_SIZES.includes(record.textSize as typeof TEXT_SIZES[number])) {
            return c.json({ error: `textSize must be one of ${TEXT_SIZES.join(", ")}` }, 400);
        }
        patch.textSize = record.textSize;
    }
    if (record.chatListSort !== undefined) {
        if (typeof record.chatListSort !== "string" || !CHAT_LIST_SORTS.includes(record.chatListSort as typeof CHAT_LIST_SORTS[number])) {
            return c.json({ error: `chatListSort must be one of ${CHAT_LIST_SORTS.join(", ")}` }, 400);
        }
        patch.chatListSort = record.chatListSort;
    }
    if (record.chatListFilter !== undefined) {
        if (typeof record.chatListFilter !== "string" || !CHAT_LIST_FILTERS.includes(record.chatListFilter as typeof CHAT_LIST_FILTERS[number])) {
            return c.json({ error: `chatListFilter must be one of ${CHAT_LIST_FILTERS.join(", ")}` }, 400);
        }
        patch.chatListFilter = record.chatListFilter;
    }
    for (const key of ["wallpaper", "bubbleColor"] as const) {
        if (record[key] === undefined) continue;
        if (record[key] !== null && (typeof record[key] !== "string" || (record[key] as string).length > 2048)) {
            return c.json({ error: `${key} must be a string or null` }, 400);
        }
        patch[key] = record[key] as string | null;
    }
    for (const key of ["notifyDirectMessages", "notifyChannels", "notifyMentions"] as const) {
        if (record[key] === undefined) continue;
        if (typeof record[key] !== "boolean") return c.json({ error: `${key} must be a boolean` }, 400);
        patch[key] = record[key] as boolean;
    }
    if (record.settings !== undefined) {
        if (typeof record.settings !== "object" || record.settings === null || Array.isArray(record.settings)) {
            return c.json({ error: "settings must be an object" }, 400);
        }
        const settings = record.settings as Record<string, unknown>;
        if (JSON.stringify(settings).length > 8192) return c.json({ error: "settings must not exceed 8192 bytes" }, 400);
        if (settings.presenceVisibility !== undefined
            && settings.presenceVisibility !== "everyone"
            && settings.presenceVisibility !== "friends"
            && settings.presenceVisibility !== "nobody") {
            return c.json({ error: "settings.presenceVisibility must be everyone, friends or nobody" }, 400);
        }
        patch.settings = settings;
    }
    if (Object.keys(patch).length === 0) return c.json({ error: "No preference fields provided" }, 400);

    const [row] = await db.insert(userPreference).values({
        userId,
        ...patch,
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: userPreference.userId,
        set: { ...patch, updatedAt: new Date() },
    }).returning();
    return c.json({ preferences: toPublicPreference(row) });
}
