import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { posts } from '../db/schema';
import { riyadhDayKey } from '../time';

/**
 * Every statistic the chat can state, computed here in SQL.
 *
 * The model never does arithmetic. It asks for a figure and gets one, or asks
 * for a comparison and is told the sample will not support it. Nothing in this
 * file returns a number the database did not produce.
 *
 * Two rules from `docs/graph-api.md` are enforced here rather than left to the
 * caller:
 *
 *   `reach` is NOT additive. It counts unique accounts, so summing daily reach
 *   over-counts anyone reached twice. There is no query here that sums it.
 *
 *   `views`, `profile_views`, `accounts_engaged` and `total_interactions` were
 *   redefined by Meta within the last two years, so anything returning them
 *   carries a comparability window and the chat refuses to trend them past it.
 */

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db().execute(query)) as unknown as T[];
}

/** Metrics whose definition Meta has moved. Safe to state, unsafe to trend. */
export const UNSTABLE_METRICS = ['views', 'accounts_engaged', 'total_interactions'] as const;
export const COMPARABLE_DAYS = 90;

export interface Coverage {
  posts: number;
  postsWithInsights: number;
  oldestPost: string | null;
  newestPost: string | null;
  accountDays: number;
  followerDays: number;
  lastSyncedAt: string | null;
}

export async function accountOverview(accountId: number) {
  const [account] = await rows<{
    handle: string;
    followers_count: number | null;
    follows_count: number | null;
    last_synced_at: string | null;
  }>(sql`
    select handle, followers_count, follows_count, last_synced_at::text
    from accounts where id = ${accountId}
  `);

  const [coverage] = await rows<Coverage>(sql`
    select
      (select count(*)::int from posts where account_id = ${accountId}) as posts,
      (select count(*)::int from post_insights i
         join posts p on p.id = i.post_id
        where p.account_id = ${accountId} and i.checkpoint = 'latest' and i.reach is not null
      ) as "postsWithInsights",
      (select min(published_at)::date::text from posts where account_id = ${accountId}) as "oldestPost",
      (select max(published_at)::date::text from posts where account_id = ${accountId}) as "newestPost",
      (select count(*)::int from account_daily where account_id = ${accountId}) as "accountDays",
      (select count(follower_count)::int from account_daily where account_id = ${accountId}) as "followerDays"
  `);

  // Guaranteed present rather than possibly-undefined: the aggregate always
  // returns exactly one row, and making every caller defend against a shape
  // that cannot occur just moves noise downstream.
  const safeCoverage: Coverage = coverage ?? {
    posts: 0,
    postsWithInsights: 0,
    oldestPost: null,
    newestPost: null,
    accountDays: 0,
    followerDays: 0,
    lastSyncedAt: null,
  };

  return {
    handle: account?.handle ?? null,
    followers: account?.followers_count ?? null,
    following: account?.follows_count ?? null,
    lastSyncedAt: account?.last_synced_at ?? null,
    coverage: safeCoverage,
    // Stated up front so the model never has to guess how much it is standing on.
    note:
      `Per-post performance covers ${safeCoverage.postsWithInsights} of ${safeCoverage.posts} posts. ` +
      `Follower history reaches back ${safeCoverage.followerDays} days — Meta serves no more than about 30.`,
  };
}

export interface SeriesPoint {
  day: string;
  value: number | null;
  /** Present when the value is absent, saying which kind of absent it is. */
  missing?: string;
}

/**
 * A daily series with its gaps intact.
 *
 * A missing day is returned as `null` with a reason, never dropped and never
 * zero — a chart that silently skips absent days implies continuity that was
 * not measured.
 */
export async function followerSeries(accountId: number, days = 30) {
  const points = await rows<{ day: string; value: number | null; missing: string | null }>(sql`
    select day, follower_count as value,
           (unavailable ->> 'follower_count') as missing
    from account_daily
    where account_id = ${accountId}
    order by day desc
    limit ${days}
  `);

  const known = points.filter((p) => p.value != null);
  return {
    days: points.length,
    measured: known.length,
    points: points.reverse(),
    asOf: points[points.length - 1]?.day ?? null,
    note: 'Meta serves at most ~30 days of follower history. Older days were never available.',
  };
}

export interface RankedPost {
  id: number;
  shortcode: string;
  permalink: string | null;
  published: string | null;
  format: string;
  caption: string | null;
  value: number | null;
}

const POST_METRIC_COLUMNS = {
  reach: 'reach',
  saves: 'saved',
  shares: 'shares',
  likes: 'likes',
  comments: 'comments',
  views: 'views',
  interactions: 'total_interactions',
} as const;

export type PostMetric = keyof typeof POST_METRIC_COLUMNS;

