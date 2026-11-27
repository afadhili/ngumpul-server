import { Hono, type Context } from "hono";
import { handleAuth } from "../controllers/auth.controller";
import { auth } from "../lib/auth";
import { query, redirectResponse, rest, uri } from "../openapi/describe";

const authRoutes = new Hono();

function trustedOrigins(): string[] {
    return [process.env.CORS_ORIGIN, process.env.BETTER_AUTH_URL]
        .filter((value): value is string => Boolean(value))
        .map(value => {
            try {
                return new URL(value).origin;
            } catch {
                return null;
            }
        })
        .filter((value): value is string => Boolean(value));
}

function isTrustedRedirect(value: string): boolean {
    try {
        return trustedOrigins().includes(new URL(value).origin);
    } catch {
        return false;
    }
}

/**
 * Starts Google OAuth with a top-level navigation.
 *
 * The regular `POST /api/auth/sign-in/social` flow is a cross-site fetch when
 * the frontend lives on another origin. Browsers that block third-party
 * cookies then silently drop Better Auth's state cookie, so the callback fails
 * with `State mismatch`. Visiting this endpoint directly makes setting the
 * state cookie a first-party navigation; the callback can then verify it.
 */
authRoutes.get(
    "/google/start",
    ...rest(startGoogleSignIn, "Autentikasi", "Mulai login Google melalui navigasi browser", undefined, {
        public: true,
        description: "Memerlukan konfigurasi Google OAuth dan URL callback pada origin yang dipercaya.",
        parameters: [query("callbackURL", uri, true), query("errorCallbackURL", uri)],
        responses: { 302: redirectResponse("Alihkan ke Google dan simpan cookie state.") },
        errors: [400, 500, 502],
    }),
);

async function startGoogleSignIn(c: Context) {
    const callbackURL = c.req.query("callbackURL");
    const errorCallbackURL = c.req.query("errorCallbackURL") ?? callbackURL;

    if (!callbackURL || !errorCallbackURL || !isTrustedRedirect(callbackURL) || !isTrustedRedirect(errorCallbackURL)) {
        return c.json({ error: "Invalid callbackURL" }, 400);
    }

    try {
        const response = await auth.api.signInSocial({
            body: {
                provider: "google",
                callbackURL,
                errorCallbackURL,
                disableRedirect: true,
            },
            headers: c.req.raw.headers,
            asResponse: true,
        });

        const data = await response.json() as { url?: string };
        if (!response.ok || !data.url) {
            return c.json({ error: "Could not start Google sign-in" }, 502);
        }

        for (const cookie of response.headers.getSetCookie()) {
            c.header("Set-Cookie", cookie, { append: true });
        }
        c.header("Cache-Control", "no-store");
        c.header("Pragma", "no-cache");

        return c.redirect(data.url, 302);
    } catch (error) {
        console.error("Google sign-in start failed", error);
        return c.json({ error: "Could not start Google sign-in" }, 500);
    }
}

authRoutes.all("/*", handleAuth);

export { authRoutes };
