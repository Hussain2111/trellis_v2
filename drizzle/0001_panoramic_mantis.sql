CREATE TABLE "account_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"day" text NOT NULL,
	"follower_count" integer,
	"reach" integer,
	"views" integer,
	"profile_views" integer,
	"accounts_engaged" integer,
	"total_interactions" integer,
	"follows" integer,
	"unfollows" integer,
	"unavailable" jsonb
);
--> statement-breakpoint
CREATE TABLE "calendar_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"format" text,
	"title" text,
	"hook" text,
	"caption" text,
	"hashtags" jsonb,
	"notes" text,
	"published_post_id" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"validation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"title" text,
	"source_card_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"model" text,
	"cards_requested" integer,
	"cards_kept" integer
);
--> statement-breakpoint
CREATE TABLE "insight_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"batch_id" integer NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb,
	"cited_post_ids" jsonb,
	"rank" integer
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"status" text NOT NULL,
	"error" text,
	"duration_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"ig_comment_id" text NOT NULL,
	"username" text,
	"text" text,
	"like_count" integer,
	"commented_at" timestamp with time zone,
	"parent_ig_id" text
);
--> statement-breakpoint
CREATE TABLE "post_insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"post_id" integer NOT NULL,
	"checkpoint" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reach" integer,
	"views" integer,
	"saved" integer,
	"shares" integer,
	"likes" integer,
	"comments" integer,
	"total_interactions" integer,
	"unavailable" jsonb
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"ig_media_id" text NOT NULL,
	"shortcode" text NOT NULL,
	"permalink" text,
	"caption" text,
	"media_type" text NOT NULL,
	"media_product_type" text,
	"thumbnail_url" text,
	"media_url" text,
	"published_at" timestamp with time zone,
	"like_count" integer,
	"comments_count" integer,
	"raw" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"cursor" text,
	"stats" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "biography" text;--> statement-breakpoint
ALTER TABLE "account_daily" ADD CONSTRAINT "account_daily_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_published_post_id_posts_id_fk" FOREIGN KEY ("published_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_source_card_id_insight_cards_id_fk" FOREIGN KEY ("source_card_id") REFERENCES "public"."insight_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_batches" ADD CONSTRAINT "insight_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_cards" ADD CONSTRAINT "insight_cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_cards" ADD CONSTRAINT "insight_cards_batch_id_insight_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."insight_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_insights" ADD CONSTRAINT "post_insights_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_insights" ADD CONSTRAINT "post_insights_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_daily_day_idx" ON "account_daily" USING btree ("account_id","day");--> statement-breakpoint
CREATE INDEX "calendar_entries_scheduled_idx" ON "calendar_entries" USING btree ("account_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "chat_messages_thread_idx" ON "chat_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_threads_account_idx" ON "chat_threads" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "insight_cards_batch_idx" ON "insight_cards" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "model_runs_purpose_idx" ON "model_runs" USING btree ("purpose","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_comments_ig_idx" ON "post_comments" USING btree ("ig_comment_id");--> statement-breakpoint
CREATE INDEX "post_comments_post_idx" ON "post_comments" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_insights_post_checkpoint_idx" ON "post_insights" USING btree ("post_id","checkpoint");--> statement-breakpoint
CREATE INDEX "post_insights_account_idx" ON "post_insights" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_account_media_idx" ON "posts" USING btree ("account_id","ig_media_id");--> statement-breakpoint
CREATE INDEX "posts_published_idx" ON "posts" USING btree ("account_id","published_at");--> statement-breakpoint
CREATE INDEX "posts_shortcode_idx" ON "posts" USING btree ("shortcode");--> statement-breakpoint
CREATE INDEX "sync_runs_kind_idx" ON "sync_runs" USING btree ("account_id","kind","started_at");