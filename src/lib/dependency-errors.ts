export function dependencyEndpoint(value: string | undefined, protocols: string[], name: string, allowDefaultHost = false) {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        if (protocols.includes(url.protocol) && (url.hostname || allowDefaultHost)) return url.host || undefined;
    } catch {
        // Some URL parsing errors include the full input, which can contain credentials.
    }
    throw Object.assign(new Error(`${name} must be a valid ${protocols.join(" or ")} URL`), { code: `${name}_INVALID_URL` });
}

export function logDependencyError(service: string, endpoint: string | undefined, error: unknown) {
    const code = errorCode(error);
    console.error(`[${service}] ${endpoint ?? "configured endpoint"}: ${code}`);
}

function errorCode(error: unknown): string {
    if (!(error instanceof Error)) return "UnknownError";
    if ("code" in error && typeof error.code === "string") return error.code;
    if (error.cause instanceof Error) return errorCode(error.cause);
    if (error instanceof AggregateError && error.errors.length > 0) {
        return [...new Set(error.errors.map(errorCode))].join(", ");
    }
    if (error.name !== "Error") return error.name;
    if (error.message === "Connection terminated unexpectedly") return "CONNECTION_TERMINATED";
    if (error.message === "Query read timeout") return "QUERY_TIMEOUT";
    return error.constructor.name;
}
