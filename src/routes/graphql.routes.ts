import { ApolloServer, HeaderMap } from "@apollo/server";
import { buildSchema } from "drizzle-graphql";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import db from "../db";
import { getSessionUserId } from "../lib/request-auth";

const { schema } = buildSchema(db);
const apolloServer = new ApolloServer({ schema });
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

    const responseHeaders = new Headers();
    result.headers.forEach((value, key) => responseHeaders.set(key, value));
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