/** Posts ranked by one metric, with the sample that was actually measured. */
export async function postsRanked(
  accountId: number,
  metric: PostMetric,
  options: { limit?: number; sinceDays?: number; format?: string } = {},
) {
  const column = POST_METRIC_COLUMNS[metric];
  const limit = Math.min(options.limit ?? 10, 50);

  const ranked = await rows<RankedPost>(sql`
    select p.id, p.shortcode, p.permalink, p.published_at::date::text as published,
           p.media_type as format, left(p.caption, 160) as caption,
           i.${sql.raw(column)} as value
    from posts p
    join post_insights i on i.post_id = p.id and i.checkpoint = 'latest'
    where p.account_id = ${accountId}
      and i.${sql.raw(column)} is not null
      ${options.sinceDays ? sql`and p.published_at > now() - (${options.sinceDays} || ' days')::interval` : sql``}
      ${options.format ? sql`and p.media_type = ${options.format}` : sql``}
    order by i.${sql.raw(column)} desc
    limit ${limit}
  `);

  const [counts] = await rows<{ measured: number; total: number }>(sql`
    select count(i.${sql.raw(column)})::int as measured, count(*)::int as total
    from posts p
    left join post_insights i on i.post_id = p.id and i.checkpoint = 'latest'
    where p.account_id = ${accountId}
      ${options.format ? sql`and p.media_type = ${options.format}` : sql``}
  `);

  return {
    metric,
    posts: ranked,
    sampleSize: counts?.measured ?? 0,
    populationSize: counts?.total ?? 0,
    comparable: !(UNSTABLE_METRICS as readonly string[]).includes(column),
  };
}

/** The account's own baseline for a metric — what "normal" is for this account. */
export async function trailingMedian(
  accountId: number,
  metric: PostMetric,
  options: { sinceDays?: number; format?: string } = {},
) {
  const column = POST_METRIC_COLUMNS[metric];
  const [result] = await rows<{ median: number | null; measured: number; total: number }>(sql`
    select
      percentile_cont(0.5) within group (order by i.${sql.raw(column)})::int as median,
      count(i.${sql.raw(column)})::int as measured,
      count(*)::int as total
    from posts p
    left join post_insights i on i.post_id = p.id and i.checkpoint = 'latest'
    where p.account_id = ${accountId}
      ${options.sinceDays ? sql`and p.published_at > now() - (${options.sinceDays} || ' days')::interval` : sql``}
      ${options.format ? sql`and p.media_type = ${options.format}` : sql``}
  `);

  return {
    metric,
    median: result?.median ?? null,
    sampleSize: result?.measured ?? 0,
    populationSize: result?.total ?? 0,
  };
}

export interface FormatRow {
  format: string;
  posts: number;
  measured: number;
  median: number | null;
}

/**
 * Per-format medians — or a refusal.
 *
 * Refusing is correct behaviour when a floor is genuinely unmet, and with 246
 * posts across three formats it is no longer the common case. Both paths matter:
 * the refusal must stay available, and the answering path must not be treated
 * as exceptional.
 */
export async function formatBreakdown(
  accountId: number,
  metric: PostMetric,
  options: { minSample?: number; sinceDays?: number } = {},
) {
  const column = POST_METRIC_COLUMNS[metric];
  const minSample = options.minSample ?? 5;

  const all = await rows<FormatRow>(sql`
    select p.media_type as format,
           count(*)::int as posts,
           count(i.${sql.raw(column)})::int as measured,
           percentile_cont(0.5) within group (order by i.${sql.raw(column)})::int as median
    from posts p
    left join post_insights i on i.post_id = p.id and i.checkpoint = 'latest'
    where p.account_id = ${accountId}
      ${options.sinceDays ? sql`and p.published_at > now() - (${options.sinceDays} || ' days')::interval` : sql``}
    group by p.media_type
    order by count(*) desc
  `);

  const qualifying = all.filter((row) => row.measured >= minSample);
  const excluded = all.filter((row) => row.measured < minSample);

  if (qualifying.length < 2) {
    return {
      comparable: false,
      refusal:
        qualifying.length === 0
          ? `No format has ${minSample} measured posts, so there is nothing to compare.`
          : `Only ${qualifying[0]!.format} has ${minSample} or more measured posts. A comparison against a format with fewer would not mean anything.`,
      formats: all,
      minSample,
    };
  }

  return { comparable: true, formats: qualifying, excluded, minSample };
}

export interface CheckpointRow {
  checkpoint: string;
  reach: number | null;
  views: number | null;
  saved: number | null;
  shares: number | null;
  missing: string | null;
}

/**
 * One post's readings across every checkpoint that exists for it.
 *
 * The distinction this returns is the one the whole product turns on. A post
 * published before this app existed has no t24/t48/t7d reading — and that is
 * NOT zero, NOT "Meta declined", and NOT the same as a post being too new. It
 * is `never_sampled`: nobody measured at that age and nobody can now.
 */
