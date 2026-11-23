import { sql } from "drizzle-orm";
import {
    check,
    index,
    integer,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const friendRequest = pgTable(
    "friend_request",
    {
        id: text("id").primaryKey(),
        requesterId: text("requester_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        recipientId: text("recipient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        status: text("status").notNull().default("pending"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("friend_request_no_self", sql`${table.requesterId} <> ${table.recipientId}`),
        check("friend_request_status_check", sql`${table.status} IN ('pending', 'accepted', 'declined', 'canceled')`),
        uniqueIndex("friend_request_pending_unique")
            .on(table.requesterId, table.recipientId)
            .where(sql`${table.status} = 'pending'`),
        index("friend_request_recipient_status_idx").on(table.recipientId, table.status),
        index("friend_request_requester_status_idx").on(table.requesterId, table.status),
    ],
);

export const friendship = pgTable(
    "friendship",
    {
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        friendUserId: text("friend_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({ columns: [table.userId, table.friendUserId] }),
        check("friendship_canonical_pair", sql`${table.userId} < ${table.friendUserId}`),
        index("friendship_friend_user_id_idx").on(table.friendUserId),
    ],
);

export const userBlock = pgTable(
    "user_block",
    {
        blockerId: text("blocker_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        blockedId: text("blocked_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({ columns: [table.blockerId, table.blockedId] }),
        check("user_block_no_self", sql`${table.blockerId} <> ${table.blockedId}`),
        index("user_block_blocked_id_idx").on(table.blockedId),
    ],
);

export const userReport = pgTable(
    "user_report",
    {
        id: text("id").primaryKey(),
        reporterId: text("reporter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        reportedId: text("reported_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        reason: text("reason").notNull(),
        details: text("details"),
        status: text("status").notNull().default("open"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("user_report_no_self", sql`${table.reporterId} <> ${table.reportedId}`),
        check("user_report_status_check", sql`${table.status} IN ('open', 'reviewing', 'resolved', 'dismissed')`),
        uniqueIndex("user_report_reporter_reported_unique").on(table.reporterId, table.reportedId),
        index("user_report_status_created_idx").on(table.status, table.createdAt),
    ],
);

export const communityServer = pgTable(
    "community_server",
    {
        id: text("id").primaryKey(),
        name: text("name").notNull(),
        description: text("description"),
        icon: text("icon"),
        ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [index("community_server_owner_id_idx").on(table.ownerId)],
);

export const serverMember = pgTable(
    "server_member",
    {
        serverId: text("server_id").notNull().references(() => communityServer.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        role: text("role").notNull().default("member"),
        joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        primaryKey({ columns: [table.serverId, table.userId] }),
        check("server_member_role_check", sql`${table.role} IN ('owner', 'admin', 'member')`),
        index("server_member_user_id_idx").on(table.userId),
    ],
);

export const serverInvite = pgTable(
    "server_invite",
    {
        code: text("code").primaryKey(),
        serverId: text("server_id").notNull().references(() => communityServer.id, { onDelete: "cascade" }),
        createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
        expiresAt: timestamp("expires_at", { withTimezone: true }),
        maxUses: integer("max_uses"),
        uses: integer("uses").notNull().default(0),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [index("server_invite_server_id_idx").on(table.serverId)],
);

export const serverChannel = pgTable(
    "server_channel",
    {
        id: text("id").primaryKey(),
        serverId: text("server_id").notNull().references(() => communityServer.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        description: text("description"),
        kind: text("kind").notNull().default("text"),
        position: integer("position").notNull().default(0),
        createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    table => [
        check("server_channel_kind_check", sql`${table.kind} IN ('text', 'voice')`),
        uniqueIndex("server_channel_server_name_unique").on(table.serverId, table.name),
        index("server_channel_server_position_idx").on(table.serverId, table.position),
    ],
);
