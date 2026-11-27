import { serveStatic } from "@hono/node-server/serve-static";
import { Scalar } from "@scalar/hono-api-reference";
import { getCookies } from "better-auth/cookies";
import type { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auth } from "../lib/auth";
import { getAuthDocumentation } from "./auth";
import { messageComponents } from "./schemas";

const scalarBundleUrl = "/docs/scalar.js";
const scalarAssetRoot = join(dirname(fileURLToPath(import.meta.resolve("@scalar/api-reference"))), "browser");

export function registerOpenApi(app: Hono) {
    let spec: ReturnType<typeof buildSpec> | undefined;
    app.get("/openapi", async c => {
        spec ??= buildSpec(app).catch(error => {
            spec = undefined;
            throw error;
        });
        return c.json(await spec);
    });

    app.get(scalarBundleUrl, serveStatic({ root: scalarAssetRoot, path: "standalone.js" }));
    app.get(
        "/docs",
        Scalar({
            pageTitle: "Dokumentasi API Ngumpul",
            url: "/openapi",
            cdn: scalarBundleUrl,
            authentication: { preferredSecurityScheme: "bearerAuth" },
            persistAuth: false,
            telemetry: false,
            withDefaultFonts: false,
            showDeveloperTools: "localhost",
        }),
    );
}

async function buildSpec(app: Hono) {
    const authDocs = await getAuthDocumentation();
    return generateSpecs(app, {
        documentation: {
            info: {
                title: "Ngumpul API",
                version: "1.0.0",
                description: "Referensi HTTP untuk REST dan autentikasi Ngumpul.",
            },
            servers: [{ url: "/", description: "Origin server saat ini" }],
            paths: authDocs.paths,
            components: {
                schemas: { ...authDocs.schemas, ...messageComponents },
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer",
                        description: "Token sesi Ngumpul dari respons login.",
                    },
                    sessionCookie: {
                        type: "apiKey",
                        in: "cookie",
                        name: getCookies(auth.options).sessionToken.name,
                        description: "Cookie sesi yang dikirim browser setelah login.",
                    },
                },
            },
        },
    });
}
