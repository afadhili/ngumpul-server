import { directCallToken, listDirectCalls, startDirectCall, updateDirectCall } from "../controllers/direct-call.controller";
import { Hono } from "hono";
import {
    completeAttachmentUpload,
    createAttachmentUpload,
    deleteAttachment,
    getAttachmentDownloadUrl,
    getAttachmentPreview,
    listConversationAttachments,
} from "../controllers/attachment.controller";
import {
    acceptFriendRequest,
    cancelFriendRequest,
    declineFriendRequest,
    listFriendRequests,
    listFriends,
    removeFriend,
    sendFriendRequest,
} from "../controllers/friend.controller";
import { checkUsernameAvailability, getProfile, searchUsers, updateProfile } from "../controllers/profile.controller";
import { getCurrentUser } from "../controllers/user.controller";
import {
    blockUser,
    getPrivacySettings,
    listBlockedUsers,
    reportUser,
    unblockUser,
    updatePrivacySettings,
} from "../controllers/account.controller";
import { addDirectMessageReaction, removeDirectMessageReaction } from "../controllers/reaction.controller";
import {
    deleteDirectMessage,
    editDirectMessage,
    listDirectMessages,
    markDirectMessageReceipt,
    sendDirectMessage,
} from "../controllers/direct-message.controller";
import { exportBackup, restoreBackup } from "../controllers/backup.controller";
import {
    listConversations,
    getConversationPreferenceHandler,
    updateConversationPreference,
} from "../controllers/conversation.controller";
import { deleteDraft, listDrafts, saveDraft } from "../controllers/draft.controller";
import { forwardMessage } from "../controllers/forward.controller";
import { claimFriendQr, createFriendQr, previewFriendQr } from "../controllers/friend-qr.controller";
import {
    clearReadNotifications,
    deleteNotification,
    getUnreadNotificationCount,
    listNotifications,
    markAllNotificationsRead,
    markNotificationRead,
} from "../controllers/notification.controller";
import { listDirectPins, pinDirectMessage, unpinDirectMessage } from "../controllers/pin.controller";
import { closePoll, getPoll, retractPollVote, voteOnPoll } from "../controllers/poll.controller";
import { getUserPresence, listFriendPresence, updateMyPresence } from "../controllers/presence.controller";
import { getChannelReadState, updateChannelReadState } from "../controllers/read-state.controller";
import {
    cancelScheduledMessage,
    createScheduledMessage,
    listScheduledMessages,
    updateScheduledMessage,
} from "../controllers/scheduled-message.controller";
import { searchChannelMessages, searchDirectMessages } from "../controllers/search.controller";
import { listTranslationLanguages, translateMessage } from "../controllers/translation.controller";
import { getMyPreferences, updateMyPreferences } from "../controllers/user-preference.controller";

import {
    array,
    boolean,
    choice,
    dateTime,
    integer,
    jsonResponse,
    nullable,
    object,
    query,
    redirectResponse,
    rest,
    string,
    text,
    uri,
} from "../openapi/describe";
import * as schemas from "../openapi/schemas";

const peerParameter = { in: "path", name: "id", required: true, schema: schemas.id, description: "ID teman." } as const;
const messageParameter = {
    in: "path",
    name: "id",
    required: true,
    schema: schemas.id,
    description: "ID pesan.",
} as const;
const conversationScope = { in: "path", name: "scope", required: true, schema: schemas.scope } as const;

const callParameter = { in: "path", name: "callId", required: true, schema: schemas.id } as const;
const callResponse = object({
    id: schemas.id, callerId: schemas.id, recipientId: schemas.id,
    kind: choice("audio", "video"),
    status: choice("ringing", "active", "declined", "ended", "missed"),
    createdAt: dateTime, expiresAt: dateTime, answeredAt: nullable(dateTime), endedAt: nullable(dateTime),
});
const directCallResponse = object({ call: callResponse });

