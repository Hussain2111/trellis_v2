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
import { beginRun, finishRun, hasCompleted, saveCursor } from './state';

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
      // Only touch `unavailable` when there is something to say. Writing an
      // empty map would erase reasons another metric just recorded.
      set: {
        ...patch,
        ...(unavailable && Object.keys(unavailable).length > 0 ? { unavailable } : {}),
      },
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
 *
 * RESUMPTION IS BY ATTEMPT, NOT BY VALUE. The first version skipped a metric
 * only when a number was already stored, which meant any day Meta has no data
 * for was re-requested on every tick — 360 requests against a 120-request
 * budget, never converging. "Fetched" and "has a value" are different facts,
 * and conflating them is the same blank-versus-unknown error this project
 * exists to avoid, wearing different clothes. A null result is a COMPLETED
 * fetch: it is recorded with a reason and never asked again.
 */
export async function syncAccountDaily(
  accountId: number,
  igUserId: string,
  budget: RunBudget,
  options: { backfill?: boolean; now?: Date } = {},
): Promise<UnitResult> {
  const backfill = options.backfill ?? false;
  const kind = backfill ? 'account_backfill' : 'account';

  // The historical pass runs once. The daily pass runs every day.
  if (backfill && (await hasCompleted(accountId, kind))) {
    return { done: true, cursor: null, stats: { skipped: 'already completed' } };
  }

  const state = await beginRun(accountId, kind);
  const now = options.now ?? new Date();
  const totalWindows = backfill ? BACKFILL_MAX_WINDOWS : 1;
  const totalDays = backfill ? BACKFILL_EXPENSIVE_DAYS : 1;

  // Cursor carries the phase and index, so a tick that runs out of budget
  // resumes mid-walk rather than restarting it.
  const resumed = parseCursor(state.cursor);
  let daysWritten = 0;
  let windowsWalked = 0;

  try {
    if (resumed.phase === 'windows') {
      for (let index = resumed.index; index < totalWindows; index += 1) {
        if (!budget.canSpend() || budget.throttleImminent()) {
          await saveCursor(state.runId, `w:${index}`);
          return {
            done: false,
            cursor: `w:${index}`,
            stats: { daysWritten, windowsWalked, ...budget.stats },
          };
        }

        const window = windowAt(now, index);
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
            // itself. A boundary, not an error.
            budget.spend();
          }
        }

        windowsWalked += 1;
        await saveCursor(state.runId, `w:${index + 1}`);

        // Nothing from either stable metric: we have walked past the end of
        // available history. Stop rather than spending the rest of the budget
        // on windows Meta will not serve.
        if (!sawAnything) break;
      }
      await saveCursor(state.runId, 'd:1');
    }

    const firstDay = resumed.phase === 'days' ? resumed.index : 1;
    for (let i = firstDay; i <= totalDays; i += 1) {
      if (!budget.canSpend() || budget.throttleImminent()) {
        await saveCursor(state.runId, `d:${i}`);
        return {
          done: false,
          cursor: `d:${i}`,
          stats: { daysWritten, windowsWalked, ...budget.stats },
        };
      }

      const dayStart = Math.floor((now.getTime() / 1000 - i * 86_400) / 86_400) * 86_400;
      const window = { since: dayStart, until: dayStart + 86_400 };
      const day = riyadhDayKey(new Date(dayStart * 1000));

      const [existing] = await db()
        .select()
        .from(accountDaily)
        .where(sql`${accountDaily.accountId} = ${accountId} and ${accountDaily.day} = ${day}`)
        .limit(1);

      // Accumulated across the metric loop, because `unavailable` is a single
      // jsonb column and the upsert REPLACES it. Reading `existing` once before
      // the loop and spreading it each time meant every metric overwrote the
      // previous one's reason, leaving only the last. Caught by a test that
      // asked for the first metric's reason by name.
      const reasons: UnavailableMap = { ...(existing?.unavailable ?? {}) };

      for (const metric of TOTAL_VALUE_METRICS) {
        const column = toColumn(metric);
        // Skip on ATTEMPTED, not on has-a-value. A stored reason means this was
        // already asked and Meta had nothing — asking again would loop forever.
        if (existing && wasAttempted(existing, column)) continue;
        if (!budget.canSpend()) break;

        try {
          const { value, usage } = await fetchAccountTotal(igUserId, metric, window);
          budget.spend(usage);
          if (value === null) {
            reasons[column] = 'declined_by_meta';
            await upsertDay(accountId, day, {}, reasons);
          } else {
            await upsertDay(accountId, day, { [column]: value }, reasons);
          }
        } catch {
          budget.spend();
          reasons[column] = 'declined_by_meta';
          await upsertDay(accountId, day, {}, reasons);
        }
      }
      daysWritten += 1;
      await saveCursor(state.runId, `d:${i + 1}`);
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

function windowAt(from: Date, index: number): { since: number; until: number } {
  const windows = [...backwardWindows(from, index + 1)];
  return windows[index]!;
}

function parseCursor(cursor: string | null): { phase: 'windows' | 'days'; index: number } {
  if (!cursor) return { phase: 'windows', index: 0 };
  const [phase, raw] = cursor.split(':');
  const index = Number(raw);
  if (phase === 'd' && Number.isFinite(index)) return { phase: 'days', index };
  if (phase === 'w' && Number.isFinite(index)) return { phase: 'windows', index };
  return { phase: 'windows', index: 0 };
}

/** Has this metric already been asked for on this day, whatever the answer was? */
function wasAttempted(
  row: { unavailable: UnavailableMap | null } & Record<string, unknown>,
  column: string,
): boolean {
  if (row[column] != null) return true;
  return Boolean(row.unavailable?.[column]);
}

function toColumn(metric: string): string {
  return metric.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
