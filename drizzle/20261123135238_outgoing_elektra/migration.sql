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
CREATE UNIQUE INDEX "attachment_storage_key_unique" ON "attachment" ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_upload_key_unique" ON "attachment" ("upload_key");--> statement-breakpoint
CREATE INDEX "attachment_target_status_created_idx" ON "attachment" ("target_type","target_id","status","created_at");--> statement-breakpoint
CREATE INDEX "attachment_uploader_created_idx" ON "attachment" ("uploader_id","created_at");--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploader_id_user_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "user"("id") ON DELETE CASCADE;