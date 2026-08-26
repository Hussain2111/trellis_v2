import {
  GraphError,
  accountMetricParams,
  graphGet,
  type AccountMetric,
  type RateLimitUsage,
} from './client';
import type { UnavailableMap } from '../db/unavailable';

/**
 * Insights, per post and per account.
 *
 * The governing fact: Meta serves cumulative lifetime totals and no historical
 * curve. A curve exists only where it was sampled at the time, which is why
 * `post_insights` is a record of sampling rather than of truth.
 */

export const POST_METRICS = [
  'reach',
  'views',
  'saved',
  'shares',
  'likes',
  'comments',
  'total_interactions',
] as const;

export type PostMetric = (typeof POST_METRICS)[number];

export interface PostInsightResult {
  values: Partial<Record<PostMetric, number>>;
  unavailable: UnavailableMap;
  usage: RateLimitUsage;
}

interface InsightRow {
  name?: string;
  values?: { value?: unknown; end_time?: string }[];
  total_value?: { value?: unknown };
}

/**
 * Reels and carousels return identical metric sets, so one batched request
 * serves every media type. If Meta declines the batch, each metric is asked
 * for individually — a single unsupported metric must not take the other six
 * with it, and the reason for each absence is recorded rather than inferred.
 */
export async function fetchPostInsights(igMediaId: string): Promise<PostInsightResult> {
  const values: Partial<Record<PostMetric, number>> = {};
  const unavailable: UnavailableMap = {};

  try {
    const { body, usage } = await graphGet<{ data?: InsightRow[] }>(`${igMediaId}/insights`, {
      metric: POST_METRICS.join(','),
    });
    for (const row of body.data ?? []) {
      const name = row.name as PostMetric | undefined;
      const value = row.values?.[0]?.value;
      if (name && typeof value === 'number') values[name] = value;
    }
    for (const metric of POST_METRICS) {
      if (!(metric in values)) unavailable[metric] = 'declined_by_meta';
    }
    return { values, unavailable, usage };
  } catch (error) {
    if (error instanceof GraphError && !error.isTransient) {
      return await fetchPostInsightsIndividually(igMediaId);
    }
    throw error;
  }
}

async function fetchPostInsightsIndividually(igMediaId: string): Promise<PostInsightResult> {
  const values: Partial<Record<PostMetric, number>> = {};
  const unavailable: UnavailableMap = {};
  let usage: RateLimitUsage = {
    callCount: null,
    totalCputime: null,
    totalTime: null,
    estimatedTimeToRegainAccess: null,
    raw: null,
  };

  for (const metric of POST_METRICS) {
    try {
      const res = await graphGet<{ data?: InsightRow[] }>(`${igMediaId}/insights`, { metric });
      usage = res.usage;
      const value = res.body.data?.[0]?.values?.[0]?.value;
      if (typeof value === 'number') values[metric] = value;
      else unavailable[metric] = 'declined_by_meta';
    } catch (error) {
      // Transient failures survived the client's own retries, so this is as
      // good as it gets — and it is a different claim from Meta declining.
      unavailable[metric] =
        error instanceof GraphError && error.isTransient
          ? 'transient_after_retries'
          : 'declined_by_meta';
    }
  }

  return { values, unavailable, usage };
}

export interface DailyPoint {
  day: string;
  value: number;
}

/**
 * A metric served as a per-day series. One request covers a window of up to 30
 * days — Meta's per-request range cap, not a history limit.
 *
 * NOTE for callers: `reach` counts unique accounts and is therefore NOT
 * additive. Summing these daily values into a period figure over-counts anyone
 * reached on more than one day. Ask for the window total instead.
 */
export async function fetchAccountSeries(
  igUserId: string,
  metric: AccountMetric,
  window: { since: number; until: number },
): Promise<{ points: DailyPoint[]; usage: RateLimitUsage }> {
  const { body, usage } = await graphGet<{ data?: InsightRow[] }>(`${igUserId}/insights`, {
    ...accountMetricParams(metric),
    since: String(window.since),
    until: String(window.until),
  });

  const points: DailyPoint[] = [];
  for (const entry of body.data?.[0]?.values ?? []) {
    const day = entry.end_time?.slice(0, 10);
    if (day && typeof entry.value === 'number') points.push({ day, value: entry.value });
  }
  return { points, usage };
}

/** A metric served only as one aggregate for the requested window. */
export async function fetchAccountTotal(
  igUserId: string,
  metric: AccountMetric,
  window: { since: number; until: number },
): Promise<{ value: number | null; usage: RateLimitUsage }> {
  const { body, usage } = await graphGet<{ data?: InsightRow[] }>(`${igUserId}/insights`, {
    ...accountMetricParams(metric),
    since: String(window.since),
    until: String(window.until),
  });
  const value = body.data?.[0]?.total_value?.value;
  return { value: typeof value === 'number' ? value : null, usage };
}
