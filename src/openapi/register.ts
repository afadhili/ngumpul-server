import { serveStatic } from "@hono/node-server/serve-static";
import { swaggerUI } from "@hono/swagger-ui";
import { getCookies } from "better-auth/cookies";
import type { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { auth } from "../lib/auth";
import { getAuthDocumentation } from "./auth";
import { messageComponents } from "./schemas";

const swaggerAssetRoot = dirname(fileURLToPath(import.meta.resolve("swagger-ui-dist/package.json")));

export function registerOpenApi(app: Hono) {
    let spec: ReturnType<typeof buildSpec> | undefined;
    app.get("/openapi", async c => {
        spec ??= buildSpec(app).catch(error => {
            spec = undefined;
            throw error;
        });
        return c.json(await spec);
    });

    app.get("/docs/swagger-ui-dist/swagger-ui.css", serveStatic({ root: swaggerAssetRoot, path: "swagger-ui.css" }));
    app.get(
        "/docs/swagger-ui-dist/swagger-ui-bundle.js",
        serveStatic({ root: swaggerAssetRoot, path: "swagger-ui-bundle.js" }),
    );
    app.get(
        "/docs",
        swaggerUI({
            title: "Dokumentasi API Ngumpul",
            url: "/openapi",
            baseUrl: "/docs",
            deepLinking: true,
            docExpansion: "none",
            filter: true,
            validatorUrl: "none",
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
                description: "Referensi HTTP untuk REST, autentikasi, dan GraphQL Ngumpul.",
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
