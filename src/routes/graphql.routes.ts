import { ApolloServer, HeaderMap } from "@apollo/server";
import {
    GraphQLBoolean,
    GraphQLID,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLSchema,
    GraphQLString,
} from "graphql";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import db from "../db/index";
import { profile, user } from "../db/schema/auth";
import { getSessionUserId } from "../lib/request-auth";
import { eq } from "drizzle-orm";

type GraphqlContext = { userId: string };

const userType = new GraphQLObjectType({
    name: "User",
    fields: {
        id: { type: new GraphQLNonNull(GraphQLID) },
        name: { type: new GraphQLNonNull(GraphQLString) },
        email: { type: new GraphQLNonNull(GraphQLString) },
        username: { type: GraphQLString },
        emailVerified: { type: GraphQLBoolean },
        image: { type: GraphQLString },
    },
});

const profileType = new GraphQLObjectType({
    name: "Profile",
    fields: {
        displayName: { type: GraphQLString },
        bio: { type: GraphQLString },
        avatar: { type: GraphQLString },
        banner: { type: GraphQLString },
        location: { type: GraphQLString },
        website: { type: GraphQLString },
        pronouns: { type: GraphQLString },
        isPublic: { type: new GraphQLNonNull(GraphQLBoolean) },
        photoVisibility: { type: new GraphQLNonNull(GraphQLString) },
        onlineStatusVisibility: { type: new GraphQLNonNull(GraphQLString) },
        lastSeenVisibility: { type: new GraphQLNonNull(GraphQLString) },
    },
});

const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
        name: "Query",
        fields: {
            me: {
                type: userType,
                resolve: async (_source, _args, context: GraphqlContext) => {
                    const [currentUser] = await db
                        .select({
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            username: user.username,
                            emailVerified: user.emailVerified,
                            image: user.image,
                        })
                        .from(user)
                        .where(eq(user.id, context.userId))
                        .limit(1);

                    return currentUser ?? null;
                },
            },
            myProfile: {
                type: profileType,
                resolve: async (_source, _args, context: GraphqlContext) => {
                    const [currentProfile] = await db
                        .select({
                            displayName: profile.displayName,
                            bio: profile.bio,
                            avatar: profile.avatar,
                            banner: profile.banner,
                            location: profile.location,
                            website: profile.website,
                            pronouns: profile.pronouns,
                            isPublic: profile.isPublic,
                            photoVisibility: profile.photoVisibility,
                            onlineStatusVisibility: profile.onlineStatusVisibility,
                            lastSeenVisibility: profile.lastSeenVisibility,
                        })
                        .from(profile)
                        .where(eq(profile.userId, context.userId))
                        .limit(1);

                    return currentProfile ?? null;
                },
            },
        },
    }),
});

const apolloServer = new ApolloServer<GraphqlContext>({ schema });
await apolloServer.start();

async function handleGraphqlRequest(c: Context) {
    const userId = await getSessionUserId(c);
    if (!userId) {
        return c.json({ errors: [{ message: "Unauthorized" }] }, 401);
    }

    let body: unknown;
    if (c.req.method === "POST") {
        try {
            body = await c.req.json();
        } catch {
            return c.json({ errors: [{ message: "Request body must be valid JSON" }] }, 400);
        }
    }

    const headers = new HeaderMap();
    c.req.raw.headers.forEach((value, key) => headers.set(key, value));

    const result = await apolloServer.executeHTTPGraphQLRequest({
        httpGraphQLRequest: {
            method: c.req.method,
            headers,
            search: new URL(c.req.url).search,
            body,
        },
        context: async () => ({ userId }),
    });

    const responseHeaders: Record<string, string> = {};
    result.headers.forEach((value, key) => {
        responseHeaders[key] = value;
    });
    const status = (result.status ?? 200) as ContentfulStatusCode;

    if (result.body.kind === "complete") {
        return c.newResponse(result.body.string, status, responseHeaders);
    }

    const asyncIterator = result.body.asyncIterator;
    const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const next = await asyncIterator.next();
                if (next.done) {
                    controller.close();
                } else {
                    controller.enqueue(new TextEncoder().encode(next.value));
                }
            } catch (error) {
                controller.error(error);
            }
        },
        async cancel() {
            await asyncIterator.return?.();
        },
    });

    return c.newResponse(stream, status, responseHeaders);
}

async function stopGraphqlServer() {
    await apolloServer.stop();
}

export { handleGraphqlRequest, stopGraphqlServer };
