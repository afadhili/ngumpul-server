import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiRoutes } from "./routes/api.routes";
import { authRoutes } from "./routes/auth.routes";
import { healthRoutes } from "./routes/health.routes";
import { serverRoutes } from "./routes/server.routes";

const app = new Hono();
const allowedOrigin = process.env.CORS_ORIGIN;

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

app.route("/", healthRoutes);
app.route("/api/auth", authRoutes);
app.route("/api", apiRoutes);
app.route("/api/servers", serverRoutes);

export { app };
