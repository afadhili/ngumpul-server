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
ALTER TABLE "profile" ADD COLUMN "photo_visibility" text DEFAULT 'friends' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "online_status_visibility" text DEFAULT 'friends' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "last_seen_visibility" text DEFAULT 'friends' NOT NULL;--> statement-breakpoint
CREATE INDEX "user_block_blocked_id_idx" ON "user_block" ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_report_reporter_reported_unique" ON "user_report" ("reporter_id","reported_id");--> statement-breakpoint
CREATE INDEX "user_report_status_created_idx" ON "user_report" ("status","created_at");--> statement-breakpoint
ALTER TABLE "user_block" ADD CONSTRAINT "user_block_blocker_id_user_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_block" ADD CONSTRAINT "user_block_blocked_id_user_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_report" ADD CONSTRAINT "user_report_reporter_id_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_report" ADD CONSTRAINT "user_report_reported_id_user_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "user"("id") ON DELETE CASCADE;