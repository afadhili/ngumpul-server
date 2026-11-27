import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { dependencyEndpoint, logDependencyError } from "../lib/dependency-errors";
import { relations } from "./relations";

const endpoint = dependencyEndpoint(process.env.DATABASE_URL, ["postgres:", "postgresql:"], "DATABASE_URL", true);
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
});
export function logPostgresError(error: unknown) {
    logDependencyError("postgres", endpoint, error);
}
pool.on("error", logPostgresError);
export const db = drizzle({ client: pool, relations });
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;
export default db;
