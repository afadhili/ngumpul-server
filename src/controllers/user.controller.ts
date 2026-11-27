import type { Context } from "hono";
import { auth } from "../lib/auth";

export async function getCurrentUser(c: Context) {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    return c.json({ user: session.user }, 200);
}
