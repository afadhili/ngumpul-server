import { hc } from "hono/client";
import type { AppType } from "ngumpul-server/rpc";

const client = hc<AppType>("http://localhost:3000");

// Compile against the package's type entry point once the server declarations are built.
export async function checkRpcTypes() {
    const account = await client.api.me.$get();
    if (account.status === 200) {
        const { user } = await account.json();
        user.username?.toLowerCase();
    } else {
        const { error } = await account.json();
        error.toLowerCase();
    }

    const profile = await client.api.profile.$put({ json: { username: "alice", displayName: null } });
    if (profile.status === 413) (await profile.json()).error.toLowerCase();
    await client.api.profile["username-availability"].$get({ query: { username: "alice" } });

    const direct = client.api["direct-messages"][":id"];
    const param = { id: "test-id" };
    await direct.$get({ param });
    await direct.$post({ param, json: { text: "Hello" } });
    await direct.$post({ param, json: { location: { lat: 6, lng: 106 } } });
    await direct.$post({ param, json: { poll: { question: "Ready?", options: ["Yes", "No"] } } });
    const deleted = await direct.$delete({ param, query: { scope: "me" } });
    if (deleted.status === 204) {
        const isSuccessful: true = deleted.ok;
        return isSuccessful;
    }

    const invites = client.api.servers[":serverId"].invites;
    const serverParam = { serverId: "server-id" };
    await invites.$post({ param: serverParam });
    await invites.$post({ param: serverParam, json: { expiresInSeconds: null } });
    await client.api["scheduled-messages"].$post({
        json: { scope: "direct", targetId: "peer-id", text: "Later", scheduledFor: "2026-12-01T10:00:00Z" },
    });

    // @ts-expect-error A username is required to update a profile.
    await client.api.profile.$put({ json: { displayName: "Alice" } });
    // @ts-expect-error The availability query is required.
    await client.api.profile["username-availability"].$get();
    // @ts-expect-error The path parameter is required.
    await direct.$get();
    // @ts-expect-error A message must have content.
    await direct.$post({ param, json: {} });
    // @ts-expect-error The scope must be one of the supported values.
    await direct.$delete({ param, query: { scope: "all" } });
}
