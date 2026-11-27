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
CREATE INDEX "message_submission_created_idx" ON "message_submission" ("created_at");--> statement-breakpoint
ALTER TABLE "message_submission" ADD CONSTRAINT "message_submission_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;