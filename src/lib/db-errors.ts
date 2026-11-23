/**
 * Drizzle wraps driver errors in DrizzleQueryError, so the PostgreSQL error
 * code lives on the `cause` chain rather than the thrown object itself.
 */
export function isUniqueViolation(error: unknown) {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
        if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
        current = "cause" in current ? (current as { cause?: unknown }).cause : null;
    }
    return false;
}
