import type { Context } from "hono";
import { auth } from "../lib/auth";

export function handleAuth(c: Context) {
    return auth.handler(c.req.raw);
}
