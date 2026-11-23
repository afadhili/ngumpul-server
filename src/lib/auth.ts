import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins";
import "dotenv/config";
import { db } from "../db/index";
import * as schema from "../db/schema/auth";
import { sendVerificationOtpEmail } from "../services/email.service";

const secret = process.env.BETTER_AUTH_SECRET;
const baseURL = process.env.BETTER_AUTH_URL;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be set to a high-entropy value of at least 32 characters");
}

if (!baseURL) {
    throw new Error("BETTER_AUTH_URL is required");
}

if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set to enable Google sign-in");
}

const authOptions: BetterAuthOptions = {
    secret,
    baseURL,
    trustedOrigins: process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : [],
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
    },
    emailVerification: {
        sendOnSignUp: true,
        sendOnSignIn: true,
    },
    plugins: [
        emailOTP({
            overrideDefaultEmailVerification: true,
            otpLength: 6,
            expiresIn: 600,
            allowedAttempts: 5,
            storeOTP: "hashed",
            sendVerificationOTP: async ({ email, otp, type }) => sendVerificationOtpEmail(email, otp, type),
        }),
    ],
};

export const auth = betterAuth(authOptions);
