import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, db } from '../lib/db/client';
import { accounts } from '../lib/db/schema';
import { __setGraphFetchForTests } from '../lib/graph/client';
import { runSyncTick } from '../lib/sync/run';
import { __setEnvForTests } from '../lib/env';

/**
 * The whole loop, not one unit of it.
 *
 * Every convergence bug so far — the media edge re-walking, the account pass
 * re-requesting days Meta has no data for — passed its own unit test and then
 * failed in production, because a unit test runs ONE tick against data that
 * always answers. The failure only exists across many ticks.
 *
 * So this drives `runSyncTick` exactly as the GitHub Actions runner does, over
 * a fake account of 245 posts, and asserts it actually finishes. It is the test
 * that should have existed before any of this ran for real.
 */

__setEnvForTests({ IG_ACCESS_TOKEN: 'test-token', IG_USER_ID: 'IG1' });

const TOTAL_POSTS = 245;
const PAGE_SIZE = 50;

interface Counters {
  requests: number;
  byPath: Record<string, number>;
}

let counters: Counters;

function fakeGraph(options: { insightsAlwaysEmpty?: boolean } = {}) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname;
    counters.requests += 1;

    const key = path.includes('/insights')
      ? path.includes('IG1')
        ? 'account-insights'
        : 'post-insights'
      : path.includes('/media')
        ? 'media'
        : 'profile';
    counters.byPath[key] = (counters.byPath[key] ?? 0) + 1;

    if (key === 'profile') {
      return json({ id: 'IG1', username: 'tester', followers_count: 4876, media_count: 230 });
    }

    if (key === 'media') {
      const after = Number(url.searchParams.get('after') ?? '0');
      const slice = Array.from({ length: Math.min(PAGE_SIZE, TOTAL_POSTS - after) }, (_, i) => ({
        id: `m${after + i}`,
        shortcode: `S${after + i}`,
        media_type: 'IMAGE',
        timestamp: new Date(Date.now() - (after + i) * 86_400_000).toISOString(),
      }));
      const next = after + PAGE_SIZE < TOTAL_POSTS;
      return json({
        data: slice,
        paging: next ? { cursors: { after: String(after + PAGE_SIZE) }, next: 'https://…' } : {},
      });
    }

    if (key === 'post-insights') {
      return json({ data: [{ name: 'reach', values: [{ value: 100 }] }] });
    }

    // Account insights. The interesting case is Meta having NOTHING to say —
    // that is what made the account pass loop forever.
    if (options.insightsAlwaysEmpty) {
      return url.searchParams.get('metric_type') === 'total_value'
        ? json({ data: [{ total_value: {} }] })
        : json({ data: [{ values: [] }] });
    }
    return url.searchParams.get('metric_type') === 'total_value'
      ? json({ data: [{ total_value: { value: 12 } }] })
      : json({ data: [{ values: [{ value: 5, end_time: '2026-08-25T07:00:00+0000' }] }] });
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

async function driveToCompletion(
  maxTicks: number,
): Promise<{ ticks: number; done: boolean; stages: string[] }> {
  const stages: string[] = [];
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    const result = await runSyncTick({ maxRequests: 120, maxMs: 30_000 });
    stages.push(result.stage);
    if (result.done) return { ticks: tick, done: true, stages };
  }
  return { ticks: maxTicks, done: false, stages };
}

beforeEach(async () => {
  await db().execute(sql`truncate accounts restart identity cascade`);
  await db().execute(sql`truncate sync_runs restart identity cascade`);
  await db().insert(accounts).values({ igUserId: 'IG1', handle: 'tester' });
  counters = { requests: 0, byPath: {} };
});

afterEach(() => {
  __setGraphFetchForTests(null);
});

afterAll(async () => {
  await closeDb();
});

describe('the sync loop, driven as the runner drives it', () => {
  it('finishes 245 posts in a sane number of ticks', async () => {
    __setGraphFetchForTests(fakeGraph());
    const run = await driveToCompletion(25);

    expect(run.done).toBe(true);
    // The real thing spent 35 minutes and 40 iterations without finishing.
    expect(run.ticks).toBeLessThan(15);

    const [{ n }] = (await db().execute<{ n: number }>(
      sql`select count(*)::int as n from posts`,
    )) as unknown as { n: number }[];
    expect(n).toBe(TOTAL_POSTS);

    const [{ n: insights }] = (await db().execute<{ n: number }>(
      sql`select count(*)::int as n from post_insights where checkpoint = 'latest'`,
    )) as unknown as { n: number }[];
    expect(insights).toBe(TOTAL_POSTS);
  });

  it('finishes even when Meta has no account data at all', async () => {
    // The exact production failure: a metric with no value was re-requested on
    // every tick, so the loop could never converge.
    __setGraphFetchForTests(fakeGraph({ insightsAlwaysEmpty: true }));
    const run = await driveToCompletion(25);
    expect(run.done).toBe(true);
  });

  it('does not re-read the media edge once it has caught up', async () => {
    __setGraphFetchForTests(fakeGraph());
    await driveToCompletion(25);

    const afterFirstPass = counters.byPath.media ?? 0;
    counters.byPath.media = 0;
    await runSyncTick({ maxRequests: 120, maxMs: 30_000 });

    // One page to confirm nothing new, not a full re-walk.
    expect(counters.byPath.media).toBe(1);
    expect(afterFirstPass).toBeGreaterThan(1);
  });
});
