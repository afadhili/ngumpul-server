import "dotenv/config";
import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { pool } from "./db/index";
import { app } from "./app";
import { stopGraphqlServer } from "./routes/graphql.routes";
import { attachWebSocket } from "./controllers/websocket.controller";
import { closeEventService, connectEventService } from "./services/event.service";
import { closeRealtimeService, connectRealtimeService } from "./services/realtime.service";
import { ensureBucketExists } from "./services/object-storage.service";
import { startBackgroundWorker, stopBackgroundWorker } from "./services/background.worker";

const port = Number(process.env.PORT ?? 3000);

await Promise.all([connectRealtimeService(), connectEventService(), ensureBucketExists()]);

const server = serve({ fetch: app.fetch, port }, info => {
    console.log(`Server listening on http://localhost:${info.port}`);
    console.log(`WebSocket available at ws://localhost:${info.port}/ws/channel, /ws/dm and /ws/user`);
});
const httpServer = server as HttpServer;
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 10_000;
httpServer.keepAliveTimeout = 5_000;
const closeWebSocketServer = attachWebSocket(httpServer);
startBackgroundWorker();

let shuttingDown = false;
const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    closeWebSocketServer();
    stopBackgroundWorker();
    server.close();
    await Promise.all([closeRealtimeService(), closeEventService(), stopGraphqlServer(), pool.end()]);
    process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
