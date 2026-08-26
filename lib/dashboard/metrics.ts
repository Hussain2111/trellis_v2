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
  /** The profile's own follower total on that day — a running total, and ours. */
  followersTotal: number | null;
  /** Meta's daily metric. See the warning below before doing arithmetic on it. */
  followerMetric: number | null;
  reach: number | null;
}

/**
 * Followers over time, and the one figure here that has to be got right.
 *
 * A net change was being computed as `last − first` of Meta's `follower_count`
 * metric. That is only meaningful if the metric is a running total, and this
 * project's own probes say it is not: it read 0 at both ends of a window on an
 * account holding ~4,872 followers, and its 30-day sum matched Meta's FOLLOWER
 * dimension exactly on two separate runs — the signature of gross new follows
 * per day. Subtracting one day's arrivals from another day's arrivals and
 * printing it under "Change, 30 days" is a confidently wrong number on a page
 * whose whole claim is that it does not produce those.
 *
 * The change now comes from `followers_total`, which is the profile's own
 * follower count snapshotted by the sync. It is a running total by
 * construction. It has no history before the first sync that wrote one, and
 * until there are two readings there is no change to state — which is a blank
 * with a reason, not a zero.
 */
export async function followerChart(accountId: number, days = 30) {
  const points = await rows<DayPoint>(sql`
    select day,
           followers_total as "followersTotal",
           follower_count as "followerMetric",
           reach
    from account_daily
    where account_id = ${accountId}
    order by day desc
    limit ${days}
  `);
  points.reverse();

  const measured = points.filter((p) => p.followersTotal != null);
  const first = measured[0];
  const last = measured[measured.length - 1];

  return {
    points,
    measured: measured.length,
    total: points.length,
    change:
      measured.length >= 2 && first?.followersTotal != null && last?.followersTotal != null
        ? last.followersTotal - first.followersTotal
        : null,
    // Why there is no change to show, in the reader's terms rather than ours.
    changeUnavailable:
      measured.length === 0
        ? 'Nothing recorded yet — this starts from your next sync'
        : measured.length === 1
          ? 'One reading so far. A change needs two'
          : undefined,
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
