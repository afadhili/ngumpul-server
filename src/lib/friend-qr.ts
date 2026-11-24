import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Friend QR codes are stateless capability tokens: a base64url payload signed
 * with the application secret. Nothing is stored server-side, so a code can be
 * regenerated at any time and simply expires.
 */
type FriendQrPayload = { p: string; e: number };

function secret(): string {
    const value = process.env.BETTER_AUTH_SECRET;
    if (!value) throw new Error("BETTER_AUTH_SECRET is not configured");
    return value;
}

function base64url(input: Buffer | string): string {
    return Buffer.from(input).toString("base64url");
}

function signPayload(encoded: string): string {
    return createHmac("sha256", secret()).update(encoded).digest("base64url");
}

export function createFriendQrCode(userId: string, expiresInSeconds: number): { code: string; expiresAt: Date } {
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload: FriendQrPayload = { p: userId, e: expiresAtSeconds };
    const encoded = base64url(JSON.stringify(payload));
    return { code: `${encoded}.${signPayload(encoded)}`, expiresAt: new Date(expiresAtSeconds * 1000) };
}

export type FriendQrResult =
    | { ok: true; userId: string; expiresAt: Date }
    | { ok: false; status: 400 | 410; error: string };

export function readFriendQrCode(code: string): FriendQrResult {
    const trimmed = code.trim();
    if (trimmed.length === 0 || trimmed.length > 512) return { ok: false, status: 400, error: "A valid friend QR code is required" };
    const [encoded, signature, extra] = trimmed.split(".");
    if (!encoded || !signature || extra !== undefined) {
        return { ok: false, status: 400, error: "This friend QR code is not valid" };
    }
    const expected = Buffer.from(signPayload(encoded));
    const provided = Buffer.from(signature);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        return { ok: false, status: 400, error: "This friend QR code is not valid" };
    }
    let payload: unknown;
    try {
        payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
        return { ok: false, status: 400, error: "This friend QR code is not valid" };
    }
    if (typeof payload !== "object" || payload === null) {
        return { ok: false, status: 400, error: "This friend QR code is not valid" };
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.p !== "string" || typeof record.e !== "number") {
        return { ok: false, status: 400, error: "This friend QR code is not valid" };
    }
    const expiresAt = new Date(record.e * 1000);
    if (expiresAt.getTime() <= Date.now()) {
        return { ok: false, status: 410, error: "This friend QR code has expired" };
    }
    return { ok: true, userId: record.p, expiresAt };
}
