import { Hono } from "hono";
import { getHealth } from "../controllers/health.controller";
import { choice, object, rest } from "../openapi/describe";

const healthRoutes = new Hono();
healthRoutes.get(
    "/health",
    rest("Kesehatan", "Periksa apakah server HTTP merespons", object({ status: choice("ok") }), { public: true }),
    getHealth,
);

export { healthRoutes };
