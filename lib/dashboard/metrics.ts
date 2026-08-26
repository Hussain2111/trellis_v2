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
  ['reach', 'Accounts reached', false],
  ['views', 'Views', true],
  ['profile_views', 'Profile visits', false],
  ['accounts_engaged', 'Accounts engaged', true],
  ['total_interactions', 'Interactions', true],
];

/**
 * Recent totals per metric.
 *
 * `reach` is deliberately absent from the summed figures — it counts unique
 * accounts, so adding daily values over-counts anyone reached twice. It gets a
 * median instead, which is a statement the data can support.
 */
export async function recentTotals(accountId: number, days = 30): Promise<MetricSummary[]> {
  const out: MetricSummary[] = [];

  for (const [column, label, unstable] of WINDOW_METRICS) {
    const [row] = await rows<{ total: number | null; measured: number; days: number }>(sql`
      select
        ${column === 'reach' ? sql`percentile_cont(0.5) within group (order by reach)::int` : sql.raw(`sum(${column})::int`)} as total,
        count(${sql.raw(column)})::int as measured,
        count(*)::int as days
      from (
        select * from account_daily
        where account_id = ${accountId}
        order by day desc limit ${days}
      ) recent
    `);

    out.push({
      metric: column,
      label: column === 'reach' ? 'Accounts reached (median day)' : label,
      total: row?.measured ? (row?.total ?? null) : null,
      days: row?.days ?? 0,
      measured: row?.measured ?? 0,
      unstable,
    });
  }

  return out;
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
