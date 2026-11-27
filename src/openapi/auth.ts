import type { OpenAPIV3_1 } from "openapi-types";
import { auth } from "../lib/auth";
import { redirectResponse, sessionSecurity, string, uri } from "./describe";

const publicPaths = new Set([
    "/ok",
    "/sign-up/email",
    "/sign-in/email",
    "/sign-in/email-otp",
    "/send-verification-email",
    "/verify-email",
    "/email-otp/send-verification-otp",
    "/email-otp/check-verification-otp",
    "/email-otp/verify-email",
    "/email-otp/request-password-reset",
    "/email-otp/reset-password",
    "/forget-password/email-otp",
    "/request-password-reset",
    "/reset-password/{token}",
    "/reset-password",
    "/error",
    "/sign-in/social",
    "/callback/{id}",
    "/expo-authorization-proxy",
    "/electron/init-oauth-proxy",
    "/electron/token",
]);
const optionalSessionPaths = new Set(["/get-session", "/sign-out"]);
const disabledPaths = new Set([
    "/change-email",
    "/email-otp/request-email-change",
    "/email-otp/change-email",
    "/update-session",
    "/delete-user",
    "/delete-user/callback",
]);

type AuthSchemas = NonNullable<OpenAPIV3_1.ComponentsObject["schemas"]>;

export async function getAuthDocumentation(): Promise<{ paths: OpenAPIV3_1.PathsObject; schemas: AuthSchemas }> {
    const generated = await auth.api.generateOpenAPISchema();
    normalizeNullable(generated);
    const { paths: generatedPaths, components } = generated;
    const paths: OpenAPIV3_1.PathsObject = {};
    for (const [path, pathItem] of Object.entries(generatedPaths)) {
        if (disabledPaths.has(path) || path === "/dash" || path.startsWith("/dash/")) continue;
        const operations: OpenAPIV3_1.PathItemObject = {};
        for (const method of ["get", "post", "put", "patch", "delete"] as const) {
            const operation = pathItem[method];
            // Refresh via POST /get-session requires session.deferSessionRefresh.
            if (!operation || (path === "/get-session" && method === "post")) continue;

            const documented = {
                ...operation,
                tags: ["Autentikasi"],
                security: publicPaths.has(path)
                    ? []
                    : optionalSessionPaths.has(path)
                      ? [{}, ...sessionSecurity]
                      : sessionSecurity,
            } as NonNullable<OpenAPIV3_1.PathItemObject[typeof method]>;

            if (path === "/callback/{id}") {
                documented.summary = "Tangani callback dari provider OAuth";
                documented.responses = {
                    ...documented.responses,
                    302: redirectResponse("Alihkan ke URL callback atau halaman error."),
                };
                if (method === "post" && documented.requestBody && !("$ref" in documented.requestBody)) {
                    const json = documented.requestBody.content["application/json"];
                    if (json) documented.requestBody.content["application/x-www-form-urlencoded"] = json;
                }
            }
            if (path === "/expo-authorization-proxy") {
                documented.summary = "Mulai OAuth dari Expo";
                documented.parameters = [
                    { in: "query", name: "authorizationURL", required: true, schema: uri },
                    { in: "query", name: "oauthState", schema: string },
                ];
                documented.responses = {
                    ...documented.responses,
                    302: redirectResponse("Alihkan ke penyedia OAuth."),
                };
            }
            if (path === "/electron/init-oauth-proxy" || path === "/electron/transfer-user") {
                const isOAuthProxy = path === "/electron/init-oauth-proxy";
                documented.parameters = [isOAuthProxy ? "provider" : "client_id", "state", "code_challenge"]
                    .map(name => ({ in: "query", name, required: true, schema: string }));
                if (isOAuthProxy) {
                    documented.responses = {
                        ...documented.responses,
                        302: redirectResponse("Alihkan ke penyedia OAuth."),
                    };
                }
            }
            operations[method] = documented;
        }
        paths[`/api/auth${path}`] = operations;
    }
    // Better Auth types model fields as database fields even after converting them to OpenAPI schemas.
    return { paths, schemas: components.schemas as AuthSchemas };
}

// Better Auth still emits OpenAPI 3.0 nullable fields in some endpoint metadata.
function normalizeNullable(value: unknown): void {
    if (typeof value !== "object" || value === null) return;

    if (
        "nullable" in value &&
        typeof value.nullable === "boolean" &&
        "type" in value &&
        typeof value.type === "string"
    ) {
        if (value.nullable) value.type = [value.type, "null"];
        delete value.nullable;
    }
    for (const child of Object.values(value)) normalizeNullable(child);
}