const apiRoutes = new Hono()
    .get("/me", ...rest(getCurrentUser, "Akun", "Ambil akun yang sedang login", object({ user: schemas.account })))
    .get(
        "/profile",
        ...rest(getProfile, "Profil", "Ambil profil akun", object({ profile: schemas.profile }), { errors: [404] }),
    )
    .get(
        "/profile/username-availability",
        ...rest(checkUsernameAvailability, "Profil", "Cek ketersediaan username", object({ username: schemas.username, available: boolean }), {
            parameters: [query("username", schemas.username, true)],
            errors: [400],
        }),
    )
    .put(
        "/profile",
        ...rest(updateProfile, "Profil", "Simpan profil akun", object({ profile: schemas.savedProfile }), {
            body: schemas.profileInput,
            errors: [409],
        }),
    )
    .get(
        "/users/search",
        ...rest(searchUsers, "Profil", "Cari pengguna publik berdasarkan awalan username", object({ users: array(schemas.contact) }), {
            parameters: [query("username", text(2, 24), true)],
            errors: [400],
        }),
    )
    .get(
        "/blocks",
        ...rest(
            listBlockedUsers,
            "Akun",
            "Ambil daftar pengguna yang diblokir",
            object({
                blocked: array(
                    object({
                        userId: schemas.id,
                        username: nullable(string),
                        name: string,
                        displayName: nullable(string),
                        blockedAt: dateTime,
                    }),
                ),
            }),
        ),
    )
    .post(
        "/users/:userId/block",
        ...rest(blockUser, "Akun", "Blokir pengguna dan putuskan pertemanan", undefined, { status: 204, errors: [400, 404] }),
    )
    .delete(
        "/users/:userId/block",
        ...rest(unblockUser, "Akun", "Buka blokir pengguna", undefined, { status: 204, errors: [404] }),
    )
    .post(
        "/users/:userId/reports",
        ...rest(
            reportUser,
            "Akun",
            "Laporkan pengguna",
            object({
                report: object({
                    id: schemas.id,
                    reporterId: schemas.id,
                    reportedId: schemas.id,
                    reason: string,
                    details: nullable(string),
                    status: choice("open", "reviewing", "resolved", "dismissed"),
                    createdAt: dateTime,
                }),
            }),
            {
                status: 201,
                body: object(
                    {
                        reason: choice("spam", "harassment", "impersonation", "inappropriate_content", "other"),
                        details: nullable(text(0, 1000)),
                    },
                    ["reason"],
                ),
                errors: [404, 409],
            },
        ),
    )
    .get(
        "/privacy",
        ...rest(getPrivacySettings, "Akun", "Ambil pengaturan privasi", object({ privacy: object(schemas.privacyFields) })),
    )
    .put(
        "/privacy",
        ...rest(updatePrivacySettings, "Akun", "Perbarui pengaturan privasi", object({ privacy: object(schemas.privacyFields) }), {
            body: { ...object(schemas.privacyFields, []), minProperties: 1 },
        }),
    )
    .get(
        "/friends",
        ...rest(listFriends, "Pertemanan", "Ambil daftar teman", object({ friends: array(schemas.contact) })),
    )
    .get(
        "/friends/requests",
        ...rest(
            listFriendRequests,
            "Pertemanan",
            "Ambil permintaan pertemanan masuk dan keluar",
            object({ incoming: array(schemas.pendingFriendRequest), outgoing: array(schemas.pendingFriendRequest) }),
        ),
    )
    .post(
        "/friends/requests",
        ...rest(sendFriendRequest, "Pertemanan", "Kirim permintaan pertemanan", object({ request: schemas.friendRequest }), {
            status: 201,
            body: object({ username: schemas.username }),
            errors: [403, 404, 409],
        }),
    )
    .post(
        "/friends/requests/:requestId/accept",
        ...rest(acceptFriendRequest, "Pertemanan", "Terima permintaan pertemanan", object({ request: schemas.friendRequest }), { errors: [404] }),
    )
    .post(
        "/friends/requests/:requestId/decline",
        ...rest(declineFriendRequest, "Pertemanan", "Tolak permintaan pertemanan", object({ request: schemas.friendRequest }), { errors: [404] }),
    )
    .post(
        "/friends/requests/:requestId/cancel",
        ...rest(cancelFriendRequest, "Pertemanan", "Batalkan permintaan pertemanan", object({ request: schemas.friendRequest }), { errors: [404] }),
    )
    .get(
        "/friends/qr",
        ...rest(
            createFriendQr,
            "Pertemanan",
            "Buat kode QR pertemanan",
            object({
                qr: object({
                    code: string,
                    username: nullable(string),
                    expiresAt: dateTime,
                    expiresInSeconds: integer(60, 86_400),
                    deepLink: uri,
                    httpUrl: uri,
                }),
            }),
            { parameters: [query("expiresInSeconds", { ...integer(60, 86_400), default: 3600 })], errors: [400, 404] },
        ),
    )
    .get(
        "/friends/qr/:code",
        ...rest(
            previewFriendQr,
            "Pertemanan",
            "Periksa kode QR pertemanan",
            object({
                qr: object({
                    user: schemas.friendQrUser,
                    expiresAt: dateTime,
                    canRequest: boolean,
                    alreadyFriends: boolean,
                    blocked: boolean,
                }),
            }),
            { errors: [400, 404, 410] },
        ),
    )
    .post(
        "/friends/qr/claim",
        ...rest(
            claimFriendQr,
            "Pertemanan",
            "Kirim permintaan pertemanan menggunakan kode QR",
            object({ request: schemas.friendRequest, user: schemas.friendQrUser }),
            { status: 201, body: object({ code: string }), errors: [403, 404, 409, 410] },
        ),
    )
    .delete(
        "/friends/:userId",
        ...rest(removeFriend, "Pertemanan", "Hapus teman", undefined, { status: 204, errors: [404] }),
    )
    .get("/direct-calls", ...rest(listDirectCalls, "Panggilan pribadi", "Riwayat panggilan pribadi",
        object({ calls: array(callResponse) })))
    .post("/direct-calls/peer/:peerId", ...rest(startDirectCall, "Panggilan pribadi", "Mulai panggilan pribadi",
        directCallResponse, {
            status: 201, body: object({ kind: choice("audio", "video") }),
            parameters: [{ in: "path", name: "peerId", required: true, schema: schemas.id }],
            errors: [400, 403, 409, 503],
        }))
    .patch("/direct-calls/:callId", ...rest(updateDirectCall, "Panggilan pribadi", "Tanggapi atau akhiri panggilan",
        directCallResponse, { parameters: [callParameter], body: object({ action: choice("accept", "decline", "end") }),
            errors: [400, 403, 404, 409] }))
    .post("/direct-calls/:callId/token", ...rest(directCallToken, "Panggilan pribadi", "Ambil token media",
        object({ url: uri, token: string, room: string }), { parameters: [callParameter], errors: [403, 404, 503] }))
    .get(
        "/direct-messages/:id",
        ...rest(listDirectMessages, "Pesan pribadi", "Ambil riwayat pesan dengan teman", schemas.messagePage(schemas.directMessage), {
            parameters: [peerParameter, ...schemas.historyQuery],
            errors: [400, 403],
        }),
    )
    .post(
        "/direct-messages/:id",
        ...rest(sendDirectMessage, "Pesan pribadi", "Kirim pesan ke teman", object({ message: schemas.directMessage }), {
            status: 201,
            parameters: [peerParameter],
            body: schemas.directMessageInput,
            errors: [403, 404, 409, 415],
        }),
    )
    .patch(
        "/direct-messages/:id",
        ...rest(editDirectMessage, "Pesan pribadi", "Edit teks pesan yang Anda kirim", object({ message: schemas.directMessage }), {
            parameters: [messageParameter],
            body: schemas.editMessageInput,
            errors: [403, 404],
        }),
    )
    .delete(
        "/direct-messages/:id",
        ...rest(deleteDirectMessage, "Pesan pribadi", "Hapus pesan pribadi", undefined, {
            status: 204,
            parameters: [messageParameter, ...schemas.deleteScopeQuery],
            errors: [400, 403, 404, 502],
        }),
    )
    .post(
        "/direct-messages/:messageId/receipts",
        ...rest(
            markDirectMessageReceipt,
            "Pesan pribadi",
            "Tandai pesan masuk sebagai diterima atau dibaca",
            object({ status: schemas.receiptStatus, upToMessageId: schemas.id, updatedCount: integer(0) }),
            { body: object({ status: schemas.receiptStatus }), errors: [403, 404] },
        ),
    )
    .post(
        "/direct-messages/:messageId/reactions",
        ...rest(addDirectMessageReaction, "Pesan pribadi", "Tambahkan reaksi ke pesan pribadi", schemas.reactions, {
            body: schemas.reactionInput,
            errors: [403, 404],
        }),
    )
    .delete(
        "/direct-messages/:messageId/reactions/:emoji",
        ...rest(removeDirectMessageReaction, "Pesan pribadi", "Hapus reaksi dari pesan pribadi", schemas.reactions, { errors: [400, 403, 404] }),
    )
    .get(
        "/direct-messages/:peerId/pins",
        ...rest(
            listDirectPins,
            "Pesan pribadi",
            "Ambil pesan sematan dalam percakapan pribadi",
            object({ messages: array(schemas.directMessage) }),
            { errors: [403] },
        ),
    )
    .post(
        "/direct-messages/:messageId/pin",
        ...rest(pinDirectMessage, "Pesan pribadi", "Sematkan pesan pribadi", schemas.pinned, {
            status: 201,
            responses: { 200: jsonResponse("Pesan sudah disematkan.", schemas.pinned) },
            errors: [403, 404],
        }),
    )
    .delete(
        "/direct-messages/:messageId/pin",
        ...rest(unpinDirectMessage, "Pesan pribadi", "Lepas sematan pesan pribadi", undefined, { status: 204, errors: [403, 404] }),
    )
    .get(
        "/messages/search",
        ...rest(searchDirectMessages, "Pencarian pesan", "Cari pesan pribadi", schemas.messagePage(schemas.directMessageSearchResult), {
            parameters: [...schemas.searchQuery, query("peerId", schemas.id)],
            errors: [400, 403],
        }),
    )
    .get(
        "/messages/search/channels",
        ...rest(
            searchChannelMessages,
            "Pencarian pesan",
            "Cari pesan di channel teks yang Anda ikuti",
            schemas.messagePage(schemas.channelMessageSearchResult),
            { parameters: schemas.searchQuery, errors: [400] },
        ),
    )
    .post(
        "/messages/:messageId/forward",
        ...rest(
            forwardMessage,
            "Percakapan",
            "Teruskan pesan ke percakapan lain",
            object({ message: { anyOf: [schemas.directMessage, schemas.channelMessage] } }),
            { body: object({ scope: schemas.scope, targetId: schemas.id }), status: 201, errors: [403, 404] },
        ),
    )
    .get(
        "/polls/:pollId",
        ...rest(getPoll, "Polling", "Ambil hasil dan status polling", schemas.pollResult, { errors: [404] }),
    )
    .post(
        "/polls/:pollId/votes",
        ...rest(voteOnPoll, "Polling", "Pilih opsi dalam polling", schemas.pollResult, {
            body: {
                ...object({ optionId: schemas.id, optionIds: { type: "array", minItems: 1, items: schemas.id } }, []),
                anyOf: [{ required: ["optionId"] }, { required: ["optionIds"] }],
            },
            errors: [404, 409],
        }),
    )
    .delete(
        "/polls/:pollId/votes",
        ...rest(retractPollVote, "Polling", "Tarik suara Anda dari polling", schemas.pollResult, { errors: [404, 409] }),
    )
    .post(
        "/polls/:pollId/close",
        ...rest(closePoll, "Polling", "Tutup pemungutan suara", schemas.pollResult, { errors: [403, 404] }),
    )
    .get(
        "/channels/:channelId/read-state",
        ...rest(getChannelReadState, "Percakapan", "Ambil status baca channel", schemas.readState, { errors: [404] }),
    )
    .put(
        "/channels/:channelId/read-state",
        ...rest(updateChannelReadState, "Percakapan", "Perbarui penanda baca channel", schemas.readState, {
            body: {
                ...object({ messageId: nullable(schemas.id), markedUnread: boolean }, []),
                anyOf: [{ required: ["messageId"], properties: { messageId: schemas.id } }, { required: ["markedUnread"] }],
            },
            errors: [404],
        }),
    )
    .get(
        "/conversations",
        ...rest(
            listConversations,
            "Percakapan",
            "Ambil daftar preferensi percakapan",
            object({ conversations: array(schemas.conversationPreference) }),
            {
                parameters: [query("scope", schemas.scope), query("favorite", boolean), query("archived", boolean)],
                errors: [400],
            },
        ),
    )
    .get(
        "/conversations/:scope/:targetId",
        ...rest(
            getConversationPreferenceHandler,
            "Percakapan",
            "Ambil preferensi satu percakapan",
            object({ preference: schemas.conversationPreference }),
            { parameters: [conversationScope], errors: [400, 403] },
        ),
    )
    .patch(
        "/conversations/:scope/:targetId",
        ...rest(
            updateConversationPreference,
            "Percakapan",
            "Perbarui preferensi percakapan",
            object({ preference: nullable(schemas.conversationPreference) }),
            { parameters: [conversationScope], body: schemas.conversationInput, errors: [403] },
        ),
    )
    .get("/drafts", ...rest(listDrafts, "Draf", "Ambil daftar draf pesan", object({ drafts: array(schemas.draft) })))
    .put(
        "/drafts/:scope/:targetId",
        ...rest(saveDraft, "Draf", "Simpan draf pesan", object({ draft: schemas.draft }), {
            parameters: [conversationScope],
            body: object({ text: text(0, 4000), replyToMessageId: nullable(schemas.id) }, []),
            responses: { 204: { description: "Draf kosong dihapus." } },
            errors: [403],
        }),
    )
    .delete(
        "/drafts/:scope/:targetId",
        ...rest(deleteDraft, "Draf", "Hapus draf pesan", undefined, { status: 204, parameters: [conversationScope], errors: [400, 404] }),
    )
    .get(
        "/scheduled-messages",
        ...rest(
            listScheduledMessages,
            "Pesan terjadwal",
            "Ambil daftar pesan terjadwal",
            object({ scheduledMessages: array(schemas.scheduledMessage) }),
            {
                parameters: [
                    query("scope", schemas.scope),
                    query("targetId", string),
                    query("status", schemas.scheduledStatus),
                ],
                errors: [400],
            },
        ),
    )
    .post(
        "/scheduled-messages",
        ...rest(createScheduledMessage, "Pesan terjadwal", "Jadwalkan pengiriman pesan", object({ scheduledMessage: schemas.scheduledMessage }), {
            status: 201,
            body: schemas.scheduledInput,
            errors: [403],
        }),
    )
    .patch(
        "/scheduled-messages/:scheduledMessageId",
        ...rest(
            updateScheduledMessage,
            "Pesan terjadwal",
            "Ubah pesan terjadwal yang masih menunggu",
            object({ scheduledMessage: schemas.scheduledMessage }),
            {
                body: { ...object({ text: text(1, 4000), scheduledFor: dateTime }, []), minProperties: 1 },
                errors: [404, 409],
            },
        ),
    )
    .delete(
        "/scheduled-messages/:scheduledMessageId",
        ...rest(cancelScheduledMessage, "Pesan terjadwal", "Batalkan pengiriman pesan terjadwal", undefined, { status: 204, errors: [404] }),
    )
    .get(
        "/notifications",
        ...rest(
            listNotifications,
            "Notifikasi",
            "Ambil daftar notifikasi",
            object({
                notifications: array(schemas.notification),
                nextCursor: nullable(schemas.id),
                unreadCount: integer(0),
            }),
            {
                parameters: [
                    query("unread", boolean),
                    query("limit", { ...integer(1, 100), default: 50 }),
                    query("before", schemas.id),
                ],
                errors: [400],
            },
        ),
    )
    .get(
        "/notifications/unread-count",
        ...rest(getUnreadNotificationCount, "Notifikasi", "Hitung notifikasi belum dibaca", object({ unreadCount: integer(0) })),
    )
    .post(
        "/notifications/read-all",
        ...rest(markAllNotificationsRead, "Notifikasi", "Tandai semua notifikasi sudah dibaca", object({ updatedCount: integer(0) })),
    )
    .delete(
        "/notifications/read",
        ...rest(clearReadNotifications, "Notifikasi", "Hapus semua notifikasi yang sudah dibaca", object({ deletedCount: integer(0) })),
    )
    .post(
        "/notifications/:notificationId/read",
        ...rest(markNotificationRead, "Notifikasi", "Tandai satu notifikasi sudah dibaca", object({ notification: schemas.notification }), {
            errors: [404],
        }),
    )
    .delete(
        "/notifications/:notificationId",
        ...rest(deleteNotification, "Notifikasi", "Hapus satu notifikasi", undefined, { status: 204, errors: [404] }),
    )
    .get(
        "/presence",
        ...rest(listFriendPresence, "Kehadiran", "Ambil status kehadiran teman", object({ presences: array(schemas.presence) })),
    )
    .get(
        "/presence/:userId",
        ...rest(getUserPresence, "Kehadiran", "Ambil status kehadiran satu pengguna", object({ presence: schemas.presence }), {
            errors: [403],
        }),
    )
    .put(
        "/presence",
        ...rest(updateMyPresence, "Kehadiran", "Atur status kehadiran Anda", object({ presence: schemas.presence }), {
            body: object({ status: schemas.presenceStatus }),
        }),
    )
    .get(
        "/preferences",
        ...rest(
            getMyPreferences,
            "Akun",
            "Ambil preferensi tampilan dan notifikasi",
            object({ preferences: object({ ...schemas.userPreferenceFields, updatedAt: nullable(dateTime) }) }),
        ),
    )
    .put(
        "/preferences",
        ...rest(
            updateMyPreferences,
            "Akun",
            "Perbarui preferensi tampilan dan notifikasi",
            object({ preferences: object({ ...schemas.userPreferenceFields, updatedAt: nullable(dateTime) }) }),
            { body: { ...object(schemas.userPreferenceFields, []), minProperties: 1 } },
        ),
    )
    .get(
        "/backup",
        ...rest(exportBackup, "Cadangan akun", "Ekspor cadangan akun", object({ backup: schemas.backup })),
    )
    .post(
        "/backup/restore",
        ...rest(
            restoreBackup,
            "Cadangan akun",
            "Pulihkan cadangan akun versi 1",
            object({
                restored: object({
                    directMessagesImported: integer(0),
                    channelMessagesImported: integer(0),
                    draftsImported: integer(0),
                    skipped: integer(0),
                }),
            }),
            { body: schemas.backupInput },
        ),
    )
    .get(
        "/translations/languages",
        ...rest(
            listTranslationLanguages,
            "Terjemahan",
            "Ambil daftar bahasa yang didukung",
            object({ languages: array(object({ code: string, name: string })) }),
            { errors: [503] },
        ),
    )
    .post(
        "/translations",
        ...rest(
            translateMessage,
            "Terjemahan",
            "Terjemahkan teks pesan",
            object({ translation: object({ text: string, sourceLanguage: string, targetLanguage: string }) }),
            {
                body: object({ text: text(1, 4000), sourceLanguage: string, targetLanguage: string }, [
                    "text",
                    "targetLanguage",
                ]),
                errors: [502, 503],
            },
        ),
    )
    .get(
        "/attachments",
        ...rest(listConversationAttachments, "Lampiran", "Ambil daftar lampiran percakapan", object({ attachments: array(schemas.attachment) }), {
            parameters: [query("targetType", schemas.scope, true), query("targetId", schemas.id, true)],
            errors: [400, 403],
        }),
    )
    .post(
        "/attachments/uploads",
        ...rest(
            createAttachmentUpload,
            "Lampiran",
            "Buat formulir upload bertanda tangan",
            object({
                attachment: object({ ...schemas.attachmentInputFields, id: schemas.id }),
                upload: object({
                    method: choice("POST"),
                    url: uri,
                    fields: { type: "object", additionalProperties: string },
                    expiresAt: dateTime,
                }),
            }),
            { status: 201, body: object(schemas.attachmentInputFields), errors: [403, 415, 503] },
        ),
    )
    .post(
        "/attachments/:attachmentId/complete",
        ...rest(completeAttachmentUpload, "Lampiran", "Verifikasi dan selesaikan upload lampiran", object({ attachment: schemas.attachment }), {
            errors: [400, 404, 409, 410, 502, 503],
        }),
    )
    .get(
        "/attachments/:attachmentId/download-url",
        ...rest(getAttachmentDownloadUrl, "Lampiran", "Buat URL unduhan sementara", object({ url: uri, expiresInSeconds: integer(1) }), {
            errors: [404, 503],
        }),
    )
    .get(
        "/attachments/:attachmentId/preview",
        ...rest(getAttachmentPreview, "Lampiran", "Buka pratinjau lampiran", undefined, {
            public: true,
            description: "Siapa pun yang memiliki URL ini dapat membuka pratinjau lampiran.",
            responses: { 302: redirectResponse("URL pratinjau sementara.") },
            errors: [404, 503],
        }),
    )
    .delete(
        "/attachments/:attachmentId",
        ...rest(deleteAttachment, "Lampiran", "Hapus lampiran milik akun ini", undefined, { status: 204, errors: [404, 502] }),
    );

export { apiRoutes };
