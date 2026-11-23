import type { WebSocket } from "ws";

type ChannelSocket = {
    socket: WebSocket;
    userId: string;
    serverId: string;
    channelId: string;
};

type DirectSocket = {
    socket: WebSocket;
    userId: string;
    peerId: string;
};

const channelSockets = new Set<ChannelSocket>();
const directSockets = new Set<DirectSocket>();

export function registerChannelSocket(entry: ChannelSocket) {
    channelSockets.add(entry);
    return () => channelSockets.delete(entry);
}

export function registerDirectSocket(entry: DirectSocket) {
    directSockets.add(entry);
    return () => directSockets.delete(entry);
}

export function revokeUserFromServer(userId: string, serverId: string) {
    for (const entry of channelSockets) {
        if (entry.userId === userId && entry.serverId === serverId) {
            close(entry.socket, "You no longer have access to this server");
        }
    }
}

export function revokeServer(serverId: string) {
    for (const entry of channelSockets) {
        if (entry.serverId === serverId) close(entry.socket, "This server was deleted");
    }
}

export function revokeChannel(channelId: string) {
    for (const entry of channelSockets) {
        if (entry.channelId === channelId) close(entry.socket, "This channel was deleted");
    }
}

export function revokeDirectConversation(userId: string, peerId: string) {
    for (const entry of directSockets) {
        const isSamePair = (entry.userId === userId && entry.peerId === peerId)
            || (entry.userId === peerId && entry.peerId === userId);
        if (isSamePair) close(entry.socket, "You no longer have access to this conversation");
    }
}

function close(socket: WebSocket, reason: string) {
    if (socket.readyState === socket.OPEN) socket.close(4003, reason);
    else socket.terminate();
}
