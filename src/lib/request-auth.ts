import type { Context } from "hono";
import { auth } from "./auth";

export async function getSessionUserId(c: Context) {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    return session?.user.id ?? null;
}
