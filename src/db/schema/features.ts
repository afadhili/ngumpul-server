import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    index,
    integer,
    jsonb,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { serverChannel } from "./community";

/**
 * Conversation scopes used by preferences, drafts, pins, polls and scheduled
 * messages. `direct` targets a peer user ID, `channel` targets a server channel.
 */
export const conversationScopes = ["direct", "channel"] as const;

export const notification = pgTable(
    "notification",
    {
        id: text("id").primaryKey(),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        kind: text("kind").notNull(),
        title: text("title").notNull(),
        body: text("body").notNull(),
        serverId: text("server_id"),
        channelId: text("channel_id"),
        messageId: text("message_id"),
        actorId: text("actor_id"),
        readAt: timestamp("read_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check(
            "notification_kind_check",
            sql`${table.kind} IN ('direct_message','channel_message','reaction','server_added','member_joined','mention','poll','announcement','scheduled_message','friend_request')`,
        ),
        index("notification_user_created_idx").on(table.userId, table.createdAt),
        index("notification_user_read_idx").on(table.userId, table.readAt),
    ],
);

export const messageMention = pgTable(
    "message_mention",
    {
        id: text("id").primaryKey(),
        scope: text("scope").notNull(),
        messageId: text("message_id").notNull(),
        mentionedUserId: text("mentioned_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        mentionerId: text("mentioner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        channelId: text("channel_id"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("message_mention_scope_check", sql`${table.scope} IN ('direct','channel')`),
        uniqueIndex("message_mention_unique").on(table.scope, table.messageId, table.mentionedUserId),
        index("message_mention_user_idx").on(table.mentionedUserId, table.createdAt),
    ],
);

export const messagePin = pgTable(
    "message_pin",
    {
        id: text("id").primaryKey(),
        scope: text("scope").notNull(),
        targetId: text("target_id").notNull(),
        messageId: text("message_id").notNull(),
        pinnedBy: text("pinned_by").notNull().references(() => user.id, { onDelete: "cascade" }),
        pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("message_pin_scope_check", sql`${table.scope} IN ('direct','channel')`),
        uniqueIndex("message_pin_unique").on(table.scope, table.targetId, table.messageId),
        index("message_pin_target_idx").on(table.scope, table.targetId, table.pinnedAt),
    ],
);

export const channelReadState = pgTable(
    "channel_read_state",
    {
        channelId: text("channel_id").notNull().references(() => serverChannel.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        lastReadMessageId: text("last_read_message_id"),
        lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
        markedUnread: boolean("marked_unread").notNull().default(false),
    },
    table => [
        primaryKey({ columns: [table.channelId, table.userId] }),
        index("channel_read_state_user_idx").on(table.userId, table.lastReadAt),
    ],
);

export const conversationPreference = pgTable(
    "conversation_preference",
    {
        id: text("id").primaryKey(),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        scope: text("scope").notNull(),
        targetId: text("target_id").notNull(),
        favorite: boolean("favorite").notNull().default(false),
        archived: boolean("archived").notNull().default(false),
        markedUnread: boolean("marked_unread").notNull().default(false),
        mutedUntil: timestamp("muted_until", { withTimezone: true }),
        notificationLevel: text("notification_level").notNull().default("all"),
        disappearingSeconds: integer("disappearing_seconds"),
        sortOrder: integer("sort_order").notNull().default(0),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("conversation_preference_scope_check", sql`${table.scope} IN ('direct','channel')`),
        check(
            "conversation_preference_notification_check",
            sql`${table.notificationLevel} IN ('all','mentions','none')`,
        ),
        check(
            "conversation_preference_disappearing_check",
            sql`${table.disappearingSeconds} IS NULL OR (${table.disappearingSeconds} >= 5 AND ${table.disappearingSeconds} <= 604800)`,
        ),
        uniqueIndex("conversation_preference_unique").on(table.userId, table.scope, table.targetId),
        index("conversation_preference_user_idx").on(table.userId, table.archived, table.favorite),
    ],
);

export const messageDraft = pgTable(
    "message_draft",
    {
        id: text("id").primaryKey(),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        scope: text("scope").notNull(),
        targetId: text("target_id").notNull(),
        text: text("text").notNull(),
        replyToMessageId: text("reply_to_message_id"),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("message_draft_scope_check", sql`${table.scope} IN ('direct','channel')`),
        uniqueIndex("message_draft_unique").on(table.userId, table.scope, table.targetId),
        index("message_draft_user_idx").on(table.userId, table.updatedAt),
    ],
);

export const scheduledMessage = pgTable(
    "scheduled_message",
    {
        id: text("id").primaryKey(),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        scope: text("scope").notNull(),
        targetId: text("target_id").notNull(),
        text: text("text"),
        replyToMessageId: text("reply_to_message_id"),
        attachmentId: text("attachment_id"),
        scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
        status: text("status").notNull().default("pending"),
        sentMessageId: text("sent_message_id"),
        failureReason: text("failure_reason"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("scheduled_message_scope_check", sql`${table.scope} IN ('direct','channel')`),
        check(
            "scheduled_message_status_check",
            sql`${table.status} IN ('pending','sent','canceled','failed')`,
        ),
        index("scheduled_message_due_idx").on(table.status, table.scheduledFor),
        index("scheduled_message_user_idx").on(table.userId, table.scheduledFor),
    ],
);

export const messagePoll = pgTable(
    "message_poll",
    {
        id: text("id").primaryKey(),
        scope: text("scope").notNull(),
        messageId: text("message_id").notNull(),
        question: text("question").notNull(),
        allowMultiple: boolean("allow_multiple").notNull().default(false),
        anonymous: boolean("anonymous").notNull().default(false),
        closesAt: timestamp("closes_at", { withTimezone: true }),
        closedAt: timestamp("closed_at", { withTimezone: true }),
        createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("message_poll_scope_check", sql`${table.scope} IN ('direct','channel')`),
        uniqueIndex("message_poll_message_unique").on(table.scope, table.messageId),
        index("message_poll_created_idx").on(table.createdBy, table.createdAt),
    ],
);

export const messagePollOption = pgTable(
    "message_poll_option",
    {
        id: text("id").primaryKey(),
        pollId: text("poll_id").notNull().references(() => messagePoll.id, { onDelete: "cascade" }),
        label: text("label").notNull(),
        position: integer("position").notNull().default(0),
    },
    table => [index("message_poll_option_poll_idx").on(table.pollId, table.position)],
);

export const messagePollVote = pgTable(
    "message_poll_vote",
    {
        id: text("id").primaryKey(),
        pollId: text("poll_id").notNull().references(() => messagePoll.id, { onDelete: "cascade" }),
        optionId: text("option_id").notNull().references(() => messagePollOption.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        votedAt: timestamp("voted_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        uniqueIndex("message_poll_vote_unique").on(table.pollId, table.optionId, table.userId),
        index("message_poll_vote_poll_idx").on(table.pollId),
    ],
);

export const userPresence = pgTable(
    "user_presence",
    {
        userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
        status: text("status").notNull().default("offline"),
        connections: integer("connections").notNull().default(0),
        lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
        lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("user_presence_status_check", sql`${table.status} IN ('online','away','offline')`),
        index("user_presence_last_seen_idx").on(table.lastSeenAt),
    ],
);

export const userPreference = pgTable("user_preference", {
    userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
    theme: text("theme").notNull().default("system"),
    wallpaper: text("wallpaper"),
    bubbleColor: text("bubble_color"),
    textSize: text("text_size").notNull().default("medium"),
    chatListSort: text("chat_list_sort").notNull().default("recent"),
    chatListFilter: text("chat_list_filter").notNull().default("all"),
    notifyDirectMessages: boolean("notify_direct_messages").notNull().default(true),
    notifyChannels: boolean("notify_channels").notNull().default(true),
    notifyMentions: boolean("notify_mentions").notNull().default(true),
    settings: jsonb("settings"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
