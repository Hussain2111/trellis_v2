import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, db } from '../lib/db/client';
import { accountDaily, accounts, postInsights, posts } from '../lib/db/schema';
import { __setGraphFetchForTests } from '../lib/graph/client';
import { RunBudget } from '../lib/sync/budget';
import { checkpointsDue, missingCheckpointReason, tooNewFor } from '../lib/sync/checkpoints';
import { backfillPostInsights } from '../lib/sync/insights';
import { syncMedia } from '../lib/sync/media';
import { syncAccountDaily } from '../lib/sync/account';
import { __setEnvForTests } from '../lib/env';

__setEnvForTests({ IG_ACCESS_TOKEN: 'test-token' });

let accountId: number;

beforeEach(async () => {
  await db().execute(sql`truncate accounts restart identity cascade`);
  await db().execute(sql`truncate sync_runs restart identity cascade`);
  const [row] = await db()
    .insert(accounts)
    .values({ igUserId: 'IG1', handle: 'tester' })
    .returning();
  accountId = row!.id;
});

afterEach(() => {
  __setGraphFetchForTests(null);
});

afterAll(async () => {
  await closeDb();
});

function reply(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('checkpoint policy', () => {
  const published = new Date('2026-08-01T00:00:00Z');

  it('offers latest always, and the aged checkpoints only inside their window', () => {
    expect(checkpointsDue(published, new Date('2026-08-01T06:00:00Z'))).toEqual(['latest']);
    expect(checkpointsDue(published, new Date('2026-08-02T06:00:00Z'))).toContain('t24');
    expect(checkpointsDue(published, new Date('2026-08-03T06:00:00Z'))).toContain('t48');
    expect(checkpointsDue(published, new Date('2026-08-08T06:00:00Z'))).toContain('t7d');
  });

  it('says never_sampled for a window that has already passed', () => {
    // A 2021 post has no t48 reading. Meta did not decline it — nobody
    // measured at that age, and nobody can now. This is the distinction the
    // chat's acceptance test turns on.
    const old = new Date('2021-06-04T00:00:00Z');
    expect(missingCheckpointReason('t48', old, new Date('2026-08-26T00:00:00Z'))).toBe(
      'never_sampled',
    );
  });

  it('does not say never_sampled for a post that is merely too new', () => {
    const fresh = new Date('2026-08-26T00:00:00Z');
    const now = new Date('2026-08-26T06:00:00Z');
    expect(missingCheckpointReason('t48', fresh, now)).toBeNull();
    expect(tooNewFor('t48', fresh, now)).toBe(true);
  });
});

describe('run budget', () => {
  it('stops on the request cap', () => {
    const budget = new RunBudget({ maxRequests: 2 });
    expect(budget.canSpend()).toBe(true);
    budget.spend();
    budget.spend();
    expect(budget.canSpend()).toBe(false);
  });

  it('treats Meta signalling a wait as throttling, independent of our own count', () => {
    const budget = new RunBudget();
    budget.spend({
      callCount: 5,
      totalCputime: 1,
      totalTime: 1,
      estimatedTimeToRegainAccess: 300,
      raw: null,
    });
    expect(budget.throttleImminent()).toBe(true);
  });

  it('is quiet at the usage a real full walk produced', () => {
    const budget = new RunBudget();
    budget.spend({
      callCount: 1,
      totalCputime: 1,
      totalTime: 1,
      estimatedTimeToRegainAccess: 0,
      raw: null,
    });
    expect(budget.throttleImminent()).toBe(false);
  });
});

describe('media sync', () => {
  it('walks to exhaustion and upserts idempotently', async () => {
    let call = 0;
    __setGraphFetchForTests(async () => {
      call += 1;
      if (call === 1) {
        return reply({
          data: [
            { id: 'm1', shortcode: 'A', media_type: 'IMAGE', timestamp: '2026-08-01T00:00:00Z' },
          ],
          paging: { cursors: { after: 'C1' }, next: 'https://…' },
        });
      }
      return reply({
        data: [
          {
            id: 'm2',
            shortcode: 'B',
            media_type: 'CAROUSEL_ALBUM',
            timestamp: '2026-08-02T00:00:00Z',
          },
        ],
      });
    });

    const first = await syncMedia(accountId, 'IG1', new RunBudget());
    expect(first.done).toBe(true);
    expect(await db().select().from(posts).where(eq(posts.accountId, accountId))).toHaveLength(2);

    // Re-running must not duplicate. The daily sync re-walks constantly.
    call = 0;
    await syncMedia(accountId, 'IG1', new RunBudget());
    expect(await db().select().from(posts).where(eq(posts.accountId, accountId))).toHaveLength(2);
  });

  it('stops at posts it already holds instead of re-walking the whole edge', async () => {
    // THE REGRESSION. beginRun only resumes a run still marked `running`, so a
    // COMPLETED walk means the next tick starts a fresh one at cursor null and
    // reads the entire edge again. In production that ran twelve times in a
    // row at ~95 posts each, ate the request budget, and starved the backfill
    // behind it — the sync spent 35 minutes making almost no progress.
    let pagesServed = 0;
    __setGraphFetchForTests(async () => {
      pagesServed += 1;
      return reply({
        data: [
          { id: 'm1', shortcode: 'A' },
          { id: 'm2', shortcode: 'B' },
        ],
        paging: { cursors: { after: 'C1' }, next: 'https://…' },
      });
    });

    // First walk: everything is new, so it follows the cursor.
    await syncMedia(accountId, 'IG1', new RunBudget({ maxRequests: 3 }));
    const firstPass = pagesServed;
    expect(firstPass).toBeGreaterThan(1);

    // Second walk: page one is entirely known, so it stops there.
    pagesServed = 0;
    const second = await syncMedia(accountId, 'IG1', new RunBudget());
    expect(second.done).toBe(true);
    expect(pagesServed).toBe(1);
    expect(second.stats.stoppedAt).toBe('known posts');
  });

  it('hands back an unfinished walk with its cursor instead of restarting', async () => {
    __setGraphFetchForTests(async () =>
      reply({
        data: [{ id: `m${Math.random()}`, shortcode: `S${Math.random()}` }],
        paging: { cursors: { after: 'NEXT' }, next: 'https://…' },
      }),
    );
    const result = await syncMedia(accountId, 'IG1', new RunBudget({ maxRequests: 2 }));
    expect(result.done).toBe(false);
    expect(result.cursor).toBe('NEXT');
  });
});

describe('backfill', () => {
  beforeEach(async () => {
    await db()
      .insert(posts)
      .values({
        accountId,
        igMediaId: 'old1',
        shortcode: 'OLD',
        mediaType: 'carousel',
        publishedAt: new Date('2021-06-04T00:00:00Z'),
      });
  });

  it('writes latest, and never_sampled for the checkpoints that can never exist', async () => {
    __setGraphFetchForTests(async () =>
      reply({ data: [{ name: 'reach', values: [{ value: 128 }] }] }),
    );

    const result = await backfillPostInsights(accountId, new RunBudget());
    expect(result.done).toBe(true);

    const rows = await db()
      .select()
      .from(postInsights)
      .where(eq(postInsights.accountId, accountId));
    const latest = rows.find((r) => r.checkpoint === 'latest');
    expect(latest?.reach).toBe(128);
    // Never zero for a metric Meta omitted.
    expect(latest?.saved).toBeNull();
    expect(latest?.unavailable?.saved).toBe('declined_by_meta');

    const t48 = rows.find((r) => r.checkpoint === 't48');
    expect(t48?.unavailable?.all).toBe('never_sampled');
  });

  it('survives published_at arriving as a string from a raw query', async () => {
    // A raw execute() returns timestamps unparsed, so published_at is a STRING
    // and .getTime() throws on it. The previous build hit this twice in two
    // modules and both times it was a runtime crash, not a type error.
    __setGraphFetchForTests(async () =>
      reply({ data: [{ name: 'reach', values: [{ value: 5 }] }] }),
    );
    await expect(backfillPostInsights(accountId, new RunBudget())).resolves.toMatchObject({
      done: true,
    });
    const rows = await db()
      .select()
      .from(postInsights)
      .where(eq(postInsights.accountId, accountId));
    expect(rows.some((r) => r.checkpoint === 't24' && r.unavailable?.all === 'never_sampled')).toBe(
      true,
    );
  });

  it('runs once — a second call is a no-op rather than a second walk', async () => {
    __setGraphFetchForTests(async () => reply({ data: [] }));
    await backfillPostInsights(accountId, new RunBudget());
    const second = await backfillPostInsights(accountId, new RunBudget());
    expect(second.stats.skipped).toBe('already completed');
  });
});

describe('account_daily resumption', () => {
  it('converges when Meta has no data, instead of asking forever', async () => {
    // THE REGRESSION. The first version skipped a metric only when a number was
    // already stored, so any day Meta has nothing for was re-requested on every
    // tick — 360 requests against a 120-request budget, never finishing. It ran
    // for 32 minutes in production before anyone noticed.
    //
    // "Fetched" and "has a value" are different facts. A null answer is a
    // COMPLETED fetch.
    __setGraphFetchForTests(
      async (input) =>
        String(input).includes('metric_type=total_value')
          ? reply({ data: [{ total_value: {} }] }) // accepted, no value
          : reply({ data: [{ values: [] }] }), // no series either
    );

    let ticks = 0;
    let done = false;
    while (!done && ticks < 30) {
      ticks += 1;
      const result = await syncAccountDaily(accountId, 'IG1', new RunBudget({ maxRequests: 40 }), {
        backfill: true,
        now: new Date('2026-08-26T12:00:00Z'),
      });
      done = result.done;
    }

    expect(done).toBe(true);
    expect(ticks).toBeLessThan(30);
  });

  it('records a reason when a metric returns nothing, so it is never re-asked', async () => {
    __setGraphFetchForTests(async () => reply({ data: [{ total_value: {} }] }));
    await syncAccountDaily(accountId, 'IG1', new RunBudget(), {
      backfill: false,
      now: new Date('2026-08-26T12:00:00Z'),
    });

    const rows = await db()
      .select()
      .from(accountDaily)
      .where(eq(accountDaily.accountId, accountId));
    const row = rows[0];
    expect(row?.views).toBeNull();
    // Attempted, and Meta had nothing. Distinct from never having asked.
    expect(row?.unavailable?.views).toBe('declined_by_meta');
  });

  it('runs the historical pass once', async () => {
    __setGraphFetchForTests(async () => reply({ data: [{ values: [] }] }));
    // It takes several ticks — 90 days of four metrics each against a bounded
    // budget is the point of the design, not an accident.
    let done = false;
    for (let i = 0; i < 30 && !done; i += 1) {
      done = (await syncAccountDaily(accountId, 'IG1', new RunBudget(), { backfill: true })).done;
    }
    expect(done).toBe(true);

    const second = await syncAccountDaily(accountId, 'IG1', new RunBudget(), { backfill: true });
    expect(second.stats.skipped).toBe('already completed');
  });
});

describe('account_daily', () => {
  it('stores a metric per day without a default of zero', async () => {
    await db().insert(accountDaily).values({ accountId, day: '2026-08-20', reach: 100 });
    const [row] = await db()
      .select()
      .from(accountDaily)
      .where(eq(accountDaily.accountId, accountId));
    expect(row?.reach).toBe(100);
    // The four expensive metrics were never requested for this day. They must
    // read as unknown, not as zero.
    expect(row?.views).toBeNull();
    expect(row?.profileViews).toBeNull();
  });
});
