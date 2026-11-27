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

const apiRoutes = new Hono();
apiRoutes.get("/me", rest("Akun", "Ambil akun yang sedang login", object({ user: schemas.account })), getCurrentUser);
apiRoutes.get(
    "/profile",
    rest("Profil", "Ambil profil akun", object({ profile: schemas.profile }), { errors: [404] }),
    getProfile,
);
apiRoutes.get(
    "/profile/username-availability",
    rest("Profil", "Cek ketersediaan username", object({ username: schemas.username, available: boolean }), {
        parameters: [query("username", schemas.username, true)],
        errors: [400],
    }),
    checkUsernameAvailability,
);
apiRoutes.put(
    "/profile",
    rest("Profil", "Simpan profil akun", object({ profile: schemas.savedProfile }), {
        body: schemas.profileInput,
        errors: [409],
    }),
    updateProfile,
);
apiRoutes.get(
    "/users/search",
    rest("Profil", "Cari pengguna publik berdasarkan awalan username", object({ users: array(schemas.contact) }), {
        parameters: [query("username", text(2, 24), true)],
        errors: [400],
    }),
    searchUsers,
);
apiRoutes.get(
    "/blocks",
    rest(
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
    listBlockedUsers,
);
apiRoutes.post(
    "/users/:userId/block",
    rest("Akun", "Blokir pengguna dan putuskan pertemanan", undefined, { status: 204, errors: [400, 404] }),
    blockUser,
);
apiRoutes.delete(
    "/users/:userId/block",
    rest("Akun", "Buka blokir pengguna", undefined, { status: 204, errors: [404] }),
    unblockUser,
);
apiRoutes.post(
    "/users/:userId/reports",
    rest(
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
    reportUser,
);
apiRoutes.get(
    "/privacy",
    rest("Akun", "Ambil pengaturan privasi", object({ privacy: object(schemas.privacyFields) })),
    getPrivacySettings,
);
apiRoutes.put(
    "/privacy",
    rest("Akun", "Perbarui pengaturan privasi", object({ privacy: object(schemas.privacyFields) }), {
        body: { ...object(schemas.privacyFields, []), minProperties: 1 },
    }),
    updatePrivacySettings,
);
apiRoutes.get(
    "/friends",
    rest("Pertemanan", "Ambil daftar teman", object({ friends: array(schemas.contact) })),
    listFriends,
);
apiRoutes.get(
    "/friends/requests",
    rest(
        "Pertemanan",
        "Ambil permintaan pertemanan masuk dan keluar",
        object({ incoming: array(schemas.pendingFriendRequest), outgoing: array(schemas.pendingFriendRequest) }),
    ),
    listFriendRequests,
);
apiRoutes.post(
    "/friends/requests",
    rest("Pertemanan", "Kirim permintaan pertemanan", object({ request: schemas.friendRequest }), {
        status: 201,
        body: object({ username: schemas.username }),
        errors: [403, 404, 409],
    }),
    sendFriendRequest,
);
apiRoutes.post(
    "/friends/requests/:requestId/accept",
    rest("Pertemanan", "Terima permintaan pertemanan", object({ request: schemas.friendRequest }), { errors: [404] }),
    acceptFriendRequest,
);
apiRoutes.post(
    "/friends/requests/:requestId/decline",
    rest("Pertemanan", "Tolak permintaan pertemanan", object({ request: schemas.friendRequest }), { errors: [404] }),
    declineFriendRequest,
);
apiRoutes.post(
    "/friends/requests/:requestId/cancel",
    rest("Pertemanan", "Batalkan permintaan pertemanan", object({ request: schemas.friendRequest }), { errors: [404] }),
    cancelFriendRequest,
);
apiRoutes.get(
    "/friends/qr",
    rest(
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
    createFriendQr,
);
apiRoutes.get(
    "/friends/qr/:code",
    rest(
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
    previewFriendQr,
);
apiRoutes.post(
    "/friends/qr/claim",
    rest(
        "Pertemanan",
        "Kirim permintaan pertemanan menggunakan kode QR",
        object({ request: schemas.friendRequest, user: schemas.friendQrUser }),
        { status: 201, body: object({ code: string }), errors: [403, 404, 409, 410] },
    ),
    claimFriendQr,
);
apiRoutes.delete(
    "/friends/:userId",
    rest("Pertemanan", "Hapus teman", undefined, { status: 204, errors: [404] }),
    removeFriend,
);
apiRoutes.get(
    "/direct-messages/:id",
    rest("Pesan pribadi", "Ambil riwayat pesan dengan teman", schemas.messagePage(schemas.directMessage), {
        parameters: [peerParameter, ...schemas.historyQuery],
        errors: [400, 403],
    }),
    listDirectMessages,
);
apiRoutes.post(
    "/direct-messages/:id",
    rest("Pesan pribadi", "Kirim pesan ke teman", object({ message: schemas.directMessage }), {
        status: 201,
        parameters: [peerParameter],
        body: schemas.directMessageInput,
        errors: [403, 415],
    }),
    sendDirectMessage,
);
apiRoutes.patch(
    "/direct-messages/:id",
    rest("Pesan pribadi", "Edit teks pesan yang Anda kirim", object({ message: schemas.directMessage }), {
        parameters: [messageParameter],
        body: schemas.editMessageInput,
        errors: [403, 404],
    }),
    editDirectMessage,
);
apiRoutes.delete(
    "/direct-messages/:id",
    rest("Pesan pribadi", "Hapus pesan pribadi", undefined, {
        status: 204,
        parameters: [messageParameter, ...schemas.deleteScopeQuery],
        errors: [400, 403, 404, 502],
    }),
    deleteDirectMessage,
);
apiRoutes.post(
    "/direct-messages/:messageId/receipts",
    rest(
        "Pesan pribadi",
        "Tandai pesan masuk sebagai diterima atau dibaca",
        object({ status: schemas.receiptStatus, upToMessageId: schemas.id, updatedCount: integer(0) }),
        { body: object({ status: schemas.receiptStatus }), errors: [403, 404] },
    ),
    markDirectMessageReceipt,
);
apiRoutes.post(
    "/direct-messages/:messageId/reactions",
    rest("Pesan pribadi", "Tambahkan reaksi ke pesan pribadi", schemas.reactions, {
        body: schemas.reactionInput,
        errors: [403, 404],
    }),
    addDirectMessageReaction,
);
apiRoutes.delete(
    "/direct-messages/:messageId/reactions/:emoji",
    rest("Pesan pribadi", "Hapus reaksi dari pesan pribadi", schemas.reactions, { errors: [400, 403, 404] }),
    removeDirectMessageReaction,
);
apiRoutes.get(
    "/direct-messages/:peerId/pins",
    rest(
        "Pesan pribadi",
        "Ambil pesan sematan dalam percakapan pribadi",
        object({ messages: array(schemas.directMessage) }),
        { errors: [403] },
    ),
    listDirectPins,
);
apiRoutes.post(
    "/direct-messages/:messageId/pin",
    rest("Pesan pribadi", "Sematkan pesan pribadi", schemas.pinned, {
        status: 201,
        responses: { 200: jsonResponse("Pesan sudah disematkan.", schemas.pinned) },
        errors: [403, 404],
    }),
    pinDirectMessage,
);
apiRoutes.delete(
    "/direct-messages/:messageId/pin",
    rest("Pesan pribadi", "Lepas sematan pesan pribadi", undefined, { status: 204, errors: [403, 404] }),
    unpinDirectMessage,
);
apiRoutes.get(
    "/messages/search",
    rest("Pencarian pesan", "Cari pesan pribadi", schemas.messagePage(schemas.directMessageSearchResult), {
        parameters: [...schemas.searchQuery, query("peerId", schemas.id)],
        errors: [400, 403],
    }),
    searchDirectMessages,
);
apiRoutes.get(
    "/messages/search/channels",
    rest(
        "Pencarian pesan",
        "Cari pesan di channel teks yang Anda ikuti",
        schemas.messagePage(schemas.channelMessageSearchResult),
        { parameters: schemas.searchQuery, errors: [400] },
    ),
    searchChannelMessages,
);
apiRoutes.post(
    "/messages/:messageId/forward",
    rest(
        "Percakapan",
        "Teruskan pesan ke percakapan lain",
        object({ message: { anyOf: [schemas.directMessage, schemas.channelMessage] } }),
        { body: object({ scope: schemas.scope, targetId: schemas.id }), status: 201, errors: [403, 404] },
    ),
    forwardMessage,
);
apiRoutes.get(
    "/polls/:pollId",
    rest("Polling", "Ambil hasil dan status polling", schemas.pollResult, { errors: [404] }),
    getPoll,
);
apiRoutes.post(
    "/polls/:pollId/votes",
    rest("Polling", "Pilih opsi dalam polling", schemas.pollResult, {
        body: {
            ...object({ optionId: schemas.id, optionIds: { type: "array", minItems: 1, items: schemas.id } }, []),
            anyOf: [{ required: ["optionId"] }, { required: ["optionIds"] }],
        },
        errors: [404, 409],
    }),
    voteOnPoll,
);
apiRoutes.delete(
    "/polls/:pollId/votes",
    rest("Polling", "Tarik suara Anda dari polling", schemas.pollResult, { errors: [404, 409] }),
    retractPollVote,
);
apiRoutes.post(
    "/polls/:pollId/close",
    rest("Polling", "Tutup pemungutan suara", schemas.pollResult, { errors: [403, 404] }),
    closePoll,
);
apiRoutes.get(
    "/channels/:channelId/read-state",
    rest("Percakapan", "Ambil status baca channel", schemas.readState, { errors: [404] }),
    getChannelReadState,
);
apiRoutes.put(
    "/channels/:channelId/read-state",
    rest("Percakapan", "Perbarui penanda baca channel", schemas.readState, {
        body: {
            ...object({ messageId: nullable(schemas.id), markedUnread: boolean }, []),
            anyOf: [{ required: ["messageId"], properties: { messageId: schemas.id } }, { required: ["markedUnread"] }],
        },
        errors: [404],
    }),
    updateChannelReadState,
);
apiRoutes.get(
    "/conversations",
    rest(
        "Percakapan",
        "Ambil daftar preferensi percakapan",
        object({ conversations: array(schemas.conversationPreference) }),
        {
            parameters: [query("scope", schemas.scope), query("favorite", boolean), query("archived", boolean)],
            errors: [400],
        },
    ),
    listConversations,
);
apiRoutes.get(
    "/conversations/:scope/:targetId",
    rest("Percakapan", "Ambil preferensi satu percakapan", object({ preference: schemas.conversationPreference }), {
        parameters: [conversationScope],
        errors: [400, 403],
    }),
    getConversationPreferenceHandler,
);
apiRoutes.patch(
    "/conversations/:scope/:targetId",
    rest(
        "Percakapan",
        "Perbarui preferensi percakapan",
        object({ preference: nullable(schemas.conversationPreference) }),
        { parameters: [conversationScope], body: schemas.conversationInput, errors: [403] },
    ),
    updateConversationPreference,
);
apiRoutes.get("/drafts", rest("Draf", "Ambil daftar draf pesan", object({ drafts: array(schemas.draft) })), listDrafts);
apiRoutes.put(
    "/drafts/:scope/:targetId",
    rest("Draf", "Simpan draf pesan", object({ draft: schemas.draft }), {
        parameters: [conversationScope],
        body: object({ text: text(0, 4000), replyToMessageId: nullable(schemas.id) }, []),
        responses: { 204: { description: "Draf kosong dihapus." } },
        errors: [403],
    }),
    saveDraft,
);
apiRoutes.delete(
    "/drafts/:scope/:targetId",
    rest("Draf", "Hapus draf pesan", undefined, { status: 204, parameters: [conversationScope], errors: [400, 404] }),
    deleteDraft,
);
apiRoutes.get(
    "/scheduled-messages",
    rest(
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
    listScheduledMessages,
);
apiRoutes.post(
    "/scheduled-messages",
    rest("Pesan terjadwal", "Jadwalkan pengiriman pesan", object({ scheduledMessage: schemas.scheduledMessage }), {
        status: 201,
        body: schemas.scheduledInput,
        errors: [403],
    }),
    createScheduledMessage,
);
apiRoutes.patch(
    "/scheduled-messages/:scheduledMessageId",
    rest(
        "Pesan terjadwal",
        "Ubah pesan terjadwal yang masih menunggu",
        object({ scheduledMessage: schemas.scheduledMessage }),
        {
            body: { ...object({ text: text(1, 4000), scheduledFor: dateTime }, []), minProperties: 1 },
            errors: [404, 409],
        },
    ),
    updateScheduledMessage,
);
apiRoutes.delete(
    "/scheduled-messages/:scheduledMessageId",
    rest("Pesan terjadwal", "Batalkan pengiriman pesan terjadwal", undefined, { status: 204, errors: [404] }),
    cancelScheduledMessage,
);
apiRoutes.get(
    "/notifications",
    rest(
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
    listNotifications,
);
apiRoutes.get(
    "/notifications/unread-count",
    rest("Notifikasi", "Hitung notifikasi belum dibaca", object({ unreadCount: integer(0) })),
    getUnreadNotificationCount,
);
apiRoutes.post(
    "/notifications/read-all",
    rest("Notifikasi", "Tandai semua notifikasi sudah dibaca", object({ updatedCount: integer(0) })),
    markAllNotificationsRead,
);
apiRoutes.delete(
    "/notifications/read",
    rest("Notifikasi", "Hapus semua notifikasi yang sudah dibaca", object({ deletedCount: integer(0) })),
    clearReadNotifications,
);
apiRoutes.post(
    "/notifications/:notificationId/read",
    rest("Notifikasi", "Tandai satu notifikasi sudah dibaca", object({ notification: schemas.notification }), {
        errors: [404],
    }),
    markNotificationRead,
);
apiRoutes.delete(
    "/notifications/:notificationId",
    rest("Notifikasi", "Hapus satu notifikasi", undefined, { status: 204, errors: [404] }),
    deleteNotification,
);
apiRoutes.get(
    "/presence",
    rest("Kehadiran", "Ambil status kehadiran teman", object({ presences: array(schemas.presence) })),
    listFriendPresence,
);
apiRoutes.get(
    "/presence/:userId",
    rest("Kehadiran", "Ambil status kehadiran satu pengguna", object({ presence: schemas.presence }), {
        errors: [403],
    }),
    getUserPresence,
);
apiRoutes.put(
    "/presence",
    rest("Kehadiran", "Atur status kehadiran Anda", object({ presence: schemas.presence }), {
        body: object({ status: schemas.presenceStatus }),
    }),
    updateMyPresence,
);
apiRoutes.get(
    "/preferences",
    rest(
        "Akun",
        "Ambil preferensi tampilan dan notifikasi",
        object({ preferences: object({ ...schemas.userPreferenceFields, updatedAt: nullable(dateTime) }) }),
    ),
    getMyPreferences,
);
apiRoutes.put(
    "/preferences",
    rest(
        "Akun",
        "Perbarui preferensi tampilan dan notifikasi",
        object({ preferences: object({ ...schemas.userPreferenceFields, updatedAt: nullable(dateTime) }) }),
        { body: { ...object(schemas.userPreferenceFields, []), minProperties: 1 } },
    ),
    updateMyPreferences,
);
apiRoutes.get(
    "/backup",
    rest("Cadangan akun", "Ekspor cadangan akun", object({ backup: schemas.backup })),
    exportBackup,
);
apiRoutes.post(
    "/backup/restore",
    rest(
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
        { body: { anyOf: [schemas.backupInput, object({ backup: schemas.backupInput })] } },
    ),
    restoreBackup,
);
apiRoutes.get(
    "/translations/languages",
    rest(
        "Terjemahan",
        "Ambil daftar bahasa yang didukung",
        object({ languages: array(object({ code: string, name: string })) }),
        { errors: [503] },
    ),
    listTranslationLanguages,
);
apiRoutes.post(
    "/translations",
    rest(
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
    translateMessage,
);
apiRoutes.get(
    "/attachments",
    rest("Lampiran", "Ambil daftar lampiran percakapan", object({ attachments: array(schemas.attachment) }), {
        parameters: [query("targetType", schemas.scope, true), query("targetId", schemas.id, true)],
        errors: [400, 403],
    }),
    listConversationAttachments,
);
apiRoutes.post(
    "/attachments/uploads",
    rest(
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
    createAttachmentUpload,
);
apiRoutes.post(
    "/attachments/:attachmentId/complete",
    rest("Lampiran", "Verifikasi dan selesaikan upload lampiran", object({ attachment: schemas.attachment }), {
        errors: [400, 404, 409, 410, 502],
    }),
    completeAttachmentUpload,
);
apiRoutes.get(
    "/attachments/:attachmentId/download-url",
    rest("Lampiran", "Buat URL unduhan sementara", object({ url: uri, expiresInSeconds: integer(1) }), {
        errors: [404, 503],
    }),
    getAttachmentDownloadUrl,
);
apiRoutes.get(
    "/attachments/:attachmentId/preview",
    rest("Lampiran", "Buka pratinjau lampiran", undefined, {
        public: true,
        description: "Siapa pun yang memiliki URL ini dapat membuka pratinjau lampiran.",
        responses: { 302: redirectResponse("URL pratinjau sementara.") },
        errors: [404, 503],
    }),
    getAttachmentPreview,
);
apiRoutes.delete(
    "/attachments/:attachmentId",
    rest("Lampiran", "Hapus lampiran milik akun ini", undefined, { status: 204, errors: [404, 502] }),
    deleteAttachment,
);

export { apiRoutes };
