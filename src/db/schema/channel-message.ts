import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("channel_message_content_present", sql`(${table.text} IS NOT NULL AND length(${table.text}) > 0) OR ${table.attachmentId} IS NOT NULL OR ${table.deletedAt} IS NOT NULL`),
        foreignKey({
            name: "channel_message_reply_to_fkey",
            columns: [table.replyToMessageId],
            foreignColumns: [table.id],
        }).onDelete("set null"),
        index("channel_message_channel_created_idx").on(table.channelId, table.createdAt),
        index("channel_message_sender_idx").on(table.senderId),
        index("channel_message_reply_to_idx").on(table.replyToMessageId),
        uniqueIndex("channel_message_attachment_unique").on(table.attachmentId).where(sql`${table.attachmentId} IS NOT NULL`),
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
