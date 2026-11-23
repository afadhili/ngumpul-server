import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("direct_message_no_self", sql`${table.senderId} <> ${table.recipientId}`),
        check("direct_message_content_present", sql`(${table.text} IS NOT NULL AND length(${table.text}) > 0) OR ${table.attachmentId} IS NOT NULL OR ${table.deletedAt} IS NOT NULL`),
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
