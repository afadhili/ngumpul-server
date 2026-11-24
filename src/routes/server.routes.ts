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
import {
    addChannelMessageReaction,
    removeChannelMessageReaction,
} from "../controllers/reaction.controller";
import {
    deleteChannelMessage,
    editChannelMessage,
    listChannelMessages,
    sendChannelMessage,
} from "../controllers/channel-message.controller";

const serverRoutes = new Hono();
serverRoutes.get("/", listServers);
serverRoutes.post("/", createServer);
serverRoutes.post("/invites/:code/join", joinServerWithInvite);

serverRoutes.patch("/:serverId", updateServer);
serverRoutes.delete("/:serverId", deleteServer);

serverRoutes.get("/:serverId/channels", listServerChannels);
serverRoutes.post("/:serverId/channels", createServerChannel);
serverRoutes.patch("/:serverId/channels/:channelId", updateServerChannel);
serverRoutes.delete("/:serverId/channels/:channelId", deleteServerChannel);
serverRoutes.post("/:serverId/channels/:channelId/voice-token", getVoiceChannelToken);

serverRoutes.get("/:serverId/channels/:channelId/messages", listChannelMessages);
serverRoutes.post("/:serverId/channels/:channelId/messages", sendChannelMessage);
serverRoutes.patch("/:serverId/channels/:channelId/messages/:messageId", editChannelMessage);
serverRoutes.post("/:serverId/channels/:channelId/messages/:messageId/reactions", addChannelMessageReaction);
serverRoutes.delete("/:serverId/channels/:channelId/messages/:messageId/reactions/:emoji", removeChannelMessageReaction);
serverRoutes.delete("/:serverId/channels/:channelId/messages/:messageId", deleteChannelMessage);

serverRoutes.get("/:serverId/members", listServerMembers);
serverRoutes.post("/:serverId/members", addServerMember);
serverRoutes.patch("/:serverId/members/:userId", updateServerMember);
serverRoutes.delete("/:serverId/members/:userId", removeServerMember);

serverRoutes.post("/:serverId/invites", createServerInvite);

export { serverRoutes };
