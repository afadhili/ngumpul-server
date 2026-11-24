import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    doublePrecision,
    foreignKey,
    index,
    integer,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { attachment } from "./attachment";
import { user } from "./auth";

export const directMessage = pgTable(
    "direct_message",
    {
        id: text("id").primaryKey(),
        senderId: text("sender_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        recipientId: text("recipient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        text: text("text"),
        attachmentId: text("attachment_id").references(() => attachment.id, { onDelete: "set null" }),
        replyToMessageId: text("reply_to_message_id"),
        status: text("status").notNull().default("sent"),
        deliveredAt: timestamp("delivered_at", { withTimezone: true }),
        readAt: timestamp("read_at", { withTimezone: true }),
        editedAt: timestamp("edited_at", { withTimezone: true }),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
        forwardedFromId: text("forwarded_from_id"),
        locationLat: doublePrecision("location_lat"),
        locationLng: doublePrecision("location_lng"),
        locationLabel: text("location_label"),
        attachmentDurationMs: integer("attachment_duration_ms"),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        encrypted: boolean("encrypted").notNull().default(false),
        hasPoll: boolean("has_poll").notNull().default(false),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("direct_message_no_self", sql`${table.senderId} <> ${table.recipientId}`),
        check("direct_message_content_present", sql`(${table.text} IS NOT NULL AND length(${table.text}) > 0) OR ${table.attachmentId} IS NOT NULL OR ${table.deletedAt} IS NOT NULL OR ${table.locationLat} IS NOT NULL OR ${table.hasPoll}`),
        check("direct_message_location_pair", sql`(${table.locationLat} IS NULL AND ${table.locationLng} IS NULL) OR (${table.locationLat} IS NOT NULL AND ${table.locationLng} IS NOT NULL)`),
        check("direct_message_location_range", sql`${table.locationLat} IS NULL OR (${table.locationLat} >= -90 AND ${table.locationLat} <= 90 AND ${table.locationLng} >= -180 AND ${table.locationLng} <= 180)`),
        check("direct_message_status_check", sql`${table.status} IN ('sent', 'delivered', 'read')`),
        foreignKey({
            name: "direct_message_reply_to_fkey",
            columns: [table.replyToMessageId],
            foreignColumns: [table.id],
        }).onDelete("set null"),
        index("direct_message_conversation_created_idx").on(table.senderId, table.recipientId, table.createdAt),
        index("direct_message_recipient_status_idx").on(table.recipientId, table.status, table.createdAt),
        index("direct_message_reply_to_idx").on(table.replyToMessageId),
        uniqueIndex("direct_message_attachment_unique").on(table.attachmentId).where(sql`${table.attachmentId} IS NOT NULL`),
        index("direct_message_expires_idx").on(table.expiresAt),
        index("direct_message_text_search_idx").on(table.senderId, table.createdAt),
    ],
);

export const directMessageHidden = pgTable(
    "direct_message_hidden",
    {
        messageId: text("message_id").notNull().references(() => directMessage.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        hiddenAt: timestamp("hidden_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({ columns: [table.messageId, table.userId] }),
        index("direct_message_hidden_user_idx").on(table.userId, table.hiddenAt),
    ],
);
