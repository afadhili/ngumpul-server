export type MessageLocationInput = { lat: number; lng: number; label: string | null };

export type MessagePollInput = {
    question: string;
    options: string[];
    allowMultiple: boolean;
    anonymous: boolean;
    closesAt: Date | null;
};

export type MessageInput = {
    text: string | null;
    attachmentId: string | null;
    replyToMessageId: string | null;
    forwardedFromId: string | null;
    location: MessageLocationInput | null;
    attachmentDurationMs: number | null;
    expiresInSeconds: number | null;
    encrypted: boolean;
    poll: MessagePollInput | null;
};

export type ParseFailure = { error: string; status: 400 | 413 | 415 };

const MAX_POLL_OPTIONS = 12;
const MAX_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

export function parseMessageInput(body: Record<string, unknown>): { value: MessageInput } | ParseFailure {
    const text = body.text === undefined || body.text === null ? null : body.text;
    if (text !== null && typeof text !== "string") return fail("text must be a string");
    const trimmed = typeof text === "string" ? text.trim() || null : null;
    if (trimmed && trimmed.length > 4000) return fail("text must contain at most 4000 characters");

    const attachmentId = parseId(body.attachmentId, "attachmentId");
    if (attachmentId === INVALID) return fail("attachmentId must be an attachment ID");
    const replyToMessageId = parseId(body.replyToMessageId, "replyToMessageId");
    if (replyToMessageId === INVALID) return fail("replyToMessageId must be a message ID");
    const forwardedFromId = parseId(body.forwardedFromId, "forwardedFromId");
    if (forwardedFromId === INVALID) return fail("forwardedFromId must be a message ID");

    const location = parseLocation(body.location);
    if (location === INVALID) return fail("location must provide lat between -90 and 90 and lng between -180 and 180");

    let attachmentDurationMs: number | null = null;
    if (body.attachmentDurationMs !== undefined && body.attachmentDurationMs !== null) {
        const value = body.attachmentDurationMs;
        if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 24 * 60 * 60 * 1000) {
            return fail("attachmentDurationMs must be a non-negative integer below one day");
        }
        attachmentDurationMs = value as number;
    }

    let expiresInSeconds: number | null = null;
    if (body.expiresInSeconds !== undefined && body.expiresInSeconds !== null) {
        const value = body.expiresInSeconds;
        if (!Number.isInteger(value) || (value as number) < 5 || (value as number) > MAX_EXPIRY_SECONDS) {
            return fail(`expiresInSeconds must be null or between 5 and ${MAX_EXPIRY_SECONDS}`);
        }
        expiresInSeconds = value as number;
    }

    const poll = parsePoll(body.poll);
    if (poll === INVALID) return fail("poll must contain a question and 2 to 12 non-empty options");

    if (!trimmed && !attachmentId && !location && !poll) {
        return fail("A text message, attachment, location, or poll is required");
    }

    return {
        value: {
            text: trimmed,
            attachmentId,
            replyToMessageId,
            forwardedFromId,
            location,
            attachmentDurationMs,
            expiresInSeconds,
            encrypted: body.encrypted === true,
            poll,
        },
    };
}

const INVALID = Symbol("invalid");

function fail(error: string): ParseFailure {
    return { error, status: 400 };
}

function parseId(value: unknown, field: string): string | null | typeof INVALID {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || value.length === 0 || value.length > 128) return INVALID;
    void field;
    return value;
}

function parseLocation(value: unknown): MessageLocationInput | null | typeof INVALID {
    if (value === undefined || value === null) return null;
    if (typeof value !== "object" || Array.isArray(value)) return INVALID;
    const record = value as Record<string, unknown>;
    const lat = record.lat;
    const lng = record.lng;
    if (typeof lat !== "number" || typeof lng !== "number") return INVALID;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return INVALID;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return INVALID;
    const label = record.label;
    if (label !== undefined && label !== null && (typeof label !== "string" || label.length > 200)) return INVALID;
    return { lat, lng, label: typeof label === "string" ? label.trim() || null : null };
}

function parsePoll(value: unknown): MessagePollInput | null | typeof INVALID {
    if (value === undefined || value === null) return null;
    if (typeof value !== "object" || Array.isArray(value)) return INVALID;
    const record = value as Record<string, unknown>;
    const question = typeof record.question === "string" ? record.question.trim() : "";
    if (!question || question.length > 300) return INVALID;
    if (!Array.isArray(record.options)) return INVALID;
    const options = record.options
        .map(option => (typeof option === "string" ? option.trim() : ""))
        .filter(Boolean);
    if (options.length < 2 || options.length > MAX_POLL_OPTIONS) return INVALID;
    if (options.some(option => option.length > 100)) return INVALID;
    let closesAt: Date | null = null;
    if (record.closesAt !== undefined && record.closesAt !== null) {
        if (typeof record.closesAt !== "string") return INVALID;
        const parsed = new Date(record.closesAt);
        if (Number.isNaN(parsed.getTime())) return INVALID;
        if (parsed.getTime() <= Date.now()) return INVALID;
        if (parsed.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000) return INVALID;
        closesAt = parsed;
    }
    return {
        question,
        options,
        allowMultiple: record.allowMultiple === true,
        anonymous: record.anonymous === true,
        closesAt,
    };
}
