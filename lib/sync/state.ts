import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { syncRuns } from '../db/schema';

export type SyncKind = 'account' | 'media' | 'post_insights' | 'comments' | 'backfill';

export interface SyncState {
  runId: number;
  cursor: string | null;
}

/**
 * Resume an unfinished run of this kind, or start a new one.
 *
 * The cursor is written BEFORE a page is processed, never after, so an
 * interruption — a rate limit, a function timeout, a deploy — resumes from the
 * right place instead of restarting the walk. Restarting a 243-post walk
 * because it died on post 200 is how a cheap operation becomes an expensive
 * one.
 */
export async function beginRun(accountId: number, kind: SyncKind): Promise<SyncState> {
  const [existing] = await db()
    .select()
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.accountId, accountId),
        eq(syncRuns.kind, kind),
        eq(syncRuns.status, 'running'),
      ),
    )
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  if (existing) return { runId: existing.id, cursor: existing.cursor };

  const [created] = await db()
    .insert(syncRuns)
    .values({ accountId, kind, status: 'running' })
    .returning();

  return { runId: created!.id, cursor: null };
}

export async function saveCursor(runId: number, cursor: string | null): Promise<void> {
  await db().update(syncRuns).set({ cursor }).where(eq(syncRuns.id, runId));
}

export async function finishRun(
  runId: number,
  status: 'done' | 'failed',
  stats: unknown,
  error?: string,
): Promise<void> {
  await db()
    .update(syncRuns)
    .set({ status, finishedAt: new Date(), stats: stats as object, error: error ?? null })
    .where(eq(syncRuns.id, runId));
}

/** Has a one-time operation of this kind already completed? */
export async function hasCompleted(accountId: number, kind: SyncKind): Promise<boolean> {
  const [row] = await db()
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(
      and(eq(syncRuns.accountId, accountId), eq(syncRuns.kind, kind), eq(syncRuns.status, 'done')),
    )
    .limit(1);
  return Boolean(row);
}
