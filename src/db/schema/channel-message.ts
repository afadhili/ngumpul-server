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
import { serverChannel } from "./community";

export const channelMessage = pgTable(
    "channel_message",
    {
        id: text("id").primaryKey(),
        channelId: text("channel_id").notNull().references(() => serverChannel.id, { onDelete: "cascade" }),
        senderId: text("sender_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        text: text("text"),
        attachmentId: text("attachment_id").references(() => attachment.id, { onDelete: "set null" }),
        replyToMessageId: text("reply_to_message_id"),
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
        isAnnouncement: boolean("is_announcement").notNull().default(false),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("channel_message_content_present", sql`(${table.text} IS NOT NULL AND length(${table.text}) > 0) OR ${table.attachmentId} IS NOT NULL OR ${table.deletedAt} IS NOT NULL OR ${table.locationLat} IS NOT NULL OR ${table.hasPoll}`),
        check("channel_message_location_pair", sql`(${table.locationLat} IS NULL AND ${table.locationLng} IS NULL) OR (${table.locationLat} IS NOT NULL AND ${table.locationLng} IS NOT NULL)`),
        check("channel_message_location_range", sql`${table.locationLat} IS NULL OR (${table.locationLat} >= -90 AND ${table.locationLat} <= 90 AND ${table.locationLng} >= -180 AND ${table.locationLng} <= 180)`),
        foreignKey({
            name: "channel_message_reply_to_fkey",
            columns: [table.replyToMessageId],
            foreignColumns: [table.id],
        }).onDelete("set null"),
        index("channel_message_channel_created_idx").on(table.channelId, table.createdAt),
        index("channel_message_sender_idx").on(table.senderId),
        index("channel_message_reply_to_idx").on(table.replyToMessageId),
        uniqueIndex("channel_message_attachment_unique").on(table.attachmentId).where(sql`${table.attachmentId} IS NOT NULL`),
        index("channel_message_expires_idx").on(table.expiresAt),
        index("channel_message_announcement_idx").on(table.channelId, table.isAnnouncement, table.createdAt),
    ],
);

export const channelMessageHidden = pgTable(
    "channel_message_hidden",
    {
        messageId: text("message_id").notNull().references(() => channelMessage.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        hiddenAt: timestamp("hidden_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({ columns: [table.messageId, table.userId] }),
        index("channel_message_hidden_user_idx").on(table.userId, table.hiddenAt),
    ],
);
