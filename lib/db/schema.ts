import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { UnavailableMap } from './unavailable';

/**
 * One schema, one source of truth. All three surfaces read from here.
 *
 * Two rules govern every table below, and both are easy to violate by
 * accident:
 *
 *   1. NO `default 0` ON ANY METRIC COLUMN. A zero written at the storage
 *      layer is unrecoverable — nothing downstream can distinguish it from a
 *      real measurement of zero. Every metric is nullable with no default.
 *
 *   2. Every missing number carries a reason from the closed set in
 *      ./unavailable.ts. Blank is not enough; blank with the wrong reason is a
 *      different false claim.
 *
 * `account_id` is on every table from the first migration, with exactly one
 * row in `accounts`. There is no users table and no auth — the retrofit is the
 * expensive part of multi-tenancy, not the column.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  igUserId: text('ig_user_id').unique(),
  pageId: text('page_id'),
  handle: text('handle').notNull(),
  name: text('name'),
  biography: text('biography'),
  /**
   * The CURRENT value from the account edge. Distinct from
   * `account_daily.follower_count`, which is the historical series from the
   * insights edge. Two names for closely related things — do not blur them.
   */
  followersCount: integer('followers_count'),
  followsCount: integer('follows_count'),
  /**
   * Meta's own count, kept for reference but NEVER used as a completion check
   * for the media walk: it reported 229 where a full walk found 243. Terminate
   * pagination by exhaustion.
   */
  mediaCount: integer('media_count'),
  timezone: text('timezone').notNull().default('Asia/Riyadh'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export const posts = pgTable(
  'posts',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    igMediaId: text('ig_media_id').notNull(),
    shortcode: text('shortcode').notNull(),
    permalink: text('permalink'),
    caption: text('caption'),
    /** `image` | `carousel` | `reel` | `video` | `unknown`. */
    mediaType: text('media_type').notNull(),
    mediaProductType: text('media_product_type'),
    /**
     * Both are stored because the field served is media-type conditional:
     * `thumbnail_url` on VIDEO/REELS, `media_url` on CAROUSEL_ALBUM and IMAGE.
     * Select by type at read time rather than coalescing at write time.
     */
    thumbnailUrl: text('thumbnail_url'),
    mediaUrl: text('media_url'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    likeCount: integer('like_count'),
    commentsCount: integer('comments_count'),
    /** The untouched payload, so re-normalising after field drift costs nothing. */
    raw: jsonb('raw'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('posts_account_media_idx').on(table.accountId, table.igMediaId),
    index('posts_published_idx').on(table.accountId, table.publishedAt),
    index('posts_shortcode_idx').on(table.shortcode),
  ],
);

export const postComments = pgTable(
  'post_comments',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    igCommentId: text('ig_comment_id').notNull(),
    username: text('username'),
    text: text('text'),
    likeCount: integer('like_count'),
    commentedAt: timestamp('commented_at', { withTimezone: true }),
    parentIgId: text('parent_ig_id'),
  },
  (table) => [
    uniqueIndex('post_comments_ig_idx').on(table.igCommentId),
    index('post_comments_post_idx').on(table.postId),
  ],
);

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * The sampling record — and it is a record of sampling, not of truth.
 *
 * Meta serves cumulative lifetime totals and no historical curve, so a curve
 * exists ONLY where it was sampled at the time. That gives this table two
 * permanent shapes:
 *
 *   Historical posts — one row, `checkpoint = 'latest'`. Fine for medians,
 *   baselines, ranking and format comparison.
 *
 *   Posts published after go-live — a real curve at t24/t48/t7d/latest.
 *
 * `t24`/`t48`/`t7d` can NEVER exist for a post published before this app did.
 * Where the distinction matters, the absence carries `never_sampled` — which
 * is a different claim from zero, from `too new`, and from Meta declining.
 */
export const postInsights = pgTable(
  'post_insights',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /** `t24` | `t48` | `t7d` | `latest`. */
    checkpoint: text('checkpoint').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    reach: integer('reach'),
    views: integer('views'),
    saved: integer('saved'),
    shares: integer('shares'),
    likes: integer('likes'),
    comments: integer('comments'),
    totalInteractions: integer('total_interactions'),
    /** Per-metric reasons. See ./unavailable.ts — the set is closed. */
    unavailable: jsonb('unavailable').$type<UnavailableMap>(),
  },
  (table) => [
    uniqueIndex('post_insights_post_checkpoint_idx').on(table.postId, table.checkpoint),
    index('post_insights_account_idx').on(table.accountId),
  ],
);

/**
 * Account metrics, one row per Riyadh day.
 *
 * All six metrics live here — confirmed, every one yields a usable daily value
 * from a one-day window. But their COST differs sharply and the sync layer has
 * to know it: `reach` and `follower_count` come back as a series (one request
 * per 30-day window), while `views`, `profile_views`, `accounts_engaged` and
 * `total_interactions` are one request per day.
 *
 * `metric_type=total_value` is required by those four and REJECTED by
 * `follower_count`. It cannot be applied uniformly in either direction.
 *
 * Rows older than the backfill's expensive-metric window carry `reach` and
 * `follower_count` with the other four marked `not_backfilled` — which is a
 * different claim from `declined_by_meta` and must not be rendered as one.
 */
