import { logPostgresError, pool } from "../db/index";

let draining = false;
let postgresAvailable = true;
let lastCheck: { expiresAt: number; result: Promise<boolean> } | undefined;

export function beginDrain() {
    draining = true;
}

export async function isReady() {
    if (draining) return false;

    if (!lastCheck || lastCheck.expiresAt <= Date.now()) {
        const probe = { text: "SELECT 1", query_timeout: 1_000 };
        const result = pool.query(probe).then(() => {
            postgresAvailable = true;
            return true;
        }, error => {
            if (postgresAvailable) logPostgresError(error);
            postgresAvailable = false;
            return false;
        });
        lastCheck = { expiresAt: Infinity, result };
        const check = lastCheck;
        void result.then(() => { check.expiresAt = Date.now() + 1_000; });
    }

    return (await lastCheck.result) && !draining;
}
