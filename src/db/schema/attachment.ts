import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const attachment = pgTable(
    "attachment",
    {
        id: text("id").primaryKey(),
        uploaderId: text("uploader_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        targetType: text("target_type").notNull(),
        targetId: text("target_id").notNull(),
        storageKey: text("storage_key").notNull(),
        uploadKey: text("upload_key").notNull(),
        fileName: text("file_name").notNull(),
        mimeType: text("mime_type").notNull(),
        sizeBytes: integer("size_bytes").notNull(),
        status: text("status").notNull().default("pending"),
        uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(),
        uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("attachment_target_type_check", sql`${table.targetType} IN ('direct', 'channel')`),
        check("attachment_status_check", sql`${table.status} IN ('pending', 'ready')`),
        check("attachment_size_positive_check", sql`${table.sizeBytes} > 0`),
        uniqueIndex("attachment_storage_key_unique").on(table.storageKey),
        uniqueIndex("attachment_upload_key_unique").on(table.uploadKey),
        index("attachment_target_status_created_idx").on(table.targetType, table.targetId, table.status, table.createdAt),
        index("attachment_uploader_created_idx").on(table.uploaderId, table.createdAt),
    ],
);
