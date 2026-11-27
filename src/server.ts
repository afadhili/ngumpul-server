import "dotenv/config";
import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { pool } from "./db/index";
import { app } from "./app";
import { stopGraphqlServer } from "./routes/graphql.routes";
import { attachWebSocket } from "./controllers/websocket.controller";
import { closeEventService, connectEventService } from "./services/event.service";
import { closeRealtimeService, connectRealtimeService } from "./services/realtime.service";
import { closeObjectStorage, ensureBucketExists } from "./services/object-storage.service";
import { beginDrain } from "./services/runtime-health";
import { startBackgroundWorker, stopBackgroundWorker } from "./services/background.worker";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer from 0 to 65535");
}

const httpServer = serve({ fetch: app.fetch, port }, info => {
    console.log(`Server listening on http://localhost:${info.port}`);
    console.log(`WebSocket available at ws://localhost:${info.port}/ws/channel, /ws/dm and /ws/user`);
}) as HttpServer;
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 10_000;
httpServer.keepAliveTimeout = 5_000;

const sockets = attachWebSocket(httpServer);
void connectRealtimeService();
void connectEventService();
void ensureBucketExists().catch(() => { /* Storage logs failures and retries on the next attachment request. */ });
startBackgroundWorker();

let shuttingDown = false;
async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    beginDrain();

    const deadline = setTimeout(() => {
        console.error("[shutdown] Timed out draining the server");
        httpServer.closeAllConnections();
        sockets.terminate();
        process.exit(1);
    }, 20_000);
    deadline.unref();

    const drained = await Promise.allSettled([
        new Promise<void>((resolve, reject) => {
            httpServer.close(error => error ? reject(error) : resolve());
        }),
        sockets.close(),
        stopBackgroundWorker(),
    ]);

    closeRealtimeService();
    closeEventService();
    closeObjectStorage();
    const closed = await Promise.allSettled([stopGraphqlServer(), pool.end()]);
    clearTimeout(deadline);

    for (const result of [...drained, ...closed]) {
        if (result.status === "rejected") {
            console.error("[shutdown] Unable to close a server resource:", result.reason);
            process.exitCode = 1;
        }
    }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
