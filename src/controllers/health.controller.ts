import type { Context } from "hono";
import { isReady } from "../services/runtime-health";

export function getHealth(c: Context) {
    return c.json({ status: "ok" } as const, 200);
}

export async function getReadiness(c: Context) {
    c.header("Cache-Control", "no-store");
    return await isReady() ? c.json({ status: "ready" } as const, 200) : c.json({ status: "unavailable" } as const, 503);
}
