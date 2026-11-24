import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { auth } from "../lib/auth";
import { getChannelAccess } from "../lib/channel-access";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { onUserEvent } from "../services/event.service";
import { onChatMessage } from "../services/realtime.service";
import { registerChannelSocket, registerDirectSocket } from "../services/socket-registry.service";

const REVALIDATE_INTERVAL_MS = 60_000;

export function attachWebSocket(server: Server) {
    const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    type SocketScope =
        | { type: "channel"; userId: string; serverId: string; channelId: string }
        | { type: "direct"; userId: string; peerId: string }
        | { type: "user"; userId: string };
    const scopes = new WeakMap<WebSocket, SocketScope>();

    const unsubscribe = onChatMessage(message => {
        for (const client of webSocketServer.clients) {
            const scope = scopes.get(client);
            if (client.readyState !== WebSocket.OPEN || !scope) continue;

            if (message.type === "direct_message") {
                const isVisible = scope.type === "direct"
                    && (scope.userId === message.senderId || scope.userId === message.recipientId)
                    && (scope.peerId === message.senderId || scope.peerId === message.recipientId);
                if (isVisible) client.send(JSON.stringify(message));
            } else if (message.type === "channel_message") {
                const isVisible = scope.type === "channel" && scope.channelId === message.channelId;
                if (isVisible) client.send(JSON.stringify(message));
            }
        }
    });

    const unsubscribeUserEvents = onUserEvent((recipients, event) => {
        for (const client of webSocketServer.clients) {
            const scope = scopes.get(client);
            if (client.readyState !== WebSocket.OPEN || !scope || scope.type !== "user") continue;
            if (recipients.includes(scope.userId)) client.send(JSON.stringify(event));
        }
    });

    server.on("upgrade", (request, socket, head) => {
        void (async () => {
            const url = new URL(request.url ?? "/", "http://localhost");
            if (!isTrustedWebSocketOrigin(request)) return reject(socket, 403, "Forbidden origin");

            let scope: SocketScope;
            if (url.pathname === "/ws/channel") {
                const channelId = url.searchParams.get("channelId")?.trim() ?? "";
                if (!channelId) return reject(socket, 400, "channelId is required");
                const session = await readSession(request, url.searchParams.get("token"));
                if (!session) return reject(socket, 401, "Unauthorized");
                const access = await getChannelAccess(session.user.id, channelId);
                if (!access || access.kind !== "text") return reject(socket, 403, "Forbidden");
                scope = { type: "channel", userId: session.user.id, serverId: access.serverId, channelId };
            } else if (url.pathname === "/ws/dm") {
                const peerId = url.searchParams.get("peerId")?.trim() ?? "";
                if (!peerId) return reject(socket, 400, "peerId is required");
                const session = await readSession(request, url.searchParams.get("token"));
                if (!session) return reject(socket, 401, "Unauthorized");
                if (!await canAccessDirectConversation(session.user.id, peerId)) return reject(socket, 403, "Forbidden");
                scope = { type: "direct", userId: session.user.id, peerId };
            } else if (url.pathname === "/ws/user") {
                const session = await readSession(request, url.searchParams.get("token"));
                if (!session) return reject(socket, 401, "Unauthorized");
                scope = { type: "user", userId: session.user.id };
            } else {
                return reject(socket, 404, "Not found");
            }

            webSocketServer.handleUpgrade(request, socket, head, webSocket => {
                scopes.set(webSocket, scope);
                webSocket.send(JSON.stringify(scope.type === "channel"
                    ? { type: "connected", channelId: scope.channelId, serverId: scope.serverId }
                    : scope.type === "direct"
                        ? { type: "connected", conversationWith: scope.peerId }
                        : { type: "connected", userId: scope.userId }));

                const channelScope = scope.type === "channel" ? scope : null;
                const directScope = scope.type === "direct" ? scope : null;
                const unregister = channelScope
                    ? registerChannelSocket({
                        socket: webSocket,
                        userId: channelScope.userId,
                        serverId: channelScope.serverId,
                        channelId: channelScope.channelId,
                    })
                    : directScope
                        ? registerDirectSocket({
                            socket: webSocket,
                            userId: directScope.userId,
                            peerId: directScope.peerId,
                        })
                        : () => undefined;

                const revalidate = channelScope
                    ? setInterval(() => {
                        void getChannelAccess(channelScope.userId, channelScope.channelId).then(access => {
                            if (!access || access.kind !== "text") {
                                webSocket.close(4003, "You no longer have access to this channel");
                            }
                        }).catch(error => console.error("Unable to revalidate channel access:", error));
                    }, REVALIDATE_INTERVAL_MS)
                    : null;
                revalidate?.unref();

                webSocket.on("close", () => {
                    if (revalidate) clearInterval(revalidate);
                    unregister();
                    scopes.delete(webSocket);
                });
                webSocket.on("message", () => {
                    if (webSocket.readyState === WebSocket.OPEN) {
                        webSocket.send(JSON.stringify({ type: "error", error: "Send messages through the authenticated REST API" }));
                    }
                });
                webSocket.on("error", error => console.error("WebSocket error:", error.message));
            });
        })().catch(error => {
            console.error("WebSocket upgrade failed:", error);
            reject(socket, 500, "WebSocket upgrade failed");
        });
    });

    return () => {
        unsubscribe();
        unsubscribeUserEvents();
        for (const client of webSocketServer.clients) client.terminate();
        webSocketServer.close();
    };
}

async function readSession(request: IncomingMessage, token?: string | null) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    // Browsers cannot set Authorization on WebSocket handshakes, so accept the
    // same session token as a query parameter for cross-site clients.
    if (token) headers.set("authorization", `Bearer ${token}`);
    return auth.api.getSession({ headers });
}

function isTrustedWebSocketOrigin(request: IncomingMessage) {
    const origin = request.headers.origin;
    // Non-browser clients do not send Origin; browsers always do. Browsers also
    // attach cookies to WebSocket handshakes regardless of the opener origin,
    // so a mismatched Origin must be rejected to prevent cross-site hijacking.
    if (!origin) return true;

    const trusted = [process.env.CORS_ORIGIN, process.env.BETTER_AUTH_URL]
        .filter((value): value is string => Boolean(value))
        .map(toOrigin)
        .filter((value): value is string => Boolean(value));
    return trusted.includes(toOrigin(origin) ?? "");
}

function toOrigin(value: string) {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

function reject(socket: import("node:stream").Duplex, status: number, message: string) {
    if (socket.destroyed) return;
    const statusText = status === 401
        ? "Unauthorized"
        : status === 403
            ? "Forbidden"
            : status === 404
                ? "Not Found"
                : status === 500
                    ? "Internal Server Error"
                    : "Bad Request";
    socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
    socket.destroy();
}
