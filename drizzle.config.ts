import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "postgresql",
    schema: "./src/db/schema/",
    out: "./drizzle",
    dbCredentials: {
        url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/pbp_server",
    },
});
