import { Hono } from "hono";
import {
    addServerMember,
    createServer,
    createServerChannel,
    createServerInvite,
    deleteServer,
    deleteServerChannel,
    getVoiceChannelToken,
    joinServerWithInvite,
    listServerChannels,
    listServerMembers,
    listServers,
    removeServerMember,
    updateServer,
    updateServerChannel,
    updateServerMember,
} from "../controllers/server.controller";
import { addChannelMessageReaction, removeChannelMessageReaction } from "../controllers/reaction.controller";
import {
    deleteChannelMessage,
    editChannelMessage,
    listChannelMessages,
    sendChannelMessage,
} from "../controllers/channel-message.controller";
import { listChannelPins, pinChannelMessage, unpinChannelMessage } from "../controllers/pin.controller";
import { getServerUnreadCounts } from "../controllers/read-state.controller";
import { searchChannelMessages } from "../controllers/search.controller";
import { listVoiceParticipants, updateVoiceParticipant } from "../controllers/voice.controller";

import {
    array,
    boolean,
    choice,
    dateTime,
    integer,
    jsonResponse,
    nullable,
    object,
    rest,
    string,
    uri,
} from "../openapi/describe";
import * as schemas from "../openapi/schemas";

const serverRoutes = new Hono()
    .get(
        "/",
        ...rest(
            listServers,
            "Grup",
            "Ambil daftar grup yang Anda ikuti",
            object({ servers: array(object({ ...schemas.serverFields, role: schemas.memberRole, joinedAt: dateTime })) }),
        ),
    )
    .post(
        "/",
        ...rest(createServer, "Grup", "Buat grup dan channel teks general", object({ server: schemas.server }), {
            status: 201,
            body: object(schemas.serverInputFields, ["name"]),
        }),
    )
    .post(
        "/invites/:code/join",
        ...rest(joinServerWithInvite, "Grup", "Gabung ke grup dengan kode undangan", object({ serverId: schemas.id, joined: boolean }), {
            status: 201,
            errors: [404, 409, 410],
        }),
    )
    .patch(
        "/:serverId",
        ...rest(updateServer, "Grup", "Ubah grup sebagai owner atau admin", object({ server: schemas.server }), {
            body: { ...object({ ...schemas.serverInputFields, icon: nullable(uri) }, []), minProperties: 1 },
            errors: [403, 404],
        }),
    )
    .delete(
        "/:serverId",
        ...rest(deleteServer, "Grup", "Hapus grup sebagai owner", undefined, { status: 204, errors: [403, 404, 502] }),
    )
    .get(
        "/:serverId/unread",
        ...rest(
            getServerUnreadCounts,
            "Channel",
            "Hitung pesan belum dibaca per channel teks",
            object({
                channels: array(
                    object({ channelId: schemas.id, unreadCount: integer(0), lastMessageAt: nullable(dateTime) }),
                ),
            }),
            { errors: [404] },
        ),
    )
    .get(
        "/:serverId/channels",
        ...rest(listServerChannels, "Channel", "Ambil daftar channel grup", object({ channels: array(schemas.channel) }), { errors: [404] }),
    )
    .post(
        "/:serverId/channels",
        ...rest(createServerChannel, "Channel", "Buat channel teks atau suara sebagai owner atau admin", object({ channel: schemas.channel }), {
            status: 201,
            body: object({ ...schemas.channelInputFields, kind: schemas.channelKind }, ["name", "kind"]),
            errors: [403, 404, 409],
        }),
    )
    .patch(
        "/:serverId/channels/:channelId",
        ...rest(updateServerChannel, "Channel", "Ubah channel sebagai owner atau admin", object({ channel: schemas.channel }), {
            body: { ...object({ ...schemas.channelInputFields, position: integer(0, 1_000_000) }, []), minProperties: 1 },
            errors: [403, 404, 409],
        }),
    )
    .delete(
        "/:serverId/channels/:channelId",
        ...rest(deleteServerChannel, "Channel", "Hapus channel sebagai owner atau admin", undefined, { status: 204, errors: [403, 404, 502] }),
    )
    .post(
        "/:serverId/channels/:channelId/voice-token",
        ...rest(
            getVoiceChannelToken,
            "LiveKit",
            "Buat token untuk masuk ke channel suara",
            object({ url: uri, token: string, room: string, expiresInSeconds: integer(1) }),
            { errors: [404, 503] },
        ),
    )
    .get(
        "/:serverId/channels/:channelId/voice-participants",
        ...rest(
            listVoiceParticipants,
            "LiveKit",
            "Ambil peserta channel suara dan status media",
            object({ room: string, participants: array(schemas.voiceParticipant) }),
            { errors: [404, 502, 503] },
        ),
    )
    .patch(
        "/:serverId/channels/:channelId/voice-participants/:identity",
        ...rest(
            updateVoiceParticipant,
            "LiveKit",
            "Atur mikrofon atau keluarkan peserta dari channel suara",
            object({ ok: boolean, identity: string, muted: nullable(boolean), removed: boolean }),
            {
                body: {
                    ...object({ muted: boolean, remove: boolean }, []),
                    anyOf: [{ required: ["muted"] }, { required: ["remove"], properties: { remove: { const: true } } }],
                },
                errors: [403, 404, 502, 503],
            },
        ),
    )
    .get(
        "/:serverId/channels/:channelId/messages",
        ...rest(listChannelMessages, "Pesan channel", "Ambil riwayat pesan channel teks", schemas.messagePage(schemas.channelMessage), {
            parameters: schemas.historyQuery,
            errors: [400, 404],
        }),
    )
    .post(
        "/:serverId/channels/:channelId/messages",
        ...rest(sendChannelMessage, "Pesan channel", "Kirim pesan ke channel teks", object({ message: schemas.channelMessage }), {
            status: 201,
            body: schemas.channelMessageInput,
            errors: [403, 404, 409, 415],
        }),
    )
    .get(
        "/:serverId/channels/:channelId/messages/search",
        ...rest(
            searchChannelMessages,
            "Pencarian pesan",
            "Cari pesan dalam satu channel teks",
            schemas.messagePage(schemas.channelMessageSearchResult),
            { parameters: schemas.searchQuery, errors: [400, 404] },
        ),
    )
    .patch(
        "/:serverId/channels/:channelId/messages/:messageId",
        ...rest(editChannelMessage, "Pesan channel", "Edit teks pesan channel yang Anda kirim", object({ message: schemas.channelMessage }), {
            body: schemas.editMessageInput,
            errors: [404],
        }),
    )
    .post(
        "/:serverId/channels/:channelId/messages/:messageId/reactions",
        ...rest(addChannelMessageReaction, "Pesan channel", "Tambahkan reaksi ke pesan channel", schemas.reactions, {
            body: schemas.reactionInput,
            errors: [404],
        }),
    )
    .delete(
        "/:serverId/channels/:channelId/messages/:messageId/reactions/:emoji",
        ...rest(removeChannelMessageReaction, "Pesan channel", "Hapus reaksi dari pesan channel", schemas.reactions, { errors: [400, 404] }),
    )
    .post(
        "/:serverId/channels/:channelId/messages/:messageId/pin",
        ...rest(pinChannelMessage, "Pesan channel", "Sematkan pesan channel", schemas.pinned, {
            status: 201,
            responses: { 200: jsonResponse("Pesan sudah disematkan.", schemas.pinned) },
            errors: [404],
        }),
    )
    .delete(
        "/:serverId/channels/:channelId/messages/:messageId/pin",
        ...rest(unpinChannelMessage, "Pesan channel", "Lepas sematan pesan channel", undefined, { status: 204, errors: [404] }),
    )
    .delete(
        "/:serverId/channels/:channelId/messages/:messageId",
        ...rest(deleteChannelMessage, "Pesan channel", "Hapus pesan channel", undefined, {
            status: 204,
            parameters: schemas.deleteScopeQuery,
            errors: [400, 403, 404, 502],
        }),
    )
    .get(
        "/:serverId/channels/:channelId/pins",
        ...rest(listChannelPins, "Pesan channel", "Ambil pesan sematan dalam channel", object({ messages: array(schemas.channelMessage) }), {
            errors: [404],
        }),
    )
    .get(
        "/:serverId/members",
        ...rest(listServerMembers, "Grup", "Ambil daftar anggota grup", object({ members: array(schemas.member) }), { errors: [404] }),
    )
    .post(
        "/:serverId/members",
        ...rest(addServerMember, "Grup", "Tambahkan anggota grup sebagai owner atau admin", object({ member: schemas.member }), {
            status: 201,
            body: {
                ...object({ username: schemas.username, userId: schemas.id }, []),
                anyOf: [{ required: ["username"] }, { required: ["userId"] }],
            },
            errors: [403, 404, 409],
        }),
    )
    .patch(
        "/:serverId/members/:userId",
        ...rest(updateServerMember, "Grup", "Ubah peran anggota sebagai owner", object({ member: schemas.member }), {
            body: object({ role: choice("admin", "member") }),
            errors: [403, 404],
        }),
    )
    .delete(
        "/:serverId/members/:userId",
        ...rest(removeServerMember, "Grup", "Keluar dari grup atau keluarkan anggota", undefined, { status: 204, errors: [400, 403, 404] }),
    )
    .post(
        "/:serverId/invites",
        ...rest(
            createServerInvite,
            "Grup",
            "Buat undangan grup sebagai owner atau admin",
            object({
                invite: object({
                    code: string,
                    serverId: schemas.id,
                    expiresAt: nullable(dateTime),
                    maxUses: nullable(integer(1, 1000)),
                }),
            }),
            {
                status: 201,
                optionalBody: true,
                body: object(
                    {
                        expiresInSeconds: nullable({ ...integer(60, 2_592_000), default: 604_800 }),
                        maxUses: nullable(integer(1, 1000)),
                    },
                    [],
                ),
                errors: [403, 404],
            },
        ),
    );

export { serverRoutes };
