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
CREATE UNIQUE INDEX "channel_message_reaction_user_unique" ON "channel_message_reaction" ("message_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "channel_message_reaction_message_idx" ON "channel_message_reaction" ("message_id");--> statement-breakpoint
CREATE INDEX "channel_message_reaction_user_idx" ON "channel_message_reaction" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "direct_message_reaction_user_unique" ON "direct_message_reaction" ("message_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "direct_message_reaction_message_idx" ON "direct_message_reaction" ("message_id");--> statement-breakpoint
CREATE INDEX "direct_message_reaction_user_idx" ON "direct_message_reaction" ("user_id");--> statement-breakpoint
ALTER TABLE "channel_message_reaction" ADD CONSTRAINT "channel_message_reaction_message_id_channel_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "channel_message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message_reaction" ADD CONSTRAINT "channel_message_reaction_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message_reaction" ADD CONSTRAINT "direct_message_reaction_message_id_direct_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "direct_message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message_reaction" ADD CONSTRAINT "direct_message_reaction_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;