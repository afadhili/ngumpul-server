import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { apiRoutes } from "./routes/api.routes";
import { authRoutes } from "./routes/auth.routes";
import { healthRoutes } from "./routes/health.routes";
import { serverRoutes } from "./routes/server.routes";

const app = new Hono();
const allowedOrigin = process.env.CORS_ORIGIN;
const oneMiB = 1024 * 1024;

app.use("*", secureHeaders({ overwrite: false }));

app.use(
    "/api/*",
    bodyLimit({
        maxSize: oneMiB,
        onError: c => c.json({ error: "Request body must not exceed 1 MiB" }, 413),
    }),
);

app.use(
    "/api/*",
    cors({
        origin: allowedOrigin ? [allowedOrigin] : [],
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        exposeHeaders: ["Content-Length"],
        maxAge: 600,
        credentials: true,
    }),
);

// The OAuth popup hands its result to window.opener. Hono's secureHeaders
// defaults to Cross-Origin-Opener-Policy: same-origin, which severs that
// opener relationship when the popup starts or returns from Google. Those two
// short-lived auth documents therefore opt out; every other API response keeps
// the strict default.
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

app.route("/", healthRoutes);
app.route("/api/auth", authRoutes);
app.route("/api", apiRoutes);
app.route("/api/servers", serverRoutes);

export { app };