export async function postPerformance(accountId: number, postId: number) {
  const [post] = await rows<{
    id: number;
    shortcode: string;
    permalink: string | null;
    published: string | null;
    format: string;
    caption: string | null;
  }>(sql`
    select id, shortcode, permalink, published_at::date::text as published,
           media_type as format, left(caption, 300) as caption
    from posts where id = ${postId} and account_id = ${accountId}
  `);

  if (!post) return { found: false as const, postId };

  const checkpoints = await rows<CheckpointRow>(sql`
    select checkpoint, reach, views, saved, shares,
           coalesce(unavailable ->> 'all', unavailable ->> 'reach') as missing
    from post_insights
    where post_id = ${postId}
    order by case checkpoint
      when 't24' then 1 when 't48' then 2 when 't7d' then 3 else 4 end
  `);

  const curve = checkpoints.filter((c) => c.checkpoint !== 'latest' && c.reach != null);

  return {
    found: true as const,
    post,
    checkpoints,
    hasCurve: curve.length > 0,
    curveNote: curve.length
      ? `This post has ${curve.length} timed reading(s), so how it moved over time can be described.`
      : 'This post has no timed readings. It was published before measurement began, so how it moved in its first hours was never recorded — that is different from it having moved by zero.',
  };
}

/** Recent posts as content, without performance. */
export async function recentPosts(accountId: number, limit = 10, format?: string) {
  const posts = await rows<{
    id: number;
    shortcode: string;
    permalink: string | null;
    published: string | null;
    format: string;
    caption: string | null;
  }>(sql`
    select id, shortcode, permalink, published_at::date::text as published,
           media_type as format, left(caption, 200) as caption
    from posts
    where account_id = ${accountId}
      ${format ? sql`and media_type = ${format}` : sql``}
    order by published_at desc nulls last
    limit ${Math.min(limit, 50)}
  `);
  return { posts, count: posts.length };
}

/**
 * Posts by id, so a note can say which posts it means in words a person knows.
 *
 * Nothing on screen should ever say "post 94". That number is a row id in this
 * app's own database — it is not on Instagram, it is not in the creator's head,
 * and there is no way for them to work out which post it refers to. What they
 * know a post by is when it went up and what it was about.
 */
export interface NamedPost {
  id: number;
  permalink: string | null;
  published: string | null;
  format: string;
  caption: string | null;
}

export async function postsByIds(accountId: number, ids: number[]): Promise<NamedPost[]> {
  if (ids.length === 0) return [];

  // The query builder rather than a raw template, because `id = any($1)` with a
  // JS array does not survive the trip: drizzle flattens the array into
  // separate parameters and the driver is handed a number where it expects an
  // array. `inArray` builds the list properly.
  const found = await db()
    .select({
      id: posts.id,
      permalink: posts.permalink,
      publishedAt: posts.publishedAt,
      mediaType: posts.mediaType,
      caption: posts.caption,
    })
    .from(posts)
    .where(and(eq(posts.accountId, accountId), inArray(posts.id, ids)))
    .orderBy(desc(posts.publishedAt));

  return found.map((post) => ({
    id: post.id,
    permalink: post.permalink,
    published: post.publishedAt ? riyadhDayKey(post.publishedAt) : null,
    format: post.mediaType,
    caption: post.caption?.slice(0, 120) ?? null,
  }));
}

/**
 * One insight card, re-resolved.
 *
 * This is the chat/dashboard contract. Clicking a note passes a REFERENCE, and
 * the chat fetches the card through here so its figures arrive as a tool result
 * — which is what the validator checks the answer against. Had the evidence
 * been pasted into the prompt instead, it would count as unbacked and the chat
 * would strip the card's own numbers when repeating them.
 */
export async function insightCard(accountId: number, cardId: number) {
  // `generated_at` is on the BATCH, not the card — a card has no timestamp of
  // its own. Selecting it from `insight_cards` threw on every call, which meant
  // the entire card-to-chat contract had never once worked: clicking a note
  // reached a tool that could only error. Nothing caught it because nothing
  // tested it, so there is a test beside this now.
  const [card] = await rows<{
    id: number;
    body: string;
    payload: unknown;
    cited_post_ids: number[] | null;
    generated_at: string;
  }>(sql`
    select c.id, c.body, c.payload, c.cited_post_ids, b.generated_at::text
    from insight_cards c
    join insight_batches b on b.id = c.batch_id
    where c.id = ${cardId} and c.account_id = ${accountId}
  `);

  if (!card) return { found: false as const, cardId };

  const age = Math.floor((Date.now() - new Date(card.generated_at).getTime()) / 86_400_000);

  return {
    found: true as const,
    body: card.body,
    evidence: card.payload,
    citedPostIds: card.cited_post_ids ?? [],
    generatedAt: card.generated_at.slice(0, 10),
    // Cards are generated on a schedule, so one may be days old. Saying so is
    // the difference between quoting it and asserting it as current.
    freshness: age === 0 ? 'generated today' : `generated ${age} day${age === 1 ? '' : 's'} ago`,
  };
}
