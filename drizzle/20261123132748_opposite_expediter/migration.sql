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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE INDEX "profile_user_id_idx" ON "profile" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_case_insensitive_unique" ON "user" (lower("username")) WHERE "username" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "community_server_owner_id_idx" ON "community_server" ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friend_request_pending_unique" ON "friend_request" ("requester_id","recipient_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "friend_request_recipient_status_idx" ON "friend_request" ("recipient_id","status");--> statement-breakpoint
CREATE INDEX "friend_request_requester_status_idx" ON "friend_request" ("requester_id","status");--> statement-breakpoint
CREATE INDEX "friendship_friend_user_id_idx" ON "friendship" ("friend_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_channel_server_name_unique" ON "server_channel" ("server_id","name");--> statement-breakpoint
CREATE INDEX "server_channel_server_position_idx" ON "server_channel" ("server_id","position");--> statement-breakpoint
CREATE INDEX "server_invite_server_id_idx" ON "server_invite" ("server_id");--> statement-breakpoint
CREATE INDEX "server_member_user_id_idx" ON "server_member" ("user_id");--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
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
ALTER TABLE "server_member" ADD CONSTRAINT "server_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;