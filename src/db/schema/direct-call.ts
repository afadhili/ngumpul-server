import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const directCall = pgTable("direct_call", {
    id: text("id").primaryKey(),
    callerId: text("caller_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["audio", "video"] }).notNull(),
    status: text("status", { enum: ["ringing", "active", "declined", "ended"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
}, table => [
    check("direct_call_distinct_users", sql`${table.callerId} <> ${table.recipientId}`),
    check("direct_call_kind_check", sql`${table.kind} IN ('audio', 'video')`),
    check("direct_call_status_check", sql`${table.status} IN ('ringing', 'active', 'declined', 'ended')`),
    index("direct_call_caller_created_idx").on(table.callerId, table.createdAt),
    index("direct_call_recipient_created_idx").on(table.recipientId, table.createdAt),
]);
