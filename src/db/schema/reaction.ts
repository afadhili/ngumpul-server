import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { channelMessage } from "./channel-message";
import { directMessage } from "./direct-message";

export const directMessageReaction = pgTable(
    "direct_message_reaction",
    {
        id: text("id").primaryKey(),
        messageId: text("message_id").notNull().references(() => directMessage.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        emoji: text("emoji").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        uniqueIndex("direct_message_reaction_user_unique").on(table.messageId, table.userId, table.emoji),
        index("direct_message_reaction_message_idx").on(table.messageId),
        index("direct_message_reaction_user_idx").on(table.userId),
    ],
);

export const channelMessageReaction = pgTable(
    "channel_message_reaction",
    {
        id: text("id").primaryKey(),
        messageId: text("message_id").notNull().references(() => channelMessage.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        emoji: text("emoji").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        uniqueIndex("channel_message_reaction_user_unique").on(table.messageId, table.userId, table.emoji),
        index("channel_message_reaction_message_idx").on(table.messageId),
        index("channel_message_reaction_user_idx").on(table.userId),
    ],
);
