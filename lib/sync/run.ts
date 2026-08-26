import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { accounts } from '../db/schema';
import { env } from '../env';
import { RunBudget } from './budget';
import { syncAccountDaily, syncAccountProfile } from './account';
import { backfillPostInsights, syncDueCheckpoints } from './insights';
import { syncMedia } from './media';

/**
 * One tick of work, bounded.
 *
 * Returns `{done}` rather than looping to completion, because nothing advances
 * work by itself on a serverless host and a function has a wall-clock ceiling.
 * The GitHub Actions runner calls this until `done` is true — that runner is
 * what is advancing the queue, and the answer is never "a browser tab".
 *
 * Units run in dependency order and each is independently resumable. The first
 * one that runs out of budget stops the tick; the next call resumes it.
 */
export type SyncStage = 'profile' | 'media' | 'backfill' | 'checkpoints' | 'account_daily';

export interface TickResult {
  done: boolean;
  stage: SyncStage | 'idle';
  stats: Record<string, unknown>;
}

export async function runSyncTick(
  options: { maxRequests?: number; maxMs?: number } = {},
): Promise<TickResult> {
  const igUserId = env().IG_USER_ID;
  if (!igUserId) return { done: true, stage: 'idle', stats: { reason: 'IG_USER_ID is not set' } };

  const [account] = await db()
    .select()
    .from(accounts)
    .where(eq(accounts.igUserId, igUserId))
    .limit(1);
  if (!account) {
    return { done: true, stage: 'idle', stats: { reason: 'no account row for IG_USER_ID' } };
  }

  const budget = new RunBudget(options);

  await syncAccountProfile(account.id, igUserId, budget);

  // Media first: everything downstream joins to posts.
  const media = await syncMedia(account.id, igUserId, budget);
  if (!media.done) return { done: false, stage: 'media', stats: media.stats };

  // The one-time historical pass, guarded so it runs once.
  const backfill = await backfillPostInsights(account.id, budget);
  if (!backfill.done) return { done: false, stage: 'backfill', stats: backfill.stats };

  // The forward-looking pass — the only thing that ever creates a curve.
  const checkpoints = await syncDueCheckpoints(account.id, budget);
  if (!checkpoints.done) return { done: false, stage: 'checkpoints', stats: checkpoints.stats };

  // The one-time historical pass, guarded like the post backfill.
  const history = await syncAccountDaily(account.id, igUserId, budget, { backfill: true });
  if (!history.done) return { done: false, stage: 'account_daily', stats: history.stats };

  // And yesterday, every day.
  const daily = await syncAccountDaily(account.id, igUserId, budget, { backfill: false });
  if (!daily.done) return { done: false, stage: 'account_daily', stats: daily.stats };

  return { done: true, stage: 'account_daily', stats: { ...daily.stats, media: media.stats } };
}