export const accountDaily = pgTable(
  'account_daily',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /**
     * `YYYY-MM-DD` in Riyadh, stored as text so the boundary is decided exactly
     * once, at write time, by lib/time.ts. A date column would invite a second
     * opinion about which day 22:00 UTC belongs to.
     */
    day: text('day').notNull(),
    /** The historical series. NOT `accounts.followers_count`, which is current. */
    followerCount: integer('follower_count'),
    reach: integer('reach'),
    views: integer('views'),
    profileViews: integer('profile_views'),
    accountsEngaged: integer('accounts_engaged'),
    totalInteractions: integer('total_interactions'),
    /**
     * Stored, but NOT labelled in the UI until the seven-day check confirms
     * what Meta's FOLLOWER / NON_FOLLOWER dimensions actually mean. The
     * gross-follows reading fits the numbers exactly and may still be a
     * coincidence between two views of the same counter.
     */
    follows: integer('follows'),
    unfollows: integer('unfollows'),
    unavailable: jsonb('unavailable').$type<UnavailableMap>(),
  },
  (table) => [uniqueIndex('account_daily_day_idx').on(table.accountId, table.day)],
);

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export const insightBatches = pgTable('insight_batches', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  /** `ok` | `fallback`. A batch keeping zero cards still writes a row. */
  status: text('status').notNull(),
  /** Why it produced what it produced. Silence has to be explicable. */
  reason: text('reason'),
  model: text('model'),
  cardsRequested: integer('cards_requested'),
  cardsKept: integer('cards_kept'),
});

export const insightCards = pgTable(
  'insight_cards',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    batchId: integer('batch_id')
      .notNull()
      .references(() => insightBatches.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    /**
     * The SQL-computed evidence this card was generated from. The chat
     * re-resolves it through `getInsightCard` rather than receiving it pasted
     * into a prompt — a figure that arrives as prompt text is unbacked, and the
     * validator would strip the card's own numbers when the chat repeated them.
     */
    payload: jsonb('payload'),
    citedPostIds: jsonb('cited_post_ids').$type<number[]>(),
    rank: integer('rank'),
  },
  (table) => [index('insight_cards_batch_idx').on(table.batchId)],
);

export const chatThreads = pgTable(
  'chat_threads',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    title: text('title'),
    /** Set when the thread was opened by clicking a sticky note. */
    sourceCardId: integer('source_card_id').references(() => insightCards.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('chat_threads_account_idx').on(table.accountId)],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: serial('id').primaryKey(),
    threadId: integer('thread_id')
      .notNull()
      .references(() => chatThreads.id, { onDelete: 'cascade' }),
    /** `user` | `assistant`. */
    role: text('role').notNull(),
    content: text('content').notNull(),
    toolCalls: jsonb('tool_calls'),
    /**
     * What the numeric validator dropped, and why. The audit trail for the
     * guarantee — without it, "it doesn't invent numbers" is unfalsifiable.
     */
    validation: jsonb('validation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('chat_messages_thread_idx').on(table.threadId, table.createdAt)],
);

/**
 * The calendar. The only surface where the user does something rather than
 * reads something.
 *
 * `due` and `overdue` are DERIVED at read time by lib/time.ts and never stored.
 * A status written to a row goes stale the moment the clock passes it, and a
 * stale "planned" on something three days overdue is exactly the believable
 * falsehood this product exists not to produce.
 */
export const calendarEntries = pgTable(
  'calendar_entries',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    /** `planned` | `published` only. The other two states are computed. */
    status: text('status').notNull().default('planned'),
    format: text('format'),
    title: text('title'),
    hook: text('hook'),
    caption: text('caption'),
    hashtags: jsonb('hashtags').$type<string[]>(),
    notes: text('notes'),
    /** Set when a synced post is matched to this entry — always with a confirm step. */
    publishedPostId: integer('published_post_id').references(() => posts.id, {
      onDelete: 'set null',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('calendar_entries_scheduled_idx').on(table.accountId, table.scheduledFor)],
);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * The resumption point and the audit trail.
 *
 * `cursor` is written BEFORE a page is processed, not after, so an
 * interruption — a rate limit, a function timeout — resumes from the right
 * place instead of restarting the walk.
 */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** `account` | `media` | `post_insights` | `comments` | `backfill`. */
    kind: text('kind').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** `running` | `done` | `waiting` | `failed`. */
    status: text('status').notNull(),
    cursor: text('cursor'),
    /** Includes Meta's rate-limit headers, so throttling is visible before it stalls. */
    stats: jsonb('stats'),
    error: text('error'),
  },
  (table) => [index('sync_runs_kind_idx').on(table.accountId, table.kind, table.startedAt)],
);

/**
 * The quota ledger. THE UNIT IS CALLS, NOT MESSAGES — one chat message becomes
 * several calls once the tool loop runs.
 *
 * Failures are recorded too. A failed call spent the same quota as a
 * successful one, and a ledger counting only successes lets a retry loop walk
 * straight through the cap.
 */
export const modelRuns = pgTable(
  'model_runs',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    /** `chat` | `cards`. */
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    /** `ok` | `error`. */
    status: text('status').notNull(),
    error: text('error'),
    durationMs: bigint('duration_ms', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('model_runs_purpose_idx').on(table.purpose, table.createdAt)],
);

/**
 * The keepalive's write target. Supabase Free pauses after ~7 days idle, so
 * this performs a real write rather than a read — a read may be served without
 * waking anything.
 *
 * Deliberately not `accounts.updated_at`: a keepalive bumping a product row
 * would make "when did this account last change" permanently meaningless.
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
export type Post = typeof posts.$inferSelect;
export type PostComment = typeof postComments.$inferSelect;
export type PostInsight = typeof postInsights.$inferSelect;
export type AccountDaily = typeof accountDaily.$inferSelect;
export type InsightBatch = typeof insightBatches.$inferSelect;
export type InsightCard = typeof insightCards.$inferSelect;
export type ChatThread = typeof chatThreads.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type CalendarEntry = typeof calendarEntries.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type ModelRun = typeof modelRuns.$inferSelect;
export type Heartbeat = typeof heartbeats.$inferSelect;
