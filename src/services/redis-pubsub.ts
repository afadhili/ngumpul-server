import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "redis";
import { dependencyEndpoint, logDependencyError } from "../lib/dependency-errors";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";
const endpoint = dependencyEndpoint(url, ["redis:", "rediss:"], "REDIS_URL");
const publishTimeout = 750;
const recoveryListeners = new Set<() => void>();
const connectionReadiness = new Set<() => boolean>();
let needsResync = false;

export function onRedisRecovery(listener: () => void) {
    recoveryListeners.add(listener);
    return () => recoveryListeners.delete(listener);
}

function recoverIfReady() {
    if (!needsResync || [...connectionReadiness].some(isReady => !isReady())) return;
    needsResync = false;
    for (const listener of recoveryListeners) listener();
}

export function createRedisPubSub(service: string, channel: string, receive: (message: string) => void) {
    const publisher = createClient({
        url,
        disableOfflineQueue: true,
        commandsQueueMaxLength: 1_000,
        socket: { connectTimeout: 2_000 },
    });
    // Allow the subscription command to wait for its initial reconnect. The library re-subscribes after later reconnects.
    const subscriber = publisher.duplicate({ disableOfflineQueue: false });
    const subscriptionLife = new AbortController();
    let subscribed = false;
    let closing = false;
    connectionReadiness.add(() => subscribed && publisher.isReady && subscriber.isReady);

    for (const [role, client] of [["publisher", publisher], ["subscriber", subscriber]] as const) {
        let lastLog = 0;
        client.on("error", error => {
            if (closing) return;
            needsResync = true;
            const now = Date.now();
            if (now - lastLog >= 10_000) {
                logDependencyError(`redis:${service}:${role}`, endpoint, error);
                lastLog = now;
            }
        });
        client.on("ready", recoverIfReady);
    }

    async function connect() {
        await Promise.all([
            publisher.connect(),
            subscriber.connect().then(subscribe),
        ]).catch(error => {
            if (!closing) logDependencyError(`redis:${service}`, endpoint, error);
        });
    }

    async function subscribe() {
        while (!closing && !subscribed) {
            try {
                await subscriber.subscribe(channel, receive);
                subscribed = true;
                recoverIfReady();
            } catch (error) {
                if (closing) return;
                logDependencyError(`redis:${service}:subscribe`, endpoint, error);
                await delay(500, undefined, { signal: subscriptionLife.signal, ref: false });
            }
        }
    }

    async function publish(payload: string) {
        if (!publisher.isReady) {
            if (!closing) needsResync = true;
            return;
        }

        const signal = AbortSignal.timeout(publishTimeout);
        const command = publisher.withAbortSignal(signal).publish(channel, payload);
        try {
            // The abort signal can remove unsent commands. Also bound the wait for a command already on the wire.
            await new Promise<void>((resolve, reject) => {
                const onTimeout = () => reject(signal.reason);
                signal.addEventListener("abort", onTimeout, { once: true });
                void command.then(
                    () => { signal.removeEventListener("abort", onTimeout); resolve(); },
                    error => { signal.removeEventListener("abort", onTimeout); reject(error); },
                );
            });
            recoverIfReady();
        } catch (error) {
            if (!closing) {
                needsResync = true;
                logDependencyError(`redis:${service}:publish`, endpoint, error);
            }
        }
    }

    function close() {
        closing = true;
        subscriptionLife.abort();
        if (publisher.isOpen) publisher.destroy();
        if (subscriber.isOpen) subscriber.destroy();
    }

    return { connect, publish, close };
}
