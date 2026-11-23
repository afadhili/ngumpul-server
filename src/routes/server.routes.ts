import { Hono } from "hono";
import {
    createServer,
    createServerChannel,
    createServerInvite,
    getVoiceChannelToken,
    joinServerWithInvite,
    listServerChannels,
    listServers,
} from "../controllers/server.controller";

const serverRoutes = new Hono();
serverRoutes.get("/", listServers);
serverRoutes.post("/", createServer);
serverRoutes.post("/invites/:code/join", joinServerWithInvite);
serverRoutes.post("/:serverId/invites", createServerInvite);
serverRoutes.get("/:serverId/channels", listServerChannels);
serverRoutes.post("/:serverId/channels", createServerChannel);
serverRoutes.post("/:serverId/channels/:channelId/voice-token", getVoiceChannelToken);

export { serverRoutes };
