import { hashPassword } from "better-auth/crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../dist/db/index.js";
import { account, user } from "../dist/db/schema/auth.js";
import { channelMessage } from "../dist/db/schema/channel-message.js";

const BASE = process.env.SMOKE_BASE ?? "https://api.afadhili.my.id";
const PASSWORD = "Sm0keTestPass!23";
const results = [];
let failures = 0;

function check(name, ok, detail = "") {
    results.push({ name, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}

async function seed(id, username, email) {
    const hash = await hashPassword(PASSWORD);
    await db.insert(user).values({
        id,
        name: username,
        username,
        email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    }).onConflictDoNothing();
    await db.insert(account).values({
        id: `account-${id}`,
        accountId: id,
        providerId: "credential",
        userId: id,
        password: hash,
        createdAt: new Date(),
        updatedAt: new Date(),
    }).onConflictDoNothing();
}

async function call(path, { method = "GET", token, body } = {}) {
    let response;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        response = await fetch(`${BASE}${path}`, {
            method,
            headers: {
                "User-Agent": "ngumpul-smoke/1.0",
                Origin: "http://localhost:5173",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (response.status !== 403 && response.status !== 429) break;
        await new Promise(resolve => setTimeout(resolve, 11_000));
    }
    let payload = null;
    const text = await response.text();
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    return { status: response.status, body: payload };
}

async function signIn(email) {
    const result = await call("/api/auth/sign-in/email", { method: "POST", body: { email, password: PASSWORD } });
    return result;
}

const A = "smoke-a-user";
const B = "smoke-b-user";
await db.delete(user).where(inArray(user.id, [A, B]));
await seed(A, "smoke_a", "smoke-a@example.test");
await seed(B, "smoke_b", "smoke-b@example.test");

const signA = await signIn("smoke-a@example.test");
const signB = await signIn("smoke-b@example.test");
check("sign-in A", signA.status === 200 && Boolean(signA.body?.token), signA.status);
check("sign-in B", signB.status === 200 && Boolean(signB.body?.token), signB.status);
const tokenA = signA.body?.token;
const tokenB = signB.body?.token;

// friendship
const friendReq = await call("/api/friends/requests", { method: "POST", token: tokenA, body: { username: "smoke_b" } });
check("friend request", friendReq.status === 201 || friendReq.status === 409, friendReq.status);
if (friendReq.status === 201) {
    await call(`/api/friends/requests/${friendReq.body.request.id}/accept`, { method: "POST", token: tokenB });
}
const friends = await call("/api/friends", { token: tokenA });
check("friends list", friends.status === 200 && friends.body.friends.length >= 1, friends.body?.friends?.length);

// server + channels
const server = await call("/api/servers", { method: "POST", token: tokenA, body: { name: `Smoke Server ${Date.now()}` } });
check("create server", server.status === 201, server.status);
const serverId = server.body.server.id;
const channels = await call(`/api/servers/${serverId}/channels`, { token: tokenA });
const textChannel = channels.body.channels.find(channel => channel.kind === "text");
const voiceChannel = channels.body.channels.find(channel => channel.kind === "voice");
check("general channel", Boolean(textChannel), textChannel?.id);

const voice = await call(`/api/servers/${serverId}/channels`, { method: "POST", token: tokenA, body: { name: "voice-smoke", kind: "voice" } });
const voiceId = voice.status === 201 ? voice.body.channel.id : voiceChannel?.id;
check("create voice channel", voice.status === 201 || Boolean(voiceChannel), voice.status);

// join server as B via invite
const invite = await call(`/api/servers/${serverId}/invites`, { method: "POST", token: tokenA, body: {} });
const inviteCode = invite.body.invite?.code ?? invite.body.code;
const join = await call(`/api/servers/invites/${inviteCode}/join`, { method: "POST", token: tokenB, body: {} });
check("join server", join.status === 200 || join.status === 201, join.status);

// channel message with mention + notification
const channelMsg = await call(`/api/servers/${serverId}/channels/${textChannel.id}/messages`, {
    method: "POST", token: tokenA, body: { text: "halo @smoke_b cek ini" },
});
check("channel message with mention", channelMsg.status === 201, channelMsg.status);
const channelMsgId = channelMsg.body.message.id;
check("mentions resolved", Array.isArray(channelMsg.body.message.mentions) && channelMsg.body.message.mentions.length === 1, channelMsg.body.message.mentions);

const notifB = await call("/api/notifications", { token: tokenB });
check("notification persisted", notifB.status === 200 && notifB.body.notifications.length >= 1, notifB.body?.notifications?.length);
check("notification kind mention", notifB.body?.notifications?.[0]?.kind === "mention", notifB.body?.notifications?.[0]?.kind);

// poll
const pollMsg = await call(`/api/servers/${serverId}/channels/${textChannel.id}/messages`, {
    method: "POST", token: tokenA, body: { poll: { question: "Makan apa?", options: ["Bakso", "Sate"] } },
});
check("poll message created", pollMsg.status === 201 && Boolean(pollMsg.body.message.poll), pollMsg.status);
const poll = pollMsg.body.message.poll;
const vote = await call(`/api/polls/${poll.id}/votes`, { method: "POST", token: tokenB, body: { optionIds: [poll.options[0].id] } });
check("poll vote", vote.status === 200 && vote.body.poll.options[0].votes === 1, vote.status);
const pollGet = await call(`/api/polls/${poll.id}`, { token: tokenB });
check("poll get", pollGet.status === 200 && pollGet.body.poll.options[0].votedByMe === true, pollGet.status);
const pollClose = await call(`/api/polls/${poll.id}/close`, { method: "POST", token: tokenA });
check("poll close", pollClose.status === 200 && Boolean(pollClose.body.poll.closedAt), pollClose.status);

// pins
const pin = await call(`/api/servers/${serverId}/channels/${textChannel.id}/messages/${channelMsgId}/pin`, { method: "POST", token: tokenA });
check("channel pin", pin.status === 201 || pin.status === 200, pin.status);
const pins = await call(`/api/servers/${serverId}/channels/${textChannel.id}/pins`, { token: tokenB });
check("channel pins list", pins.status === 200 && pins.body.messages.length === 1, pins.body?.messages?.length);

// search
const searchChannel = await call(`/api/servers/${serverId}/channels/${textChannel.id}/messages/search?q=halo`, { token: tokenB });
check("channel search", searchChannel.status === 200 && searchChannel.body.messages.length >= 1, searchChannel.status);
const searchGlobalChannels = await call("/api/messages/search/channels?q=halo", { token: tokenB });
check("global channel search", searchGlobalChannels.status === 200 && searchGlobalChannels.body.messages.every(row => typeof row.serverId === "string"), searchGlobalChannels.status);

// DM + forward + pins + search
const dm = await call(`/api/direct-messages/${B}`, { method: "POST", token: tokenA, body: { text: "dm smoke hello" } });
check("dm send", dm.status === 201, dm.status);
const dmId = dm.body.message.id;
const dmSearch = await call(`/api/messages/search?q=dm%20smoke`, { token: tokenA });
check("dm search", dmSearch.status === 200 && dmSearch.body.messages.length >= 1, dmSearch.status);
const dmPin = await call(`/api/direct-messages/${dmId}/pin`, { method: "POST", token: tokenA });
check("dm pin", dmPin.status === 201 || dmPin.status === 200, dmPin.status);
const dmPins = await call(`/api/direct-messages/${B}/pins`, { token: tokenA });
check("dm pins list", dmPins.status === 200 && dmPins.body.messages.length === 1, dmPins.body?.messages?.length);
const forward = await call(`/api/messages/${dmId}/forward`, { method: "POST", token: tokenA, body: { scope: "channel", targetId: textChannel.id } });
check("forward to channel", forward.status === 201 && forward.body.message.forwardedFromId === dmId, forward.status);

// drafts
const draft = await call(`/api/drafts/channel/${textChannel.id}`, { method: "PUT", token: tokenA, body: { text: "draft smoke" } });
check("save draft", draft.status === 200 || draft.status === 201, draft.status);
const drafts = await call("/api/drafts", { token: tokenA });
check("list drafts", drafts.status === 200 && drafts.body.drafts.length === 1, drafts.body?.drafts?.length);

// conversation preferences
const pref = await call(`/api/conversations/channel/${textChannel.id}`, { method: "PATCH", token: tokenB, body: { favorite: true, notificationLevel: "mentions", disappearingSeconds: 60 } });
check("conversation preference", pref.status === 200 && pref.body.preference.favorite === true, pref.status);
const conversations = await call("/api/conversations", { token: tokenB });
check("list conversations", conversations.status === 200 && conversations.body.conversations.length >= 1, conversations.body?.conversations?.length);

// read state / unread
const readState = await call(`/api/channels/${textChannel.id}/read-state`, { method: "PUT", token: tokenB, body: { messageId: channelMsgId } });
check("update read state", readState.status === 200, readState.status);
const unread = await call(`/api/servers/${serverId}/unread`, { token: tokenB });
check("server unread counts", unread.status === 200 && Array.isArray(unread.body.channels), unread.status);

// disappearing message
const disappearing = await call(`/api/servers/${serverId}/channels/${textChannel.id}/messages`, {
    method: "POST", token: tokenA, body: { text: "hilang", expiresInSeconds: 60 },
});
check("disappearing message", disappearing.status === 201 && Boolean(disappearing.body.message.expiresAt), disappearing.status);

// announcement
const announcement = await call(`/api/servers/${serverId}/channels/${textChannel.id}/messages`, {
    method: "POST", token: tokenA, body: { text: "pengumuman", isAnnouncement: true },
});
check("announcement", announcement.status === 201 && announcement.body.message.isAnnouncement === true, announcement.status);
const announcementDenied = await call(`/api/servers/${serverId}/channels/${textChannel.id}/messages`, {
    method: "POST", token: tokenB, body: { text: "bukan admin", isAnnouncement: true },
});
check("announcement denied for member", announcementDenied.status === 403, announcementDenied.status);

// scheduled messages
const scheduled = await call("/api/scheduled-messages", {
    method: "POST", token: tokenA,
    body: { scope: "channel", targetId: textChannel.id, text: "terjadwal", scheduledFor: new Date(Date.now() + 3_600_000).toISOString() },
});
check("schedule message", scheduled.status === 201, scheduled.status);
const scheduledList = await call(`/api/scheduled-messages?scope=channel&targetId=${textChannel.id}`, { token: tokenA });
check("list scheduled", scheduledList.status === 200 && scheduledList.body.scheduledMessages.length === 1, scheduledList.body?.scheduledMessages?.length);
const cancel = await call(`/api/scheduled-messages/${scheduled.body.scheduledMessage.id}`, { method: "DELETE", token: tokenA });
check("cancel scheduled", cancel.status === 204, cancel.status);

// preferences / presence
const prefs = await call("/api/preferences", { token: tokenA });
check("get preferences", prefs.status === 200, prefs.status);
const updatePrefs = await call("/api/preferences", { method: "PUT", token: tokenA, body: { theme: "dark", textSize: "large", settings: { presenceVisibility: "friends" } } });
check("update preferences", updatePrefs.status === 200 && updatePrefs.body.preferences.theme === "dark", updatePrefs.status);
const presenceUpdate = await call("/api/presence", { method: "PUT", token: tokenA, body: { status: "online" } });
check("update presence", presenceUpdate.status === 200, presenceUpdate.status);
const presenceGet = await call(`/api/presence/${A}`, { token: tokenB });
check("get friend presence", presenceGet.status === 200 && presenceGet.body.presence.status === "online", presenceGet.status);

// QR friend codes
const qr = await call("/api/friends/qr", { token: tokenA });
check("create friend qr", qr.status === 200 && typeof qr.body.qr.code === "string", qr.status);
const qrPreview = await call(`/api/friends/qr/${encodeURIComponent(qr.body.qr.code)}`, { token: tokenB });
check("preview friend qr", qrPreview.status === 200 && qrPreview.body.qr.user.username === "smoke_a", qrPreview.status);
const qrClaim = await call("/api/friends/qr/claim", { method: "POST", token: tokenB, body: { code: qr.body.qr.code } });
check("claim friend qr (already friends)", qrClaim.status === 409, qrClaim.status);
const qrBad = await call("/api/friends/qr/not-a-valid-code", { token: tokenB });
check("invalid qr rejected", qrBad.status === 400, qrBad.status);

// voice participants
const voiceParticipants = await call(`/api/servers/${serverId}/channels/${voiceId}/voice-participants`, { token: tokenA });
check("voice participants", voiceParticipants.status === 200 && Array.isArray(voiceParticipants.body.participants), voiceParticipants.status);

// translation (unconfigured)
const translation = await call("/api/translations", { method: "POST", token: tokenA, body: { text: "halo", targetLanguage: "en" } });
check("translation unconfigured", translation.status === 503, translation.status);

// backup
const backup = await call("/api/backup", { token: tokenA });
check("export backup", backup.status === 200 && backup.body.backup.version === 1, backup.status);
const restore = await call("/api/backup/restore", { method: "POST", token: tokenA, body: { backup: backup.body.backup } });
check("restore backup", restore.status === 200 && typeof restore.body.restored === "object", restore.status);

// notifications read
const readAll = await call("/api/notifications/read-all", { method: "POST", token: tokenB });
check("mark all notifications read", readAll.status === 200, readAll.status);
const unreadCount = await call("/api/notifications/unread-count", { token: tokenB });
check("unread count", unreadCount.status === 200 && unreadCount.body.unreadCount === 0, unreadCount.body?.unreadCount);

// scheduled dispatch + disappearing purge (worker runs every 15s)
const dueSoon = await call("/api/scheduled-messages", {
    method: "POST", token: tokenA,
    body: { scope: "direct", targetId: B, text: "pesan jatuh tempo", scheduledFor: new Date(Date.now() + 6_000).toISOString() },
});
check("schedule due message", dueSoon.status === 201, dueSoon.status);
const purgeMsg = await call(`/api/servers/${serverId}/channels/${textChannel.id}/messages`, {
    method: "POST", token: tokenA, body: { text: "pesan kedaluwarsa", expiresInSeconds: 5 },
});
const purgeId = purgeMsg.body?.message?.id;
check("schedule disappearing message", purgeMsg.status === 201 && Boolean(purgeId), purgeMsg.status);
await new Promise(resolve => setTimeout(resolve, 26_000));
const dueList = await call("/api/scheduled-messages?scope=direct&status=sent", { token: tokenA });
check("worker dispatched scheduled message", dueList.status === 200 && dueList.body.scheduledMessages.length >= 1, dueList.status);
const dmAfterDue = await call(`/api/direct-messages/${B}`, { token: tokenA });
check("scheduled message delivered to DM", dmAfterDue.status === 200 && dmAfterDue.body.messages.some(message => message.text === "pesan jatuh tempo"), dmAfterDue.status);
const purged = await db.select({ id: channelMessage.id }).from(channelMessage).where(eq(channelMessage.id, purgeId ?? ""));
check("disappearing message purged", purged.length === 0, purged.length);

// WebSocket typing + presence events
function openSocket(path, token) {
    return new Promise((resolve, reject) => {
        import("ws").then(({ WebSocket }) => {
            const socket = new WebSocket(`${BASE.replace("https", "wss")}${path}&token=${encodeURIComponent(token)}`);
            const events = [];
            socket.on("message", raw => events.push(JSON.parse(raw.toString())));
            socket.on("open", () => resolve({ socket, events }));
            socket.on("error", reject);
        }).catch(reject);
    });
}
const userSocket = await openSocket("/ws/user?", tokenB);
await new Promise(resolve => setTimeout(resolve, 300));
const channelSocket = await openSocket(`/ws/channel?channelId=${textChannel.id}&`, tokenA);
await new Promise(resolve => setTimeout(resolve, 500));
channelSocket.socket.send(JSON.stringify({ type: "typing" }));
await new Promise(resolve => setTimeout(resolve, 800));
check("typing event delivered", userSocket.events.some(event => event.type === "typing"), userSocket.events.map(event => event.type).join(","));
const awayUpdate = await call("/api/presence", { method: "PUT", token: tokenA, body: { status: "away" } });
await new Promise(resolve => setTimeout(resolve, 900));
check("presence update accepted", awayUpdate.status === 200, awayUpdate.status);
check("presence event delivered", userSocket.events.some(event => event.type === "presence"), userSocket.events.map(event => event.type).join(","));
channelSocket.socket.close();
userSocket.socket.close();

// cleanup
await db.delete(user).where(inArray(user.id, [A, B]));
const remaining = await db.select({ id: user.id }).from(user).where(eq(user.id, A));
check("cleanup users", remaining.length === 0, remaining.length);

console.log(`\n${results.filter(r => r.ok).length}/${results.length} checks passed`);
if (failures > 0) {
    console.log("\nFAILURES:");
    for (const failure of results.filter(r => !r.ok)) console.log(`- ${failure.name}: ${failure.detail}`);
}
await pool.end();
process.exit(failures > 0 ? 1 : 0);
