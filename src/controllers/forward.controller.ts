import type { Context } from "hono";
import { getChannelAccess } from "../lib/channel-access";
import { canAccessDirectConversation } from "../lib/direct-conversation";
import type { MessageInput } from "../lib/message-input";
import { getSessionUserId } from "../lib/request-auth";
import { createChannelMessage, createDirectMessage } from "../services/message-create.service";

function forwardInput(sourceMessageId: string): MessageInput {
    return {
        text: null,
        attachmentId: null,
        replyToMessageId: null,
        forwardedFromId: sourceMessageId,
        location: null,
        attachmentDurationMs: null,
        expiresInSeconds: null,
        encrypted: false,
        poll: null,
    };
}

/**
 * Forwards an existing message the caller can read into a friend conversation or
 * a text channel. The source content is copied by the shared message service, so
 * the destination gets a normal persistent message tagged with `forwardedFromId`.
 */
export async function forwardMessage(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const sourceMessageId = c.req.param("messageId") ?? "";
    if (!sourceMessageId) return c.json({ error: "A message ID is required" }, 400);

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return c.json({ error: "Request body must be an object" }, 400);
    }
    const record = body as Record<string, unknown>;
    const scope = record.scope === "direct" || record.scope === "channel" ? record.scope : null;
    const targetId = typeof record.targetId === "string" ? record.targetId.trim() : "";
    if (!scope) return c.json({ error: "scope must be direct or channel" }, 400);
    if (!targetId || targetId.length > 128) return c.json({ error: "A targetId is required" }, 400);

    const input = forwardInput(sourceMessageId);
    if (scope === "direct") {
        if (!await canAccessDirectConversation(userId, targetId)) {
            return c.json({ error: "You cannot forward messages to this conversation" }, 403);
        }
        const result = await createDirectMessage(userId, targetId, input);
        if (!result.ok) return c.json({ error: result.error }, result.status);
        return c.json({ message: { ...result.message, replyTo: result.replyTo } }, 201);
    }

    const access = await getChannelAccess(userId, targetId);
    if (!access || access.kind !== "text") return c.json({ error: "Channel not found" }, 404);
    const result = await createChannelMessage(userId, access, input);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ message: { ...result.message, replyTo: result.replyTo } }, 201);
}
