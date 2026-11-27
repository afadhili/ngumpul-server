import { randomUUID } from "node:crypto";
import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { profile, user, type SocialLink } from "../db/schema/auth";
import { friendship, userBlock } from "../db/schema/community";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { createAttachmentPreviewUrl, deleteObject, storeProfileImage } from "../services/object-storage.service";
import { isUniqueViolation } from "../lib/db-errors";
import { accountAvatar } from "../lib/profile-avatar";
import { getSessionUserId } from "../lib/request-auth";

type ProfileInput = {
    username?: unknown;
    displayName?: unknown;
    bio?: unknown;
    avatar?: unknown;
    socialLinks?: unknown;
    isPublic?: unknown;
};

const usernamePattern = /^[a-z0-9_]{3,24}$/;
const invalidUsername = "Username must be 3–24 characters using letters, numbers, or underscores";

export async function getProfile(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const [result] = await db
        .select({
            username: user.username,
            displayName: profile.displayName,
            bio: profile.bio,
            avatar: accountAvatar,
            banner: profile.banner,
            location: profile.location,
            website: profile.website,
            socialLinks: profile.socialLinks,
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
    return result ? c.json({ profile: result }, 200) : c.json({ error: "User not found" }, 404);
}

export async function checkUsernameAvailability(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const username = c.req.query("username")?.trim().toLowerCase() ?? "";
    if (!usernamePattern.test(username)) return c.json({ error: invalidUsername }, 400);

    const [match] = await db.select({ id: user.id }).from(user)
        .where(eq(sql<string>`lower(${user.username})`, username))
        .limit(1);

    c.header("Cache-Control", "no-store");
    return c.json({ username, available: !match || match.id === userId }, 200);
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

    if (!input || typeof input !== "object" || Array.isArray(input)) return c.json({ error: "Invalid JSON body" }, 400);
    const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
    if (!usernamePattern.test(username)) {
        return c.json({ error: invalidUsername }, 400);
    }

    const [current] = await db.select().from(profile).where(eq(profile.userId, userId)).limit(1);
    const displayName = input.displayName === undefined ? current?.displayName ?? null : input.displayName;
    const bio = input.bio === undefined ? current?.bio ?? null : input.bio;
    const avatar = input.avatar === undefined ? current?.avatar ?? null : input.avatar;
    const links = input.socialLinks === undefined ? null : parseSocialLinks(input.socialLinks);
    if (input.socialLinks !== undefined && !links) return c.json({ error: "Gunakan hingga 12 tautan HTTP atau HTTPS yang valid" }, 400);
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
                    ...(links ? { socialLinks: links } : {}),
                })
                .onConflictDoUpdate({
                    target: profile.userId,
                    set: {
                        ...(input.displayName !== undefined ? { displayName: typeof displayName === "string" ? displayName.trim() || null : null } : {}),
                        ...(input.bio !== undefined ? { bio: typeof bio === "string" ? bio.trim() || null : null } : {}),
                        ...(input.avatar !== undefined ? { avatar: typeof avatar === "string" ? avatar : null } : {}),
                        ...(input.isPublic !== undefined ? { isPublic } : {}),
                        ...(links ? { socialLinks: links } : {}),
                        updatedAt: new Date(),
                    },
                })
                .returning();
            return updatedProfile;
        });
        return c.json({ profile: { ...saved, username } }, 200);
    } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: "Username is already in use" }, 409);
        throw error;
    }
}

function parseSocialLinks(value: unknown): SocialLink[] | null {
    if (!Array.isArray(value) || value.length > 12) return null;
    const ids = new Set<string>();
    const links: SocialLink[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") return null;
        const { id, nama, platform, url } = entry as Record<string, unknown>;
        if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id) ||
            typeof nama !== "string" || !nama.trim() || nama.length > 60 ||
            typeof platform !== "string" || platform.length > 60 ||
            typeof url !== "string" || url.length > 500 || !isHttpUrl(url)) return null;
        ids.add(id);
        links.push({ id, nama: nama.trim(), platform, url });
    }
    return links;
}

export async function getVisibleProfile(c: Context) {
    const viewer = await getSessionUserId(c);
    if (!viewer) return c.json({ error: "Unauthorized" }, 401);
    const target = c.req.param("userId") ?? "";
    const [row] = await db.select({
        userId: user.id, username: user.username, displayName: profile.displayName, bio: profile.bio,
        avatar: accountAvatar, banner: profile.banner, socialLinks: profile.socialLinks,
        isPublic: profile.isPublic, photoVisibility: profile.photoVisibility,
    }).from(user).leftJoin(profile, eq(profile.userId, user.id)).where(eq(user.id, target)).limit(1);
    if (!row) return c.json({ error: "User not found" }, 404);
    const self = viewer === target;
    if (!self) {
        const [block] = await db.select({ id: userBlock.blockerId }).from(userBlock).where(or(
            and(eq(userBlock.blockerId, viewer), eq(userBlock.blockedId, target)),
            and(eq(userBlock.blockerId, target), eq(userBlock.blockedId, viewer)),
        )).limit(1);
        if (block) return c.json({ error: "User not found" }, 404);
    }
    const friend = self || await canAccessDirectConversation(viewer, target);
    if (row.isPublic === false && !friend) return c.json({ error: "User not found" }, 404);
    const showPhoto = self || row.photoVisibility === "everyone" || (row.photoVisibility !== "nobody" && friend);
    return c.json({ profile: {
        userId: row.userId, username: row.username, displayName: row.displayName, bio: row.bio,
        avatar: showPhoto ? row.avatar : null, banner: showPhoto ? row.banner : null,
        socialLinks: row.socialLinks ?? [],
    } }, 200);
}

