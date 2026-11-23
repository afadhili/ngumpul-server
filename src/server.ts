import "dotenv/config";
import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { pool } from "./db/index";
import { app } from "./app";
import { attachWebSocket } from "./controllers/websocket.controller";
import { closeRealtimeService, connectRealtimeService } from "./services/realtime.service";
import { ensureBucketExists } from "./services/object-storage.service";

const port = Number(process.env.PORT ?? 3000);

await Promise.all([connectRealtimeService(), ensureBucketExists()]);

const server = serve({ fetch: app.fetch, port }, info => {
    console.log(`Server listening on http://localhost:${info.port}`);
    console.log(`WebSocket chat available at ws://localhost:${info.port}/ws?room=lobby`);
});
const closeWebSocketServer = attachWebSocket(server as HttpServer);

let shuttingDown = false;
const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    closeWebSocketServer();
    server.close();
    await Promise.all([closeRealtimeService(), pool.end()]);
    process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
