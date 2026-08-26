import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { postInsights, posts } from '../db/schema';
import type { UnavailableMap } from '../db/unavailable';
import { GraphError } from '../graph/client';
import { fetchPostInsights } from '../graph/insights';
import type { RunBudget } from './budget';
import { checkpointsDue, missingCheckpointReason, type Checkpoint } from './checkpoints';

/**
 * A raw `db().execute()` returns values unparsed — there is no column type for
 * postgres-js to infer from — so a timestamp arrives as a STRING and
 * `.getTime()` throws on it. The previous build hit this twice, in two
 * different modules, and both times it surfaced as a runtime crash rather than
 * a type error. Coerce at the boundary, once.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}
import type { UnitResult } from './media';
import { beginRun, finishRun, hasCompleted, saveCursor } from './state';

/**
 * Write one checkpoint's reading.
 *
 * Idempotent by construction: re-running overwrites the same (post,
 * checkpoint) row rather than accumulating duplicates, which is what lets the
 * backfill be re-entrant and the daily sync be safely re-invoked.
 */
async function writeInsight(
  accountId: number,
  postId: number,
  checkpoint: Checkpoint,
  values: Record<string, number | undefined>,
  unavailable: UnavailableMap,
): Promise<void> {
  const row = {
    accountId,
    postId,
    checkpoint,
    capturedAt: new Date(),
    // Every one of these is `?? null` and never `?? 0`. A zero written here is
    // indistinguishable downstream from a real measurement of zero.
    reach: values.reach ?? null,
    views: values.views ?? null,
    saved: values.saved ?? null,
    shares: values.shares ?? null,
    likes: values.likes ?? null,
    comments: values.comments ?? null,
    totalInteractions: values.total_interactions ?? null,
    unavailable: Object.keys(unavailable).length > 0 ? unavailable : null,
  };

  await db()
    .insert(postInsights)
    .values(row)
    .onConflictDoUpdate({
      target: [postInsights.postId, postInsights.checkpoint],
      set: { ...row },
    });
}

/**
 * The one-time historical pass.
 *
 * `latest` ONLY. It cannot produce t24/t48/t7d for a post published before
 * this app existed — that would have required sampling at that age — and
 * synthesising one from a lifetime total would be inventing a measurement.
 * Those checkpoints are written with `never_sampled` instead, which is a
 * different claim from zero, from "too new", and from Meta declining.
 *
 * Guarded so it runs once. A backfill that re-runs is a rate-limit incident
 * waiting for a redeploy.
 */
export async function backfillPostInsights(
  accountId: number,
  budget: RunBudget,
): Promise<UnitResult> {
  if (await hasCompleted(accountId, 'backfill')) {
    return { done: true, cursor: null, stats: { skipped: 'already completed' } };
  }

  const state = await beginRun(accountId, 'backfill');
  let filled = 0;
  let unavailableCount = 0;

  try {
    for (;;) {
      if (!budget.canSpend() || budget.throttleImminent()) {
        return {
          done: false,
          cursor: state.cursor,
          stats: { filled, unavailableCount, ...budget.stats },
        };
      }

      // Metric-level resumability: the worklist is "posts with no latest row",
      // so an interrupted run picks up exactly where it stopped and a re-run
      // costs nothing.
      const batch = await db().execute<{
        id: number;
        ig_media_id: string;
        published_at: Date | null;
      }>(sql`
        select p.id, p.ig_media_id, p.published_at
        from posts p
        where p.account_id = ${accountId}
          and not exists (
            select 1 from post_insights i where i.post_id = p.id and i.checkpoint = 'latest'
          )
        order by p.published_at desc nulls last
        limit 25
      `);

      if (batch.length === 0) {
        const stats = { filled, unavailableCount, ...budget.stats };
        await finishRun(state.runId, 'done', stats);
        return { done: true, cursor: null, stats };
      }

      for (const post of batch) {
        if (!budget.canSpend()) {
          return {
            done: false,
            cursor: state.cursor,
            stats: { filled, unavailableCount, ...budget.stats },
          };
        }

        try {
          const result = await fetchPostInsights(post.ig_media_id);
          budget.spend(result.usage);
          await writeInsight(accountId, post.id, 'latest', result.values, result.unavailable);
          if (Object.keys(result.unavailable).length > 0) unavailableCount += 1;
        } catch (error) {
          // Retries are already exhausted inside the client. Record the reason
          // and move on — one stubborn post must not stall 242 others.
          budget.spend();
          const reason: UnavailableMap[string] =
            error instanceof GraphError && error.isTransient
              ? 'transient_after_retries'
              : 'declined_by_meta';
          await writeInsight(accountId, post.id, 'latest', {}, { all: reason });
          unavailableCount += 1;
        }

        // The checkpoints this post can never have. Written once, explicitly,
        // rather than inferred later from a missing row.
        const publishedAt = toDate(post.published_at);
        if (publishedAt) {
          for (const checkpoint of ['t24', 't48', 't7d'] as const) {
            const reason = missingCheckpointReason(checkpoint, publishedAt);
            if (reason) await writeInsight(accountId, post.id, checkpoint, {}, { all: reason });
          }
        }

        filled += 1;
        await saveCursor(state.runId, String(post.id));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(state.runId, 'failed', { filled, unavailableCount, ...budget.stats }, message);
    throw error;
  }
}

/**
 * The forward-looking pass — the only thing that ever creates a real curve.
 *
 * Every post published after go-live gets sampled at t24, t48 and t7d as it
 * ages through each window. This is what makes "still climbing after 48 hours"
 * answerable at all, and only for posts this app was running for.
 */
export async function syncDueCheckpoints(
  accountId: number,
  budget: RunBudget,
  now: Date = new Date(),
): Promise<UnitResult> {
  const state = await beginRun(accountId, 'post_insights');
  let written = 0;

  const recent = await db()
    .select({ id: posts.id, igMediaId: posts.igMediaId, publishedAt: posts.publishedAt })
    .from(posts)
    .where(
      and(eq(posts.accountId, accountId), sql`${posts.publishedAt} > now() - interval '10 days'`),
    )
    .orderBy(sql`${posts.publishedAt} desc`);

  try {
    for (const post of recent) {
      if (!post.publishedAt) continue;
      if (!budget.canSpend() || budget.throttleImminent()) {
        return { done: false, cursor: null, stats: { written, ...budget.stats } };
      }

      const due = checkpointsDue(post.publishedAt, now);
      const result = await fetchPostInsights(post.igMediaId);
      budget.spend(result.usage);

      for (const checkpoint of due) {
        await writeInsight(accountId, post.id, checkpoint, result.values, result.unavailable);
        written += 1;
      }
    }

    const stats = { written, ...budget.stats };
    await finishRun(state.runId, 'done', stats);
    return { done: true, cursor: null, stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(state.runId, 'failed', { written, ...budget.stats }, message);
    throw error;
  }
}
