import { Hono } from "hono";
import { handleAuth } from "../controllers/auth.controller";

const authRoutes = new Hono();
authRoutes.all("/*", handleAuth);

export { authRoutes };
