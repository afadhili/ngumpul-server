import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { electron } from "@better-auth/electron";
import { expo } from "@better-auth/expo";
import { dash } from "@better-auth/infra";
import type { Auth } from "better-auth";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { bearer, emailOTP, oauthPopup, openAPI } from "better-auth/plugins";
import "dotenv/config";
import { db } from "../db/index";
import * as schema from "../db/schema/auth";
import { sendVerificationOtpEmail } from "../services/email.service";

const secret = process.env.BETTER_AUTH_SECRET;
const baseURL = process.env.BETTER_AUTH_URL;
const usesHttps = baseURL?.startsWith("https://") ?? false;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const dashboardApiKey = process.env.BETTER_AUTH_API_KEY?.trim();
const expoScheme = readNativeScheme("BETTER_AUTH_EXPO_SCHEME", "ngumpul");
const electronScheme = readNativeScheme("BETTER_AUTH_ELECTRON_SCHEME", "id.my.afadhili.ngumpul");

function readNativeScheme(name: string, fallback: string) {
    const value = process.env[name]?.trim().toLowerCase() || fallback;
    const reservedSchemes = ["http", "https", "file", "ftp", "ws", "wss", "data", "javascript", "blob", "about"];
    if (!/^[a-z][a-z0-9+.-]*$/.test(value) || reservedSchemes.includes(value)) {
        throw new Error(`${name} must be a custom URL scheme without a colon or slashes`);
    }
    return value;
}

if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be set to a high-entropy value of at least 32 characters");
}

if (!baseURL) {
    throw new Error("BETTER_AUTH_URL is required");
}

if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set to enable Google sign-in");
}

const authOptions: BetterAuthOptions & {
    plugins: [ReturnType<typeof openAPI>, ...NonNullable<BetterAuthOptions["plugins"]>];
} = {
    secret,
    baseURL,
    trustedOrigins: [
        ...(process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : []),
        `${expoScheme}://`,
        `${electronScheme}:/`,
    ],
    advanced: {
        useSecureCookies: usesHttps,
        defaultCookieAttributes: {
            sameSite: usesHttps ? "none" : "lax",
            secure: usesHttps,
        },
    },
    database: drizzleAdapter(db, {
        provider: "pg",
        schema,
    }),
    user: {
        additionalFields: {
            username: {
                type: "string",
                required: false,
                input: false,
            },
        },
    },
    ...(googleClientId && googleClientSecret
        ? {
              socialProviders: {
                  google: {
                      clientId: googleClientId,
                      clientSecret: googleClientSecret,
                      requireEmailVerification: true,
                  },
              },
          }
        : {}),
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
        sendOnSignUp: true,
        sendOnSignIn: true,
    },
    rateLimit: {
        enabled: true,
        window: 60,
        max: 100,
        customRules: {
            "/email-otp/verify-email": { window: 60, max: 10 },
            "/email-otp/request-password-reset": { window: 60, max: 3 },
            "/email-otp/reset-password": { window: 60, max: 10 },
            "/forget-password/email-otp": { window: 60, max: 3 },
        },
    },
    disabledPaths: ["/open-api/generate-schema"],
    plugins: [
        openAPI({ disableDefaultReference: true }),
        emailOTP({
            overrideDefaultEmailVerification: true,
            otpLength: 6,
            expiresIn: 600,
            allowedAttempts: 5,
            storeOTP: "hashed",
            sendVerificationOTP: async ({ email, otp, type }) => sendVerificationOtpEmail(email, otp, type),
        }),
        bearer(),
        oauthPopup(),
        expo(),
        electron(),
        ...(dashboardApiKey ? [dash({ apiKey: dashboardApiKey })] : []),
    ],
};

export const auth: Auth<typeof authOptions> = betterAuth(authOptions);
