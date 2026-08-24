import { pgTable, serial, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Stage 1 schema — the walking skeleton only.
 *
 * The full data model (posts, post_insights, account_daily, insight_cards,
 * chat_threads, calendar_entries, sync_runs, model_runs) lands in Task 3.1,
 * once the Stage 2 probes have answered how far media insights reach, whether
 * `follows_and_unfollows` returns values, and whether account insights backfill
 * with an explicit range. Writing those tables before the probes is exactly the
 * ordering the plan forbids.
 *
 * Every table carries `account_id` from the first migration, including this
 * one. There is no users table and no auth — the retrofit is the expensive part
 * of multi-tenancy, not the column.
 */

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  igUserId: text('ig_user_id').unique(),
  pageId: text('page_id'),
  handle: text('handle').notNull(),
  name: text('name'),
  // Nullable with no default, deliberately. A follower count of 0 and a
  // follower count we have not fetched are different claims, and only one of
  // them is ever true.
  followersCount: integer('followers_count'),
  followsCount: integer('follows_count'),
  mediaCount: integer('media_count'),
  timezone: text('timezone').notNull().default('Asia/Riyadh'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The keepalive's write target.
 *
 * Supabase Free pauses a project after ~7 days of inactivity, so the keepalive
 * has to perform a *real* write rather than a read or a ping. It writes here
 * rather than touching `accounts` so that infrastructure liveness and product
 * data never share a row — a keepalive that bumped `accounts.updated_at` would
 * make "when did this account last change" permanently meaningless.
 */
export const heartbeats = pgTable(
  'heartbeats',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('heartbeats_at_idx').on(table.at)],
);

export type Account = typeof accounts.$inferSelect;
export type Heartbeat = typeof heartbeats.$inferSelect;
