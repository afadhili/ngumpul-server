CREATE TABLE "direct_call" (
	"id" text PRIMARY KEY,
	"caller_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "direct_call_distinct_users" CHECK ("caller_id" <> "recipient_id"),
	CONSTRAINT "direct_call_kind_check" CHECK ("kind" IN ('audio', 'video')),
	CONSTRAINT "direct_call_status_check" CHECK ("status" IN ('ringing', 'active', 'declined', 'ended'))
);
--> statement-breakpoint
CREATE INDEX "direct_call_caller_created_idx" ON "direct_call" ("caller_id","created_at");--> statement-breakpoint
CREATE INDEX "direct_call_recipient_created_idx" ON "direct_call" ("recipient_id","created_at");--> statement-breakpoint
ALTER TABLE "direct_call" ADD CONSTRAINT "direct_call_caller_id_user_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "direct_call" ADD CONSTRAINT "direct_call_recipient_id_user_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "user"("id") ON DELETE CASCADE;