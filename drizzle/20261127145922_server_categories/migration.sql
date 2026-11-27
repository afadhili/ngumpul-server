CREATE TABLE "server_category" (
	"id" text PRIMARY KEY,
	"server_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_server" ADD COLUMN "members_can_invite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "server_channel" ADD COLUMN "category_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "server_category_name_unique" ON "server_category" ("server_id",lower("name"));--> statement-breakpoint
CREATE INDEX "server_channel_category_idx" ON "server_channel" ("category_id");--> statement-breakpoint
ALTER TABLE "server_category" ADD CONSTRAINT "server_category_server_id_community_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "community_server"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_channel" ADD CONSTRAINT "server_channel_category_id_server_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "server_category"("id") ON DELETE SET NULL;