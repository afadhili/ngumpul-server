import { Hono } from "hono";
import { getHealth, getReadiness } from "../controllers/health.controller";
import { choice, jsonResponse, object, rest } from "../openapi/describe";

const healthRoutes = new Hono()
    .get(
        "/health",
        ...rest(getHealth, "Kesehatan", "Periksa apakah server HTTP merespons", object({ status: choice("ok") }), { public: true }),
    )
    .get(
        "/ready",
        ...rest(getReadiness, "Kesehatan", "Periksa kesiapan API dan PostgreSQL", object({ status: choice("ready") }), {
            public: true,
            responses: { 503: jsonResponse("API belum siap menerima trafik.", object({ status: choice("unavailable") })) },
        }),
    );

export { healthRoutes };