const jpegPrefix = "data:image/jpeg;base64,";
const imagePath = "/api/profile/media/";
const imageIdPattern = /^[a-f0-9-]{36}$/;
const maxEncodedImage = 700_000;

export async function saveProfileImage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json<{ type?: unknown; data?: unknown }>().catch(() => null);
    const type = body?.type;
    if (type !== "avatar" && type !== "banner") return c.json({ error: "Jenis foto tidak valid" }, 400);
    const data = body?.data;
    if (typeof data !== "string" || !data.startsWith(jpegPrefix) || data.length > maxEncodedImage) {
        return c.json({ error: "Gunakan gambar JPEG maksimal 512 KB" }, 400);
    }
    const encoded = data.slice(jpegPrefix.length);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length < 4 || bytes.length > 512 * 1024 || bytes.toString("base64") !== encoded ||
        bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
        return c.json({ error: "Gambar JPEG tidak valid" }, 400);
    }
    const id = randomUUID();
    const key = "profile-media/" + id;
    const base = new URL(process.env.BETTER_AUTH_URL || c.req.url);
    const url = new URL(imagePath + id, base).href;
    try { await storeProfileImage(key, bytes); }
    catch (error) {
        console.error("Unable to store profile image:", error);
        return c.json({ error: "Penyimpanan foto belum tersedia" }, 503);
    }

    let previous: string | null;
    try {
        previous = await db.transaction(async tx => {
            await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
            const [old] = await tx.select({ image: profile[type] }).from(profile).where(eq(profile.userId, userId)).limit(1);
            await tx.insert(profile).values({ id: randomUUID(), userId, [type]: url })
                .onConflictDoUpdate({ target: profile.userId, set: { [type]: url, updatedAt: new Date() } });
            return old?.image ?? null;
        });
    } catch (error) {
        await deleteObject(key).catch(() => {});
        throw error;
    }
    if (previous?.startsWith(new URL(imagePath, base).href)) {
        const oldId = previous.split("/").at(-1);
        if (oldId && imageIdPattern.test(oldId)) {
            const [used] = await db.select({ id: profile.id }).from(profile)
                .where(or(eq(profile.avatar, previous), eq(profile.banner, previous))).limit(1);
            if (!used) await deleteObject("profile-media/" + oldId).catch(() => {});
        }
    }
    return c.json({ url }, 201);
}

export async function showProfileImage(c: Context) {
    const id = c.req.param("imageId") ?? "";
    if (!imageIdPattern.test(id)) return c.json({ error: "Image not found" }, 404);
    const url = new URL(imagePath + id, process.env.BETTER_AUTH_URL || c.req.url).href;
    const [used] = await db.select({ id: profile.id }).from(profile)
        .where(or(eq(profile.avatar, url), eq(profile.banner, url))).limit(1);
    if (!used) return c.json({ error: "Image not found" }, 404);
    try {
        const signed = await createAttachmentPreviewUrl("profile-media/" + id, "image/jpeg", "profil.jpg");
        c.header("Cache-Control", "private, no-store");
        c.header("Cross-Origin-Resource-Policy", "cross-origin");
        c.header("X-Robots-Tag", "noindex, nofollow");
        return c.redirect(signed, 302);
    } catch (error) {
        console.error("Unable to sign profile image:", error);
        return c.json({ error: "Penyimpanan foto belum tersedia" }, 503);
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
        .select({ userId: user.id, username: user.username, displayName: profile.displayName, avatar: accountAvatar, photoVisibility: profile.photoVisibility })
        .from(user)
        .leftJoin(profile, eq(profile.userId, user.id))
        .where(and(ilike(user.username, `${prefix}%`), or(isNull(profile.userId), eq(profile.isPublic, true))))
        .limit(20);

    const candidates = matches.filter(match => match.userId !== userId && match.username !== null);
    if (candidates.length === 0) return c.json({ users: [] }, 200);
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
        avatar: match.photoVisibility === "everyone" || (match.photoVisibility !== "nobody" && friendIds.has(match.userId))
            ? match.avatar
            : null,
    }));
    return c.json({ users: visible }, 200);
}

function isHttpUrl(value: string) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}
