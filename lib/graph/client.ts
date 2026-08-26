import { env } from '../env';

/**
 * The read client. Everything the app knows about Meta's shape lives here or
 * in docs/graph-api.md, and both were written from probe output rather than
 * from documentation.
 */

export class GraphError extends Error {
  readonly status: number;
  /** Meta's own error code, which is what distinguishes the failure modes. */
  readonly code: number | null;

  constructor(status: number, code: number | null, message: string) {
    super(message);
    this.name = 'GraphError';
    this.status = status;
    this.code = code;
  }

  /**
   * Code 1 is Meta's generic "unknown error" and is transient — one post in a
   * 243-post walk returned it, and retrying is the difference between 242/243
   * coverage and 243/243. Code 2 is a temporary service issue. 429 and code 4
   * are throttling.
   */
  get isTransient(): boolean {
    return this.code === 1 || this.code === 2 || this.isRateLimited;
  }

  get isRateLimited(): boolean {
    return this.status === 429 || this.code === 4 || this.code === 17 || this.code === 32;
  }

  /** A range wider than Meta allows per request — not a missing-data signal. */
  get isRangeTooWide(): boolean {
    return /more than 30 days/.test(this.message);
  }
}

export interface RateLimitUsage {
  callCount: number | null;
  totalCputime: number | null;
  totalTime: number | null;
  estimatedTimeToRegainAccess: number | null;
  raw: string | null;
}

/**
 * Percentages of the hourly allowance. A full 243-post walk registered 1%, so
 * there is real headroom — but these are recorded into `sync_runs.stats` and
 * surfaced on /settings anyway, because throttling should be visible before it
 * becomes a stall rather than after.
 */
export function parseUsage(header: string | null): RateLimitUsage {
  const empty: RateLimitUsage = {
    callCount: null,
    totalCputime: null,
    totalTime: null,
    estimatedTimeToRegainAccess: null,
    raw: header,
  };
  if (!header) return empty;

  try {
    const parsed = JSON.parse(header) as Record<
      string,
      {
        call_count?: number;
        total_cputime?: number;
        total_time?: number;
        estimated_time_to_regain_access?: number;
      }[]
    >;
    // Meta returns one entry per business/app id. The worst case is the one
    // that matters — a limit hit anywhere stops the run.
    let worst = empty;
    for (const entries of Object.values(parsed)) {
      for (const entry of entries ?? []) {
        const candidate: RateLimitUsage = {
          callCount: entry.call_count ?? null,
          totalCputime: entry.total_cputime ?? null,
          totalTime: entry.total_time ?? null,
          estimatedTimeToRegainAccess: entry.estimated_time_to_regain_access ?? null,
          raw: header,
        };
        if ((candidate.callCount ?? 0) >= (worst.callCount ?? 0)) worst = candidate;
      }
    }
    return worst;
  } catch {
    return empty;
  }
}

let fetchImpl: typeof fetch = (...args) => fetch(...args);

/** Test seam — swap in a fake fetch without touching the network or env. */
export function __setGraphFetchForTests(fn: typeof fetch | null): void {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

export interface GraphResponse<T> {
  body: T;
  usage: RateLimitUsage;
}

export interface CallOptions {
  /** Attempts for a transient failure. Permanent errors never retry. */
  maxAttempts?: number;
  /** Base backoff. Doubles per attempt, with jitter. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function graphGet<T>(
  path: string,
  params: Record<string, string>,
  options: CallOptions = {},
): Promise<GraphResponse<T>> {
  const token = env().IG_ACCESS_TOKEN;
  if (!token) throw new GraphError(0, null, 'IG_ACCESS_TOKEN is not set');

  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: GraphError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = new URL(`https://graph.facebook.com/${env().GRAPH_API_VERSION}/${path}`);
    for (const [key, value] of Object.entries({ access_token: token, ...params })) {
      url.searchParams.set(key, value);
    }

    const res = await fetchImpl(url);
    const text = await res.text();
    const usage = parseUsage(res.headers.get('x-business-use-case-usage'));

    if (res.ok) {
      return { body: JSON.parse(text) as T, usage };
    }

    let code: number | null = null;
    let message = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as { error?: { code?: number; message?: string } };
      code = parsed.error?.code ?? null;
      message = parsed.error?.message ?? message;
    } catch {
      // keep the raw text — an unparseable body is itself information
    }

    lastError = new GraphError(res.status, code, message);
    if (!lastError.isTransient || attempt === maxAttempts) throw lastError;

    // Jitter, so a fleet of retries does not resynchronise into a thundering
    // herd against the same limit.
    const wait = backoffMs * 2 ** (attempt - 1) * (0.5 + Math.random());
    await sleep(Math.round(wait));
  }

  throw lastError ?? new GraphError(0, null, 'unreachable');
}

/**
 * `metric_type=total_value` is required by some account metrics and REJECTED
 * by others. Applying it uniformly breaks four metrics or one, depending which
 * way you guess. Verified live against every metric in both forms.
 */
export const ACCOUNT_METRIC_MODE = {
  reach: 'series',
  follower_count: 'series',
  views: 'total_value',
  profile_views: 'total_value',
  accounts_engaged: 'total_value',
  total_interactions: 'total_value',
} as const;

export type AccountMetric = keyof typeof ACCOUNT_METRIC_MODE;

/** Metrics that come back as one value per day, so one request covers a window. */
export const SERIES_METRICS = (Object.keys(ACCOUNT_METRIC_MODE) as AccountMetric[]).filter(
  (m) => ACCOUNT_METRIC_MODE[m] === 'series',
);

/** Metrics that need one request per day. Expensive, and the unstable ones. */
export const TOTAL_VALUE_METRICS = (Object.keys(ACCOUNT_METRIC_MODE) as AccountMetric[]).filter(
  (m) => ACCOUNT_METRIC_MODE[m] === 'total_value',
);

export function accountMetricParams(metric: AccountMetric): Record<string, string> {
  return ACCOUNT_METRIC_MODE[metric] === 'total_value'
    ? { metric, period: 'day', metric_type: 'total_value' }
    : { metric, period: 'day' };
}

/**
 * Meta caps a since/until range at 30 days PER REQUEST. That is not a history
 * horizon — `reach` returns data at least 365 days back when asked in 30-day
 * windows — so history is walked by paging backwards rather than widening.
 */
export const MAX_WINDOW_DAYS = 30;

export function* backwardWindows(
  from: Date,
  maxWindows: number,
  windowDays = MAX_WINDOW_DAYS - 1,
): Generator<{ since: number; until: number }> {
  let until = Math.floor(from.getTime() / 1000);
  for (let i = 0; i < maxWindows; i += 1) {
    const since = until - windowDays * 86_400;
    yield { since, until };
    until = since;
  }
}
