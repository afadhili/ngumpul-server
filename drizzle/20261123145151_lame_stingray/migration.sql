CREATE TABLE "channel_message" (
	"id" text PRIMARY KEY,
	"channel_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"text" text,
	"attachment_id" text,
	"reply_to_message_id" text,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_message_content_present" CHECK (("text" IS NOT NULL AND length("text") > 0) OR "attachment_id" IS NOT NULL OR "deleted_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "channel_message_hidden" (
	"message_id" text,
	"user_id" text,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_message_hidden_pkey" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "channel_message_channel_created_idx" ON "channel_message" ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "channel_message_sender_idx" ON "channel_message" ("sender_id");--> statement-breakpoint
CREATE INDEX "channel_message_reply_to_idx" ON "channel_message" ("reply_to_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_message_attachment_unique" ON "channel_message" ("attachment_id") WHERE "attachment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_message_hidden_user_idx" ON "channel_message_hidden" ("user_id","hidden_at");--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_channel_id_server_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "server_channel"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_sender_id_user_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_attachment_id_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachment"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_reply_to_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "channel_message"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_message_hidden" ADD CONSTRAINT "channel_message_hidden_message_id_channel_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "channel_message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_message_hidden" ADD CONSTRAINT "channel_message_hidden_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;