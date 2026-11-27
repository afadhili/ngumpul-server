CREATE TABLE "attachment" (
	"id" text PRIMARY KEY,
	"uploader_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"upload_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_target_type_check" CHECK ("target_type" IN ('direct', 'channel')),
	CONSTRAINT "attachment_status_check" CHECK ("status" IN ('pending', 'ready')),
	CONSTRAINT "attachment_size_positive_check" CHECK ("size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL UNIQUE,
	"display_name" text,
	"bio" text,
	"avatar" text,
	"banner" text,
	"location" text,
	"website" text,
	"pronouns" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"photo_visibility" text DEFAULT 'friends' NOT NULL,
	"online_status_visibility" text DEFAULT 'friends' NOT NULL,
	"last_seen_visibility" text DEFAULT 'friends' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"username" text UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_message" (
	"id" text PRIMARY KEY,
	"channel_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"text" text,
	"attachment_id" text,
	"reply_to_message_id" text,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"forwarded_from_id" text,
	"location_lat" double precision,
	"location_lng" double precision,
	"location_label" text,
	"attachment_duration_ms" integer,
	"expires_at" timestamp with time zone,
	"encrypted" boolean DEFAULT false NOT NULL,
	"has_poll" boolean DEFAULT false NOT NULL,
	"is_announcement" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_message_content_present" CHECK (("text" IS NOT NULL AND length("text") > 0) OR "attachment_id" IS NOT NULL OR "deleted_at" IS NOT NULL OR "location_lat" IS NOT NULL OR "has_poll"),
	CONSTRAINT "channel_message_location_pair" CHECK (("location_lat" IS NULL AND "location_lng" IS NULL) OR ("location_lat" IS NOT NULL AND "location_lng" IS NOT NULL)),
	CONSTRAINT "channel_message_location_range" CHECK ("location_lat" IS NULL OR ("location_lat" >= -90 AND "location_lat" <= 90 AND "location_lng" >= -180 AND "location_lng" <= 180))
);
--> statement-breakpoint
CREATE TABLE "channel_message_hidden" (
	"message_id" text,
	"user_id" text,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_message_hidden_pkey" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_server" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friend_request" (
	"id" text PRIMARY KEY,
	"requester_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_request_no_self" CHECK ("requester_id" <> "recipient_id"),
	CONSTRAINT "friend_request_status_check" CHECK ("status" IN ('pending', 'accepted', 'declined', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "friendship" (
	"user_id" text,
	"friend_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendship_pkey" PRIMARY KEY("user_id","friend_user_id"),
	CONSTRAINT "friendship_canonical_pair" CHECK ("user_id" < "friend_user_id")
);
--> statement-breakpoint
CREATE TABLE "server_channel" (
	"id" text PRIMARY KEY,
	"server_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'text' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_channel_kind_check" CHECK ("kind" IN ('text', 'voice'))
);
--> statement-breakpoint
CREATE TABLE "server_invite" (
	"code" text PRIMARY KEY,
	"server_id" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_member" (
	"server_id" text,
	"user_id" text,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_member_pkey" PRIMARY KEY("server_id","user_id"),
	CONSTRAINT "server_member_role_check" CHECK ("role" IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "user_block" (
	"blocker_id" text,
	"blocked_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_block_pkey" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "user_block_no_self" CHECK ("blocker_id" <> "blocked_id")
);
--> statement-breakpoint
CREATE TABLE "user_report" (
	"id" text PRIMARY KEY,
	"reporter_id" text NOT NULL,
	"reported_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_report_no_self" CHECK ("reporter_id" <> "reported_id"),
	CONSTRAINT "user_report_status_check" CHECK ("status" IN ('open', 'reviewing', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "direct_message" (
	"id" text PRIMARY KEY,
	"sender_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"text" text,
	"attachment_id" text,
	"reply_to_message_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"forwarded_from_id" text,
	"location_lat" double precision,
	"location_lng" double precision,
	"location_label" text,
	"attachment_duration_ms" integer,
	"expires_at" timestamp with time zone,
	"encrypted" boolean DEFAULT false NOT NULL,
	"has_poll" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_message_no_self" CHECK ("sender_id" <> "recipient_id"),
	CONSTRAINT "direct_message_content_present" CHECK (("text" IS NOT NULL AND length("text") > 0) OR "attachment_id" IS NOT NULL OR "deleted_at" IS NOT NULL OR "location_lat" IS NOT NULL OR "has_poll"),
	CONSTRAINT "direct_message_location_pair" CHECK (("location_lat" IS NULL AND "location_lng" IS NULL) OR ("location_lat" IS NOT NULL AND "location_lng" IS NOT NULL)),
	CONSTRAINT "direct_message_location_range" CHECK ("location_lat" IS NULL OR ("location_lat" >= -90 AND "location_lat" <= 90 AND "location_lng" >= -180 AND "location_lng" <= 180)),
	CONSTRAINT "direct_message_status_check" CHECK ("status" IN ('sent', 'delivered', 'read'))
);
--> statement-breakpoint
CREATE TABLE "direct_message_hidden" (
	"message_id" text,
	"user_id" text,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_message_hidden_pkey" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "channel_read_state" (
	"channel_id" text,
	"user_id" text,
	"last_read_message_id" text,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"marked_unread" boolean DEFAULT false NOT NULL,
	CONSTRAINT "channel_read_state_pkey" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_preference" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"target_id" text NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"marked_unread" boolean DEFAULT false NOT NULL,
	"muted_until" timestamp with time zone,
	"notification_level" text DEFAULT 'all' NOT NULL,
	"disappearing_seconds" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_preference_scope_check" CHECK ("scope" IN ('direct','channel')),
	CONSTRAINT "conversation_preference_notification_check" CHECK ("notification_level" IN ('all','mentions','none')),
	CONSTRAINT "conversation_preference_disappearing_check" CHECK ("disappearing_seconds" IS NULL OR ("disappearing_seconds" >= 5 AND "disappearing_seconds" <= 604800))
);
--> statement-breakpoint
CREATE TABLE "message_draft" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"target_id" text NOT NULL,
	"text" text NOT NULL,
	"reply_to_message_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_draft_scope_check" CHECK ("scope" IN ('direct','channel'))
);
--> statement-breakpoint
CREATE TABLE "message_mention" (
	"id" text PRIMARY KEY,
	"scope" text NOT NULL,
	"message_id" text NOT NULL,
	"mentioned_user_id" text NOT NULL,
	"mentioner_id" text NOT NULL,
	"channel_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_mention_scope_check" CHECK ("scope" IN ('direct','channel'))
);
--> statement-breakpoint
CREATE TABLE "message_pin" (
	"id" text PRIMARY KEY,
	"scope" text NOT NULL,
	"target_id" text NOT NULL,
	"message_id" text NOT NULL,
	"pinned_by" text NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_pin_scope_check" CHECK ("scope" IN ('direct','channel'))
);
--> statement-breakpoint
CREATE TABLE "message_poll" (
	"id" text PRIMARY KEY,
	"scope" text NOT NULL,
	"message_id" text NOT NULL,
	"question" text NOT NULL,
	"allow_multiple" boolean DEFAULT false NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"closes_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_poll_scope_check" CHECK ("scope" IN ('direct','channel'))
);
--> statement-breakpoint
CREATE TABLE "message_poll_option" (
	"id" text PRIMARY KEY,
	"poll_id" text NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_poll_vote" (
	"id" text PRIMARY KEY,
	"poll_id" text NOT NULL,
	"option_id" text NOT NULL,
	"user_id" text NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_submission" (
	"user_id" text,
	"scope" text,
	"target_id" text,
	"client_message_id" text,
	"request_hash" text NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_submission_pkey" PRIMARY KEY("user_id","scope","target_id","client_message_id"),
	CONSTRAINT "message_submission_scope_check" CHECK ("scope" IN ('direct','channel'))
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"server_id" text,
	"channel_id" text,
	"message_id" text,
	"actor_id" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_kind_check" CHECK ("kind" IN ('direct_message','channel_message','reaction','server_added','member_joined','mention','poll','announcement','scheduled_message','friend_request'))
);
--> statement-breakpoint
CREATE TABLE "scheduled_message" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"target_id" text NOT NULL,
	"text" text,
	"reply_to_message_id" text,
	"attachment_id" text,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_message_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_message_scope_check" CHECK ("scope" IN ('direct','channel')),
	CONSTRAINT "scheduled_message_status_check" CHECK ("status" IN ('pending','sent','canceled','failed'))
);
--> statement-breakpoint
CREATE TABLE "user_preference" (
	"user_id" text PRIMARY KEY,
	"theme" text DEFAULT 'system' NOT NULL,
	"wallpaper" text,
	"bubble_color" text,
	"text_size" text DEFAULT 'medium' NOT NULL,
	"chat_list_sort" text DEFAULT 'recent' NOT NULL,
	"chat_list_filter" text DEFAULT 'all' NOT NULL,
	"notify_direct_messages" boolean DEFAULT true NOT NULL,
	"notify_channels" boolean DEFAULT true NOT NULL,
	"notify_mentions" boolean DEFAULT true NOT NULL,
	"settings" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_presence" (
	"user_id" text PRIMARY KEY,
	"status" text DEFAULT 'offline' NOT NULL,
	"connections" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_presence_status_check" CHECK ("status" IN ('online','away','offline'))
);
--> statement-breakpoint
CREATE TABLE "channel_message_reaction" (
	"id" text PRIMARY KEY,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "direct_message_reaction" (
	"id" text PRIMARY KEY,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_storage_key_unique" ON "attachment" ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_upload_key_unique" ON "attachment" ("upload_key");--> statement-breakpoint
CREATE INDEX "attachment_target_status_created_idx" ON "attachment" ("target_type","target_id","status","created_at");--> statement-breakpoint
CREATE INDEX "attachment_uploader_created_idx" ON "attachment" ("uploader_id","created_at");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "profile_user_id_idx" ON "profile" ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_case_insensitive_unique" ON "user" (lower("username")) WHERE "username" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "channel_message_channel_created_idx" ON "channel_message" ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "channel_message_sender_idx" ON "channel_message" ("sender_id");--> statement-breakpoint
CREATE INDEX "channel_message_reply_to_idx" ON "channel_message" ("reply_to_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_message_attachment_unique" ON "channel_message" ("attachment_id") WHERE "attachment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_message_expires_idx" ON "channel_message" ("expires_at");--> statement-breakpoint
CREATE INDEX "channel_message_announcement_idx" ON "channel_message" ("channel_id","is_announcement","created_at");--> statement-breakpoint
CREATE INDEX "channel_message_hidden_user_idx" ON "channel_message_hidden" ("user_id","hidden_at");--> statement-breakpoint
CREATE INDEX "community_server_owner_id_idx" ON "community_server" ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friend_request_pending_unique" ON "friend_request" ("requester_id","recipient_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "friend_request_recipient_status_idx" ON "friend_request" ("recipient_id","status");--> statement-breakpoint
CREATE INDEX "friend_request_requester_status_idx" ON "friend_request" ("requester_id","status");--> statement-breakpoint
CREATE INDEX "friendship_friend_user_id_idx" ON "friendship" ("friend_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_channel_server_name_unique" ON "server_channel" ("server_id","name");--> statement-breakpoint
CREATE INDEX "server_channel_server_position_idx" ON "server_channel" ("server_id","position");--> statement-breakpoint
CREATE INDEX "server_invite_server_id_idx" ON "server_invite" ("server_id");--> statement-breakpoint
CREATE INDEX "server_member_user_id_idx" ON "server_member" ("user_id");--> statement-breakpoint
CREATE INDEX "user_block_blocked_id_idx" ON "user_block" ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_report_reporter_reported_unique" ON "user_report" ("reporter_id","reported_id");--> statement-breakpoint
CREATE INDEX "user_report_status_created_idx" ON "user_report" ("status","created_at");--> statement-breakpoint
CREATE INDEX "direct_message_conversation_created_idx" ON "direct_message" ("sender_id","recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "direct_message_recipient_status_idx" ON "direct_message" ("recipient_id","status","created_at");--> statement-breakpoint
CREATE INDEX "direct_message_reply_to_idx" ON "direct_message" ("reply_to_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "direct_message_attachment_unique" ON "direct_message" ("attachment_id") WHERE "attachment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "direct_message_expires_idx" ON "direct_message" ("expires_at");--> statement-breakpoint
CREATE INDEX "direct_message_text_search_idx" ON "direct_message" ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "direct_message_hidden_user_idx" ON "direct_message_hidden" ("user_id","hidden_at");--> statement-breakpoint
CREATE INDEX "channel_read_state_user_idx" ON "channel_read_state" ("user_id","last_read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_preference_unique" ON "conversation_preference" ("user_id","scope","target_id");--> statement-breakpoint
CREATE INDEX "conversation_preference_user_idx" ON "conversation_preference" ("user_id","archived","favorite");--> statement-breakpoint
CREATE UNIQUE INDEX "message_draft_unique" ON "message_draft" ("user_id","scope","target_id");--> statement-breakpoint
CREATE INDEX "message_draft_user_idx" ON "message_draft" ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_mention_unique" ON "message_mention" ("scope","message_id","mentioned_user_id");--> statement-breakpoint
CREATE INDEX "message_mention_user_idx" ON "message_mention" ("mentioned_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_pin_unique" ON "message_pin" ("scope","target_id","message_id");--> statement-breakpoint
CREATE INDEX "message_pin_target_idx" ON "message_pin" ("scope","target_id","pinned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_poll_message_unique" ON "message_poll" ("scope","message_id");--> statement-breakpoint
CREATE INDEX "message_poll_created_idx" ON "message_poll" ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "message_poll_option_poll_idx" ON "message_poll_option" ("poll_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "message_poll_vote_unique" ON "message_poll_vote" ("poll_id","option_id","user_id");--> statement-breakpoint
CREATE INDEX "message_poll_vote_poll_idx" ON "message_poll_vote" ("poll_id");--> statement-breakpoint
CREATE INDEX "message_submission_created_idx" ON "message_submission" ("created_at");--> statement-breakpoint
CREATE INDEX "notification_user_created_idx" ON "notification" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_user_read_idx" ON "notification" ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "scheduled_message_due_idx" ON "scheduled_message" ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "scheduled_message_user_idx" ON "scheduled_message" ("user_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "user_presence_last_seen_idx" ON "user_presence" ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_message_reaction_user_unique" ON "channel_message_reaction" ("message_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "channel_message_reaction_message_idx" ON "channel_message_reaction" ("message_id");--> statement-breakpoint
CREATE INDEX "channel_message_reaction_user_idx" ON "channel_message_reaction" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "direct_message_reaction_user_unique" ON "direct_message_reaction" ("message_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "direct_message_reaction_message_idx" ON "direct_message_reaction" ("message_id");--> statement-breakpoint
CREATE INDEX "direct_message_reaction_user_idx" ON "direct_message_reaction" ("user_id");--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploader_id_user_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_channel_id_server_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "server_channel"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_sender_id_user_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_attachment_id_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachment"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_reply_to_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "channel_message"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_message_hidden" ADD CONSTRAINT "channel_message_hidden_message_id_channel_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "channel_message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message_hidden" ADD CONSTRAINT "channel_message_hidden_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "community_server" ADD CONSTRAINT "community_server_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "friend_request" ADD CONSTRAINT "friend_request_requester_id_user_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "friend_request" ADD CONSTRAINT "friend_request_recipient_id_user_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_friend_user_id_user_id_fkey" FOREIGN KEY ("friend_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_channel" ADD CONSTRAINT "server_channel_server_id_community_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "community_server"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_channel" ADD CONSTRAINT "server_channel_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_invite" ADD CONSTRAINT "server_invite_server_id_community_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "community_server"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_invite" ADD CONSTRAINT "server_invite_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_member" ADD CONSTRAINT "server_member_server_id_community_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "community_server"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_member" ADD CONSTRAINT "server_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_block" ADD CONSTRAINT "user_block_blocker_id_user_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_block" ADD CONSTRAINT "user_block_blocked_id_user_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_report" ADD CONSTRAINT "user_report_reporter_id_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_report" ADD CONSTRAINT "user_report_reported_id_user_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_sender_id_user_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_recipient_id_user_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_attachment_id_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachment"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_reply_to_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "direct_message"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "direct_message_hidden" ADD CONSTRAINT "direct_message_hidden_message_id_direct_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "direct_message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message_hidden" ADD CONSTRAINT "direct_message_hidden_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_read_state" ADD CONSTRAINT "channel_read_state_channel_id_server_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "server_channel"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_read_state" ADD CONSTRAINT "channel_read_state_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_preference" ADD CONSTRAINT "conversation_preference_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_draft" ADD CONSTRAINT "message_draft_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_mention" ADD CONSTRAINT "message_mention_mentioned_user_id_user_id_fkey" FOREIGN KEY ("mentioned_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_mention" ADD CONSTRAINT "message_mention_mentioner_id_user_id_fkey" FOREIGN KEY ("mentioner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_pin" ADD CONSTRAINT "message_pin_pinned_by_user_id_fkey" FOREIGN KEY ("pinned_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_poll" ADD CONSTRAINT "message_poll_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_poll_option" ADD CONSTRAINT "message_poll_option_poll_id_message_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "message_poll"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_poll_vote" ADD CONSTRAINT "message_poll_vote_poll_id_message_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "message_poll"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_poll_vote" ADD CONSTRAINT "message_poll_vote_option_id_message_poll_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "message_poll_option"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_poll_vote" ADD CONSTRAINT "message_poll_vote_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message_submission" ADD CONSTRAINT "message_submission_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduled_message" ADD CONSTRAINT "scheduled_message_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message_reaction" ADD CONSTRAINT "channel_message_reaction_message_id_channel_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "channel_message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message_reaction" ADD CONSTRAINT "channel_message_reaction_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message_reaction" ADD CONSTRAINT "direct_message_reaction_message_id_direct_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "direct_message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message_reaction" ADD CONSTRAINT "direct_message_reaction_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;