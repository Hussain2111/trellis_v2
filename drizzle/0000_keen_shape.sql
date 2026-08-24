CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ig_user_id" text,
	"page_id" text,
	"handle" text NOT NULL,
	"name" text,
	"followers_count" integer,
	"follows_count" integer,
	"media_count" integer,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_ig_user_id_unique" UNIQUE("ig_user_id")
);
--> statement-breakpoint
CREATE TABLE "heartbeats" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "heartbeats_at_idx" ON "heartbeats" USING btree ("at");