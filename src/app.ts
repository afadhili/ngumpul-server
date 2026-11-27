import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ApplyGlobalResponse } from "hono/client";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { registerOpenApi } from "./openapi/register";
import { apiRoutes } from "./routes/api.routes";
import { authRoutes } from "./routes/auth.routes";
import { healthRoutes } from "./routes/health.routes";
import { serverRoutes } from "./routes/server.routes";

const app = new Hono();
const browserOrigin = process.env.CORS_ORIGIN;
const oneMiB = 1024 * 1024;
const bodyLimitError = { error: "Request body must not exceed 1 MiB" };
type WithBodyLimit<Routes> = ApplyGlobalResponse<Routes, { 413: { json: typeof bodyLimitError } }>;

app.use("*", secureHeaders({ overwrite: false }));

const apiCors = cors({
    origin: origin => origin === browserOrigin ? origin : "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length", "set-auth-token"],
    maxAge: 600,
});

app.use("/api/*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (!origin) {
        c.header("Vary", "Origin", { append: true });
        return next();
    }
    if (origin === browserOrigin) {
        c.header("Access-Control-Allow-Credentials", "true");
    }
    return apiCors(c, next);
});

app.use(
    "/api/*",
    bodyLimit({
        maxSize: oneMiB,
        // The body may still be arriving. Keep the client from reusing this connection.
        onError: c => c.json(bodyLimitError, 413, { Connection: "close" }),
    }),
);

app.use("/api/auth/google/start", async (c, next) => {
    await next();
    console.log(`[oauth] google/start status=${c.res.status}`);
});

app.use("/api/auth/callback/google", async (c, next) => {
    const state = c.req.query("state") ? "present" : "missing";
    await next();
    console.log(`[oauth] google/callback state=${state} status=${c.res.status}`);
});

app.route("/api/auth", authRoutes);

const routes = app
    .route("/", healthRoutes)
    .route("/api", apiRoutes as WithBodyLimit<typeof apiRoutes>)
    .route("/api/servers", serverRoutes as WithBodyLimit<typeof serverRoutes>);
registerOpenApi(app);

export type AppType = typeof routes;
export { app };
