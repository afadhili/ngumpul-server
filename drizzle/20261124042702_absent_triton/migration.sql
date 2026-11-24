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
ALTER TABLE "channel_message" ADD COLUMN "forwarded_from_id" text;--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "location_lat" double precision;--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "location_lng" double precision;--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "location_label" text;--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "attachment_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "encrypted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "is_announcement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "direct_message" ADD COLUMN "forwarded_from_id" text;--> statement-breakpoint
ALTER TABLE "direct_message" ADD COLUMN "location_lat" double precision;--> statement-breakpoint
ALTER TABLE "direct_message" ADD COLUMN "location_lng" double precision;--> statement-breakpoint
ALTER TABLE "direct_message" ADD COLUMN "location_label" text;--> statement-breakpoint
ALTER TABLE "direct_message" ADD COLUMN "attachment_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "direct_message" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "direct_message" ADD COLUMN "encrypted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_message_expires_idx" ON "channel_message" ("expires_at");--> statement-breakpoint
CREATE INDEX "channel_message_announcement_idx" ON "channel_message" ("channel_id","is_announcement","created_at");--> statement-breakpoint
CREATE INDEX "direct_message_expires_idx" ON "direct_message" ("expires_at");--> statement-breakpoint
CREATE INDEX "direct_message_text_search_idx" ON "direct_message" ("sender_id","created_at");--> statement-breakpoint
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
CREATE INDEX "notification_user_created_idx" ON "notification" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_user_read_idx" ON "notification" ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "scheduled_message_due_idx" ON "scheduled_message" ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "scheduled_message_user_idx" ON "scheduled_message" ("user_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "user_presence_last_seen_idx" ON "user_presence" ("last_seen_at");--> statement-breakpoint
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
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduled_message" ADD CONSTRAINT "scheduled_message_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_location_pair" CHECK (("location_lat" IS NULL AND "location_lng" IS NULL) OR ("location_lat" IS NOT NULL AND "location_lng" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_location_range" CHECK ("location_lat" IS NULL OR ("location_lat" >= -90 AND "location_lat" <= 90 AND "location_lng" >= -180 AND "location_lng" <= 180));--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_location_pair" CHECK (("location_lat" IS NULL AND "location_lng" IS NULL) OR ("location_lat" IS NOT NULL AND "location_lng" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_location_range" CHECK ("location_lat" IS NULL OR ("location_lat" >= -90 AND "location_lat" <= 90 AND "location_lng" >= -180 AND "location_lng" <= 180));--> statement-breakpoint
ALTER TABLE "direct_message" DROP CONSTRAINT "direct_message_content_present", ADD CONSTRAINT "direct_message_content_present" CHECK (("text" IS NOT NULL AND length("text") > 0) OR "attachment_id" IS NOT NULL OR "deleted_at" IS NOT NULL OR "location_lat" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "channel_message" DROP CONSTRAINT "channel_message_content_present", ADD CONSTRAINT "channel_message_content_present" CHECK (("text" IS NOT NULL AND length("text") > 0) OR "attachment_id" IS NOT NULL OR "deleted_at" IS NOT NULL OR "location_lat" IS NOT NULL);