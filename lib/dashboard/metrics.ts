import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * The dashboard's lower half: account and follower metrics.
 *
 * No post-performance readout — that is a deliberate product decision, and the
 * data is reachable by asking the chat instead. Everything here is SQL; no
 * model is involved.
 */

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db().execute(query)) as unknown as T[];
}

export interface DayPoint {
  day: string;
  followers: number | null;
  reach: number | null;
  missingFollowers: string | null;
}

export async function followerChart(accountId: number, days = 30) {
  const points = await rows<DayPoint>(sql`
    select day,
           follower_count as followers,
           reach,
           (unavailable ->> 'follower_count') as "missingFollowers"
    from account_daily
    where account_id = ${accountId}
    order by day desc
    limit ${days}
  `);
  points.reverse();

  const measured = points.filter((p) => p.followers != null);
  const first = measured[0];
  const last = measured[measured.length - 1];

  return {
    points,
    measured: measured.length,
    total: points.length,
    // Only a real change if there are two real readings. One reading gives no
    // change at all — and rendering that as 0 would say "you held steady",
    // which is a different and false claim.
    change:
      measured.length >= 2 && first?.followers != null && last?.followers != null
        ? last.followers - first.followers
        : null,
    from: first?.day ?? null,
    to: last?.day ?? null,
  };
}

export interface MetricSummary {
  metric: string;
  label: string;
  total: number | null;
  days: number;
  measured: number;
  /** True where Meta has redefined the metric recently — safe to state, unsafe to trend. */
  unstable: boolean;
}

const WINDOW_METRICS: [column: string, label: string, unstable: boolean][] = [
  // Reach is a typical day, not a total, so its label says so.
  ['reach', 'Accounts reached, typical day', false],
  ['views', 'Views', true],
  ['profile_views', 'Profile visits', false],
  ['accounts_engaged', 'Accounts engaged', true],
  ['total_interactions', 'Interactions', true],
];

/**
 * Recent totals per metric, in ONE round trip.
 *
 * This ran a query per metric in a loop — five sequential round trips to a
 * database on the other side of the internet, for five numbers over the same
 * thirty rows. They are now one pass over one window.
 *
 * `reach` is deliberately not summed. It counts unique accounts, so adding
 * daily values over-counts anyone reached twice; it gets a median day instead,
 * which is a statement the data can support.
 */
export async function recentTotals(accountId: number, days = 30): Promise<MetricSummary[]> {
  const [row] = await rows<Record<string, number | null>>(sql`
    select
      count(*)::int as days,
      percentile_cont(0.5) within group (order by reach)::int as reach,
      count(reach)::int as reach_measured,
      sum(views)::int as views,
      count(views)::int as views_measured,
      sum(profile_views)::int as profile_views,
      count(profile_views)::int as profile_views_measured,
      sum(accounts_engaged)::int as accounts_engaged,
      count(accounts_engaged)::int as accounts_engaged_measured,
      sum(total_interactions)::int as total_interactions,
      count(total_interactions)::int as total_interactions_measured
    from (
      select * from account_daily
      where account_id = ${accountId}
      order by day desc limit ${days}
    ) recent
  `);

  return WINDOW_METRICS.map(([column, label, unstable]) => {
    const measured = Number(row?.[`${column}_measured`] ?? 0);
    return {
      metric: column,
      label,
      // A sum over zero measured days is 0, and 0 is a claim. Blank instead.
      total: measured > 0 ? (row?.[column] ?? null) : null,
      days: Number(row?.days ?? 0),
      measured,
      unstable,
    };
  });
}

export async function followsSummary(accountId: number, days = 30) {
  const [row] = await rows<{
    follows: number | null;
    unfollows: number | null;
    measured: number;
  }>(sql`
    select sum(follows)::int as follows, sum(unfollows)::int as unfollows,
           count(follows)::int as measured
    from (
      select * from account_daily where account_id = ${accountId}
      order by day desc limit ${days}
    ) recent
  `);

  return {
    follows: row?.measured ? (row?.follows ?? null) : null,
    unfollows: row?.measured ? (row?.unfollows ?? null) : null,
    measured: row?.measured ?? 0,
    /**
     * Meta's dimensions are FOLLOWER and NON_FOLLOWER, not FOLLOW and UNFOLLOW.
     * Until a seven-day check against the profile's own follower count confirms
     * which is which, these are stored but NOT labelled — a confidently
     * inverted number under the word "unfollows" is exactly the failure this
     * product exists to avoid.
     */
    labelled: false,
  };
}
