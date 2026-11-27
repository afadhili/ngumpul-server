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
const allowedOrigin = process.env.CORS_ORIGIN;
const oneMiB = 1024 * 1024;
const bodyLimitError = { error: "Request body must not exceed 1 MiB" };
type WithBodyLimit<Routes> = ApplyGlobalResponse<Routes, { 413: { json: typeof bodyLimitError } }>;

app.use("*", secureHeaders({ overwrite: false }));

app.use(
    "/api/*",
    bodyLimit({
        maxSize: oneMiB,
        onError: c => c.json(bodyLimitError, 413),
    }),
);

app.use(
    "/api/*",
    cors({
        origin: "*",
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        exposeHeaders: ["Content-Length"],
        maxAge: 600,
        credentials: true,
    }),
);

app.use("/api/auth/oauth-popup/*", async (c, next) => {
    await next();
    c.header("Cross-Origin-Opener-Policy", "unsafe-none");
});
app.use("/api/auth/callback/*", async (c, next) => {
    await next();
    c.header("Cross-Origin-Opener-Policy", "unsafe-none");
});

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
