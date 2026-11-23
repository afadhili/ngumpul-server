import { Hono } from "hono";
import { getHealth } from "../controllers/health.controller";

const healthRoutes = new Hono();
healthRoutes.get("/health", getHealth);

export { healthRoutes };
