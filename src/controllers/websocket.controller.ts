import { STATUS_CODES, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { auth } from "../lib/auth";
import { getChannelAccess } from "../lib/channel-access";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { onUserEvent, publishUserEvent } from "../services/event.service";
import { broadcastPresence, markOffline, markOnline } from "../services/presence.service";
import { getServerMemberIds } from "../services/server-event.service";
import { onRedisRecovery } from "../services/redis-pubsub";
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
    const activeWork = new Set<Promise<unknown>>();
    let draining = false;

    function track<T>(operation: Promise<T>) {
        activeWork.add(operation);
        const forget = () => { activeWork.delete(operation); };
        void operation.then(forget, forget);
        return operation;
    }

    const unsubscribeRecovery = onRedisRecovery(() => {
        for (const client of webSocketServer.clients) {
            if (client.readyState === WebSocket.OPEN) client.close(1012, "Realtime service recovered");
        }
    });

    const unsubscribe = onChatMessage(message => {
        for (const client of webSocketServer.clients) {
            const scope = scopes.get(client);
            if (client.readyState !== WebSocket.OPEN || !scope) continue;

            if (message.type === "direct_message") {
                const peerId = scope.userId === message.senderId ? message.recipientId
                    : scope.userId === message.recipientId ? message.senderId : undefined;
                const isVisible = peerId && (scope.type === "user" ||
                    (scope.type === "direct" && scope.peerId === peerId));
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

    function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
        track((async () => {
            const url = new URL(request.url ?? "/", "http://localhost");
            // Browsers pass the token in the URL because they cannot set Authorization here.
            const headerToken = request.headers.authorization?.match(/^Bearer +(.+)$/i)?.[1]?.trim();
            const token = url.searchParams.get("token")?.trim() || headerToken;
            if (!token && !isTrustedWebSocketOrigin(request)) return reject(socket, 403, "Forbidden origin");

            let scope: SocketScope;
            if (url.pathname === "/ws/channel") {
                const channelId = url.searchParams.get("channelId")?.trim() ?? "";
                if (!channelId) return reject(socket, 400, "channelId is required");
                const session = await readSession(request, token);
                if (!session) return reject(socket, 401, "Unauthorized");
                const access = await getChannelAccess(session.user.id, channelId);
                if (!access || access.kind !== "text") return reject(socket, 403, "Forbidden");
                scope = { type: "channel", userId: session.user.id, serverId: access.serverId, channelId };
            } else if (url.pathname === "/ws/dm") {
                const peerId = url.searchParams.get("peerId")?.trim() ?? "";
                if (!peerId) return reject(socket, 400, "peerId is required");
                const session = await readSession(request, token);
                if (!session) return reject(socket, 401, "Unauthorized");
                if (!await canAccessDirectConversation(session.user.id, peerId)) return reject(socket, 403, "Forbidden");
                scope = { type: "direct", userId: session.user.id, peerId };
            } else if (url.pathname === "/ws/user") {
                const session = await readSession(request, token);
                if (!session) return reject(socket, 401, "Unauthorized");
                scope = { type: "user", userId: session.user.id };
            } else {
                return reject(socket, 404, "Not found");
            }

            if (draining) return reject(socket, 503, "Server is shutting down");
            webSocketServer.handleUpgrade(request, socket, head, webSocket => {
                scopes.set(webSocket, scope);
                webSocket.send(JSON.stringify(scope.type === "channel"
                    ? { type: "connected", channelId: scope.channelId, serverId: scope.serverId }
                    : scope.type === "direct"
                        ? { type: "connected", conversationWith: scope.peerId }
                        : { type: "connected", userId: scope.userId }));

                if (scope.type === "user") {
                    const online = track(markOnline(scope.userId)
                        .then(() => broadcastPresence(scope.userId))
                        .catch(error => console.error("Unable to mark presence online:", error)));
                    webSocket.on("close", () => {
                        track(online.then(() => markOffline(scope.userId))
                            .then(() => broadcastPresence(scope.userId))
                            .catch(error => console.error("Unable to mark presence offline:", error)));
                    });
                }

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
                        if (draining) return;
                        track(getChannelAccess(channelScope.userId, channelScope.channelId).then(access => {
                            if (!access || access.kind !== "text") {
                                webSocket.close(4003, "You no longer have access to this channel");
                            }
                        }).catch(error => console.error("Unable to revalidate channel access:", error)));
                    }, REVALIDATE_INTERVAL_MS)
                    : null;
                revalidate?.unref();

                webSocket.on("close", () => {
                    if (revalidate) clearInterval(revalidate);
                    unregister();
                    scopes.delete(webSocket);
                });
                const typingWindow = { lastSent: 0 };
                webSocket.on("message", raw => {
                    if (!draining) {
                        track(handleClientMessage(webSocket, scopes.get(webSocket) ?? scope, raw, typingWindow)
                            .catch(error => console.error("Unable to handle WebSocket message:", error)));
                    }
                });
                webSocket.on("error", error => console.error("WebSocket error:", error.message));
            });
        })().catch(error => {
            console.error("WebSocket upgrade failed:", error);
            reject(socket, 500, "WebSocket upgrade failed");
        }));
    }
    server.on("upgrade", upgrade);

    return {
        terminate() {
            for (const client of webSocketServer.clients) client.terminate();
        },
        async close() {
            draining = true;
            server.off("upgrade", upgrade);
            unsubscribe();
            unsubscribeUserEvents();
            unsubscribeRecovery();
            for (const client of webSocketServer.clients) client.close(1001, "Server shutting down");
            await new Promise<void>((resolve, reject) => {
                webSocketServer.close(error => error ? reject(error) : resolve());
            });
            await Promise.allSettled(activeWork);
        },
    };
}


type TypingWindow = { lastSent: number };
const TYPING_THROTTLE_MS = 1500;

async function handleClientMessage(
    socket: WebSocket,
    scope: { type: "channel"; userId: string; serverId: string; channelId: string }
        | { type: "direct"; userId: string; peerId: string }
        | { type: "user"; userId: string },
    raw: import("ws").RawData,
    window: TypingWindow,
) {
    if (socket.readyState !== WebSocket.OPEN) return;
    let payload: unknown;
    try {
        payload = JSON.parse(raw.toString());
    } catch {
        socket.send(JSON.stringify({ type: "error", error: "Invalid JSON payload" }));
        return;
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        socket.send(JSON.stringify({ type: "error", error: "Invalid payload" }));
        return;
    }
    const message = payload as Record<string, unknown>;
    if (message.type !== "typing") {
        socket.send(JSON.stringify({ type: "error", error: "Send messages through the authenticated REST API" }));
        return;
    }
    if (scope.type === "user") {
        socket.send(JSON.stringify({ type: "error", error: "Typing events belong to a conversation socket" }));
        return;
    }
    const now = Date.now();
    if (now - window.lastSent < TYPING_THROTTLE_MS) return;
    window.lastSent = now;

    const event = {
        type: "typing" as const,
        scope: scope.type === "channel" ? ("channel" as const) : ("direct" as const),
        userId: scope.userId,
        ...(scope.type === "channel"
            ? { serverId: scope.serverId, channelId: scope.channelId }
            : { peerId: scope.peerId }),
        expiresAt: new Date(now + 6000).toISOString(),
    };
    try {
        if (scope.type === "direct") {
            await publishUserEvent([scope.peerId], event);
        } else {
            const memberIds = await getServerMemberIds(scope.serverId);
            await publishUserEvent(memberIds.filter(id => id !== scope.userId), event);
        }
    } catch (error) {
        console.error("Unable to publish typing event:", error);
    }
}

async function readSession(request: IncomingMessage, token: string | undefined) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    if (token) {
        // An explicit token must authenticate on its own before accepting any origin.
        headers.delete("cookie");
        headers.set("authorization", `Bearer ${token}`);
    }
    return auth.api.getSession({ headers });
}

function isTrustedWebSocketOrigin(request: IncomingMessage) {
    const origin = request.headers.origin;
    // Browsers can attach cookies even when a different origin opens the socket.
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

function reject(socket: Duplex, status: number, message: string) {
    if (socket.destroyed) return;
    socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
}
