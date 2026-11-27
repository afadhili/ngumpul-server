import { Hono } from "hono";
import { getHealth, getReadiness } from "../controllers/health.controller";
import { choice, jsonResponse, object, rest } from "../openapi/describe";

const healthRoutes = new Hono();
healthRoutes.get(
    "/health",
    rest("Kesehatan", "Periksa apakah server HTTP merespons", object({ status: choice("ok") }), { public: true }),
    getHealth,
);

healthRoutes.get(
    "/ready",
    rest("Kesehatan", "Periksa kesiapan API dan PostgreSQL", object({ status: choice("ready") }), {
        public: true,
        responses: { 503: jsonResponse("API belum siap menerima trafik.", object({ status: choice("unavailable") })) },
    }),
    getReadiness,
);

export { healthRoutes };
