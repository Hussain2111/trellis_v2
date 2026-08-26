import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { accountDaily, accounts } from '../db/schema';
import type { UnavailableMap } from '../db/unavailable';
import { SERIES_METRICS, TOTAL_VALUE_METRICS, backwardWindows, graphGet } from '../graph/client';
import { fetchAccountSeries, fetchAccountTotal } from '../graph/insights';
import { riyadhDayKey } from '../time';
import type { RunBudget } from './budget';
import { BACKFILL_EXPENSIVE_DAYS, BACKFILL_MAX_WINDOWS } from './config';
import type { UnitResult } from './media';
import { beginRun, finishRun } from './state';

/** Merge one metric into a day's row without disturbing the others. */
async function upsertDay(
  accountId: number,
  day: string,
  patch: Record<string, number | null>,
  unavailable?: UnavailableMap,
): Promise<void> {
  await db()
    .insert(accountDaily)
    .values({ accountId, day, ...patch, unavailable: unavailable ?? null })
    .onConflictDoUpdate({
      target: [accountDaily.accountId, accountDaily.day],
      set: { ...patch, ...(unavailable ? { unavailable } : {}) },
    });
}

export async function syncAccountProfile(
  accountId: number,
  igUserId: string,
  budget: RunBudget,
): Promise<void> {
  const { body, usage } = await graphGet<{
    username?: string;
    name?: string;
    biography?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
  }>(igUserId, { fields: 'username,name,biography,followers_count,follows_count,media_count' });
  budget.spend(usage);

  await db()
    .update(accounts)
    .set({
      handle: body.username ?? undefined,
      name: body.name ?? null,
      biography: body.biography ?? null,
      followersCount: body.followers_count ?? null,
      followsCount: body.follows_count ?? null,
      // Recorded for reference only. NEVER used as a completion check for the
      // media walk — it reported 229 against a real 243.
      mediaCount: body.media_count ?? null,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, accountId));
}

/**
 * Account metrics, day by day.
 *
 * Two shapes, two costs. `reach` and `follower_count` come back as a series, so
 * one request covers a 30-day window. The other four are one request PER DAY,
 * and they are also the metrics whose definitions Meta has moved — so they are
 * filled only for `BACKFILL_EXPENSIVE_DAYS`, and older days carry
 * `not_backfilled`, which is a different claim from Meta declining.
 *
 * History is walked by paging BACKWARDS in 30-day windows. Meta caps a
 * since/until range at 30 days per request; that is not a horizon, and `reach`
 * returns data at least 365 days back when asked this way.
 */
export async function syncAccountDaily(
  accountId: number,
  igUserId: string,
  budget: RunBudget,
  options: { backfill?: boolean; now?: Date } = {},
): Promise<UnitResult> {
  const state = await beginRun(accountId, 'account');
  const now = options.now ?? new Date();
  const windows = options.backfill ? BACKFILL_MAX_WINDOWS : 1;
  let daysWritten = 0;
  let windowsWalked = 0;

  try {
    for (const window of backwardWindows(now, windows)) {
      if (!budget.canSpend() || budget.throttleImminent()) {
        return {
          done: false,
          cursor: null,
          stats: { daysWritten, windowsWalked, ...budget.stats },
        };
      }

      let sawAnything = false;

      for (const metric of SERIES_METRICS) {
        if (!budget.canSpend()) break;
        try {
          const { points, usage } = await fetchAccountSeries(igUserId, metric, window);
          budget.spend(usage);
          for (const point of points) {
            await upsertDay(accountId, point.day, { [toColumn(metric)]: point.value });
            daysWritten += 1;
            sawAnything = true;
          }
        } catch {
          // A metric that stops returning is how the real horizon announces
          // itself. Not an error — a boundary.
          budget.spend();
        }
      }

      windowsWalked += 1;

      // Nothing came back for this window from either stable metric: we have
      // walked past the end of available history. Stop rather than burning the
      // remaining budget on windows Meta will not serve.
      if (!sawAnything) break;
    }

    // The expensive four, recent days only, one request per day.
    const expensiveDays = options.backfill ? BACKFILL_EXPENSIVE_DAYS : 1;
    for (let i = 1; i <= expensiveDays; i += 1) {
      if (!budget.canSpend() || budget.throttleImminent()) {
        return {
          done: false,
          cursor: null,
          stats: { daysWritten, windowsWalked, ...budget.stats },
        };
      }

      const dayStart = Math.floor((now.getTime() / 1000 - i * 86_400) / 86_400) * 86_400;
      const window = { since: dayStart, until: dayStart + 86_400 };
      const day = riyadhDayKey(new Date(dayStart * 1000));

      // Metric-level resumability: skip a metric already stored for this day,
      // so raising BACKFILL_EXPENSIVE_DAYS later fills only the gap.
      const [existing] = await db()
        .select()
        .from(accountDaily)
        .where(sql`${accountDaily.accountId} = ${accountId} and ${accountDaily.day} = ${day}`)
        .limit(1);

      for (const metric of TOTAL_VALUE_METRICS) {
        const column = toColumn(metric);
        if (existing && existing[column as keyof typeof existing] != null) continue;
        if (!budget.canSpend()) break;
        try {
          const { value, usage } = await fetchAccountTotal(igUserId, metric, window);
          budget.spend(usage);
          await upsertDay(accountId, day, { [column]: value });
        } catch {
          budget.spend();
          await upsertDay(accountId, day, {}, { [column]: 'declined_by_meta' });
        }
      }
      daysWritten += 1;
    }

    const stats = { daysWritten, windowsWalked, ...budget.stats };
    await finishRun(state.runId, 'done', stats);
    return { done: true, cursor: null, stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(
      state.runId,
      'failed',
      { daysWritten, windowsWalked, ...budget.stats },
      message,
    );
    throw error;
  }
}

function toColumn(metric: string): string {
  return metric.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
