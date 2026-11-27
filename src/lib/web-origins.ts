import "dotenv/config";

function originOf(value: string | undefined) {
    if (!value) return null;
    try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
    } catch {
        return null;
    }
}

export const browserOrigins = new Set(
    (process.env.CORS_ORIGIN ?? "")
        .split(",")
        .map(originOf)
        .filter((origin): origin is string => origin !== null),
);
const authOrigin = originOf(process.env.BETTER_AUTH_URL);

export function isTrustedWebOrigin(value: string) {
    const origin = originOf(value);
    return origin !== null && (origin === authOrigin || browserOrigins.has(origin));
}
