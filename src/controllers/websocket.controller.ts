import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { parseChatMessage, type ChatMessage } from "../models/chat-message";
import { auth } from "../lib/auth";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import { onChatMessage, publishChatMessage } from "../services/realtime.service";

export function attachWebSocket(server: Server) {
    const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    type SocketScope = { type: "room"; room: string } | { type: "direct"; userId: string; peerId: string };
    const scopes = new WeakMap<WebSocket, SocketScope>();
    const unsubscribe = onChatMessage(message => {
        for (const client of webSocketServer.clients) {
            const scope = scopes.get(client);
            if (client.readyState !== WebSocket.OPEN || !scope) continue;
            const isVisible = message.type === "message"
                ? scope.type === "room" && scope.room === message.room
                : scope.type === "direct"
                    && (scope.userId === message.senderId || scope.userId === message.recipientId)
                    && (scope.peerId === message.senderId || scope.peerId === message.recipientId);
            if (isVisible) {
                client.send(JSON.stringify(message));
            }
        }
    });

    server.on("upgrade", (request, socket, head) => {
        void (async () => {
            const url = new URL(request.url ?? "/", "http://localhost");
            let scope: SocketScope;
            if (url.pathname === "/ws") {
                const room = (url.searchParams.get("room") ?? "lobby").trim();
                if (!room || room.length > 100) return reject(socket, 400, "Invalid room");
                scope = { type: "room", room };
            } else if (url.pathname === "/ws/dm") {
                const peerId = url.searchParams.get("peerId")?.trim() ?? "";
                if (!peerId) return reject(socket, 400, "peerId is required");
                const headers = new Headers();
                for (const [key, value] of Object.entries(request.headers)) {
                    if (typeof value === "string") headers.set(key, value);
                    else if (Array.isArray(value)) headers.set(key, value.join(", "));
                }
                const session = await auth.api.getSession({ headers });
                if (!session) return reject(socket, 401, "Unauthorized");
                if (!await canAccessDirectConversation(session.user.id, peerId)) return reject(socket, 403, "Forbidden");
                scope = { type: "direct", userId: session.user.id, peerId };
            } else {
                return reject(socket, 404, "Not found");
            }

            webSocketServer.handleUpgrade(request, socket, head, webSocket => {
                scopes.set(webSocket, scope);
                webSocket.send(JSON.stringify(scope.type === "room"
                    ? { type: "connected", room: scope.room }
                    : { type: "connected", conversationWith: scope.peerId }));
                webSocket.on("message", data => {
                    if (scope.type !== "room") {
                        webSocket.send(JSON.stringify({ type: "error", error: "Send direct messages through the authenticated API" }));
                        return;
                    }
                    const parsed = parseChatMessage(data.toString(), scope.room);
                    if (!parsed) {
                        webSocket.send(JSON.stringify({ type: "error", error: "Invalid message" }));
                        return;
                    }

                    const message: ChatMessage = {
                        type: "message",
                        id: randomUUID(),
                        room: scope.room,
                        text: parsed.text,
                        sentAt: new Date().toISOString(),
                    };
                    void publishChatMessage(message).catch(error => {
                        console.error("Unable to publish chat message:", error);
                        if (webSocket.readyState === WebSocket.OPEN) {
                            webSocket.send(JSON.stringify({ type: "error", error: "Message delivery failed" }));
                        }
                    });
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
        for (const client of webSocketServer.clients) client.terminate();
        webSocketServer.close();
    };
}

function reject(socket: import("node:stream").Duplex, status: number, message: string) {
    if (!socket.destroyed) {
        socket.write(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Bad Request"}\r\nConnection: close\r\n\r\n${message}`);
        socket.destroy();
    }
}
