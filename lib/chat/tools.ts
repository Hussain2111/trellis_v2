import { tool } from 'ai';
import { z } from 'zod';
import {
  accountOverview,
  followerSeries,
  formatBreakdown,
  postPerformance,
  insightCard,
  postsRanked,
  recentPosts,
  trailingMedian,
} from './queries';

/**
 * The chat's tool surface.
 *
 * These are PRE-COMPUTED AGGREGATES, never a general query runner. The model
 * decides what to fetch; it does not decide how a median is calculated, and it
 * cannot ask for raw rows and do arithmetic on them.
 *
 * Every tool returns its sample size alongside its answer, so "how many posts
 * is this based on" is never a separate question the model has to think to ask.
 */

const METRIC = z
  .enum(['reach', 'saves', 'shares', 'likes', 'comments', 'views', 'interactions'])
  .describe('Which measure to use. "reach" is accounts reached and is the most reliable.');

/** Everything a tool returns is wrapped so provenance travels with the data. */
function envelope<T extends object>(data: T, extra: Record<string, unknown> = {}) {
  return { ...data, ...extra, asOf: new Date().toISOString().slice(0, 10) };
}

export function chatTools(accountId: number) {
  return {
    getAccountOverview: tool({
      description:
        "The account's size, how many posts exist, how many have performance data, and how far back each kind of data reaches. Call this first if you are unsure what you can answer.",
      inputSchema: z.object({}),
      execute: async () => envelope(await accountOverview(accountId)),
    }),

    getFollowerSeries: tool({
      description:
        'Daily follower counts. Meta only serves about 30 days, so anything older was never available — days with no reading are returned as null with a reason, not as zero.',
      inputSchema: z.object({
        days: z.number().int().min(2).max(400).default(30),
      }),
      execute: async ({ days }) => envelope(await followerSeries(accountId, days)),
    }),

    getPostsRanked: tool({
      description:
        'The best-performing posts by one measure, with permalinks. Use this for "which posts did best" questions.',
      inputSchema: z.object({
        metric: METRIC,
        limit: z.number().int().min(1).max(25).default(10),
        sinceDays: z.number().int().min(1).max(2000).optional(),
        format: z.enum(['image', 'carousel', 'reel', 'video']).optional(),
      }),
      execute: async ({ metric, limit, sinceDays, format }) =>
        envelope(await postsRanked(accountId, metric, { limit, sinceDays, format })),
    }),

    getTrailingMedian: tool({
      description:
        "The account's own median for a measure — its normal. Use this as the baseline for whether a post did well, rather than any outside benchmark.",
      inputSchema: z.object({
        metric: METRIC,
        sinceDays: z.number().int().min(1).max(2000).optional(),
        format: z.enum(['image', 'carousel', 'reel', 'video']).optional(),
      }),
      execute: async ({ metric, sinceDays, format }) =>
        envelope(await trailingMedian(accountId, metric, { sinceDays, format })),
    }),

    getFormatBreakdown: tool({
      description:
        'Per-format medians for one measure. Returns comparable:false with a refusal when fewer than two formats have enough measured posts — in that case say so plainly and do not compare them anyway.',
      inputSchema: z.object({
        metric: METRIC,
        minSample: z.number().int().min(2).max(50).default(5),
        sinceDays: z.number().int().min(1).max(2000).optional(),
      }),
      execute: async ({ metric, minSample, sinceDays }) =>
        envelope(await formatBreakdown(accountId, metric, { minSample, sinceDays })),
    }),

    getPostPerformance: tool({
      description:
        'One post in detail, including which timed readings exist. A post published before measurement began has no 24h/48h/7d reading — that is "never measured", which is NOT zero and NOT the same as a post being too new. Never imply a post has a curve when hasCurve is false.',
      inputSchema: z.object({ postId: z.number().int() }),
      execute: async ({ postId }) => envelope(await postPerformance(accountId, postId)),
    }),

    getInsightCard: tool({
      description:
        'The evidence behind a note from the dashboard. Call this when the conversation started from one — it returns what the note was computed from, and how old it is. Say when it was generated rather than implying it is current.',
      inputSchema: z.object({ cardId: z.number().int() }),
      execute: async ({ cardId }) => envelope(await insightCard(accountId, cardId)),
    }),

    getRecentPosts: tool({
      description:
        'Recent posts as content — caption, format, date, permalink — without performance numbers. Use when the question is about what was posted rather than how it did.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(25).default(10),
        format: z.enum(['image', 'carousel', 'reel', 'video']).optional(),
      }),
      execute: async ({ limit, format }) => envelope(await recentPosts(accountId, limit, format)),
    }),
  };
}
