import { randomUUID } from "node:crypto";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { profile, user } from "../db/schema/auth";
import { friendship, userBlock } from "../db/schema/community";
import { isUniqueViolation } from "../lib/db-errors";
import { getSessionUserId } from "../lib/request-auth";

type ProfileInput = {
    username?: unknown;
    displayName?: unknown;
    bio?: unknown;
    avatar?: unknown;
    isPublic?: unknown;
};

export async function getProfile(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const [result] = await db
        .select({
            username: user.username,
            displayName: profile.displayName,
            bio: profile.bio,
            avatar: profile.avatar,
            banner: profile.banner,
            location: profile.location,
            website: profile.website,
            pronouns: profile.pronouns,
            isPublic: profile.isPublic,
            photoVisibility: profile.photoVisibility,
            onlineStatusVisibility: profile.onlineStatusVisibility,
            lastSeenVisibility: profile.lastSeenVisibility,
        })
        .from(user)
        .leftJoin(profile, eq(profile.userId, user.id))
        .where(eq(user.id, userId))
        .limit(1);
    return result ? c.json({ profile: result }) : c.json({ error: "User not found" }, 404);
}

export async function updateProfile(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    let input: ProfileInput;
    try {
        input = await c.req.json<ProfileInput>();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }

    const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        return c.json({ error: "Username must be 3–24 characters using letters, numbers, or underscores" }, 400);
    }

    const [current] = await db.select().from(profile).where(eq(profile.userId, userId)).limit(1);
    const displayName = input.displayName === undefined ? current?.displayName ?? null : input.displayName;
    const bio = input.bio === undefined ? current?.bio ?? null : input.bio;
    const avatar = input.avatar === undefined ? current?.avatar ?? null : input.avatar;
    const isPublic = input.isPublic === undefined ? current?.isPublic ?? true : input.isPublic;

    if (displayName !== null && (typeof displayName !== "string" || displayName.trim().length > 60)) {
        return c.json({ error: "Display name must be at most 60 characters" }, 400);
    }
    if (bio !== null && (typeof bio !== "string" || bio.length > 500)) {
        return c.json({ error: "Bio must be at most 500 characters" }, 400);
    }
    if (avatar !== null && (typeof avatar !== "string" || avatar.length > 2048 || !isHttpUrl(avatar))) {
        return c.json({ error: "Avatar must be an HTTP or HTTPS URL" }, 400);
    }
    if (typeof isPublic !== "boolean") return c.json({ error: "isPublic must be a boolean" }, 400);

    try {
        const saved = await db.transaction(async tx => {
            await tx.update(user).set({ username, updatedAt: new Date() }).where(eq(user.id, userId));
            const [updatedProfile] = await tx
                .insert(profile)
                .values({
                    id: randomUUID(),
                    userId,
                    displayName: typeof displayName === "string" ? displayName.trim() || null : null,
                    bio: typeof bio === "string" ? bio.trim() || null : null,
                    avatar: typeof avatar === "string" ? avatar : null,
                    isPublic,
                })
                .onConflictDoUpdate({
                    target: profile.userId,
                    set: {
                        displayName: typeof displayName === "string" ? displayName.trim() || null : null,
                        bio: typeof bio === "string" ? bio.trim() || null : null,
                        avatar: typeof avatar === "string" ? avatar : null,
                        isPublic,
                        updatedAt: new Date(),
                    },
                })
                .returning();
            return updatedProfile;
        });
        return c.json({ profile: { ...saved, username } });
    } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: "Username is already in use" }, 409);
        throw error;
    }
}

export async function searchUsers(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const query = c.req.query("username")?.trim().toLowerCase() ?? "";
    if (query.length < 2 || query.length > 24) {
        return c.json({ error: "username query must be between 2 and 24 characters" }, 400);
    }

    const prefix = query.replace(/[\\%_]/g, "\\$&");
    const matches = await db
        .select({ userId: user.id, username: user.username, displayName: profile.displayName, avatar: profile.avatar, photoVisibility: profile.photoVisibility })
        .from(user)
        .leftJoin(profile, eq(profile.userId, user.id))
        .where(and(ilike(user.username, `${prefix}%`), or(isNull(profile.userId), eq(profile.isPublic, true))))
        .limit(20);

    const candidates = matches.filter(match => match.userId !== userId && match.username !== null);
    if (candidates.length === 0) return c.json({ users: [] });
    const candidateIds = new Set(candidates.map(match => match.userId));
    const [blocks, friends] = await Promise.all([
        db.select({ blockerId: userBlock.blockerId, blockedId: userBlock.blockedId }).from(userBlock)
            .where(or(eq(userBlock.blockerId, userId), eq(userBlock.blockedId, userId))),
        db.select({ userId: friendship.userId, friendUserId: friendship.friendUserId }).from(friendship)
            .where(or(eq(friendship.userId, userId), eq(friendship.friendUserId, userId))),
    ]);
    const hiddenIds = new Set(blocks.map(item => item.blockerId === userId ? item.blockedId : item.blockerId));
    const friendIds = new Set(friends.map(item => item.userId === userId ? item.friendUserId : item.userId));
    const visible = candidates.filter(match => candidateIds.has(match.userId) && !hiddenIds.has(match.userId)).map(match => ({
        userId: match.userId,
        username: match.username,
        displayName: match.displayName,
        avatar: match.photoVisibility === "everyone" || (match.photoVisibility === "friends" && friendIds.has(match.userId))
            ? match.avatar
            : null,
    }));
    return c.json({ users: visible });
}

function isHttpUrl(value: string) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}
