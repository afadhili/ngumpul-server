CREATE TABLE "direct_message" (
	"id" text PRIMARY KEY,
	"sender_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"text" text,
	"reply_to_message_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_message_no_self" CHECK ("sender_id" <> "recipient_id"),
	CONSTRAINT "direct_message_content_present" CHECK ("text" IS NOT NULL AND length("text") > 0 OR "deleted_at" IS NOT NULL),
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
CREATE INDEX "direct_message_conversation_created_idx" ON "direct_message" ("sender_id","recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "direct_message_recipient_status_idx" ON "direct_message" ("recipient_id","status","created_at");--> statement-breakpoint
CREATE INDEX "direct_message_reply_to_idx" ON "direct_message" ("reply_to_message_id");--> statement-breakpoint
CREATE INDEX "direct_message_hidden_user_idx" ON "direct_message_hidden" ("user_id","hidden_at");--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_sender_id_user_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_recipient_id_user_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message" ADD CONSTRAINT "direct_message_reply_to_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "direct_message"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "direct_message_hidden" ADD CONSTRAINT "direct_message_hidden_message_id_direct_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "direct_message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_message_hidden" ADD CONSTRAINT "direct_message_hidden_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;