import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { accounts, posts } from '../db/schema';
import { fetchMediaPage } from '../graph/media';
import type { RunBudget } from './budget';
import { beginRun, finishRun, saveCursor } from './state';

export interface UnitResult {
  done: boolean;
  cursor: string | null;
  stats: Record<string, unknown>;
}

/**
 * Walk the media edge and upsert.
 *
 * Terminated by pagination exhaustion, never by `media_count` — Meta's count
 * said 229 where the walk found 243, so a count-based completion check stops
 * fourteen posts short in a way that looks exactly like success.
 */
export async function syncMedia(
  accountId: number,
  igUserId: string,
  budget: RunBudget,
): Promise<UnitResult> {
  const state = await beginRun(accountId, 'media');
  let cursor = state.cursor;
  let seen = 0;
  let skipped = 0;
  let pages = 0;

  try {
    for (;;) {
      if (!budget.canSpend() || budget.throttleImminent()) {
        return { done: false, cursor, stats: { seen, skipped, pages, ...budget.stats } };
      }

      const page = await fetchMediaPage(igUserId, { after: cursor ?? undefined });
      budget.spend(page.usage);
      skipped += page.skipped;
      pages += 1;

      // Which of this page do we already hold? A page that is entirely known
      // means we have caught up with what changed since last time.
      const ids = page.media.map((m) => m.igMediaId);
      const known = new Set(
        ids.length === 0
          ? []
          : (
              await db()
                .select({ igMediaId: posts.igMediaId })
                .from(posts)
                .where(and(eq(posts.accountId, accountId), inArray(posts.igMediaId, ids)))
            ).map((r) => r.igMediaId),
      );
      const newOnPage = ids.filter((id) => !known.has(id)).length;

      for (const media of page.media) {
        await db()
          .insert(posts)
          .values({
            accountId,
            igMediaId: media.igMediaId,
            shortcode: media.shortcode,
            permalink: media.permalink,
            caption: media.caption,
            mediaType: media.mediaType,
            mediaProductType: media.mediaProductType,
            thumbnailUrl: media.thumbnailUrl,
            mediaUrl: media.mediaUrl,
            publishedAt: media.publishedAt,
            likeCount: media.likeCount,
            commentsCount: media.commentsCount,
            raw: media.raw as object,
          })
          .onConflictDoUpdate({
            target: [posts.accountId, posts.igMediaId],
            set: {
              caption: media.caption,
              permalink: media.permalink,
              thumbnailUrl: media.thumbnailUrl,
              mediaUrl: media.mediaUrl,
              likeCount: media.likeCount,
              commentsCount: media.commentsCount,
              raw: media.raw as object,
              updatedAt: new Date(),
            },
          });
        seen += 1;
      }

      // Written before the next page is fetched, so an interruption resumes
      // here rather than at the beginning.
      cursor = page.nextCursor;
      await saveCursor(state.runId, cursor);

      // STOP AT KNOWN. Without this the walk restarts from the top on every
      // tick — beginRun only resumes a run still marked `running`, so a
      // completed walk means the next tick creates a fresh one at cursor null
      // and re-reads the entire edge. In production that ran twelve times in a
      // row at ~95 posts each, consuming most of the request budget and
      // starving the backfill behind it.
      //
      // A page with nothing new on it means we have reached posts we already
      // hold. The first walk sees new items on every page and goes to the end;
      // every later walk stops after one page.
      if (cursor && newOnPage === 0) {
        const stats = { seen, skipped, pages, stoppedAt: 'known posts', ...budget.stats };
        await finishRun(state.runId, 'done', stats);
        await db()
          .update(accounts)
          .set({ lastSyncedAt: new Date() })
          .where(eq(accounts.id, accountId));
        return { done: true, cursor: null, stats };
      }

      if (!cursor) {
        const stats = { seen, skipped, pages, stoppedAt: 'exhausted', ...budget.stats };
        await finishRun(state.runId, 'done', stats);
        await db()
          .update(accounts)
          .set({ lastSyncedAt: new Date() })
          .where(eq(accounts.id, accountId));
        return { done: true, cursor: null, stats };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(state.runId, 'failed', { seen, skipped, pages, ...budget.stats }, message);
    throw error;
  }
}

/** Posts that have never had a `latest` insight row — the backfill's worklist. */
export async function postsMissingLatest(accountId: number, limit: number) {
  return db().execute<{ id: number; ig_media_id: string; published_at: Date | null }>(sql`
    select p.id, p.ig_media_id, p.published_at
    from posts p
    where p.account_id = ${accountId}
      and not exists (
        select 1 from post_insights i
        where i.post_id = p.id and i.checkpoint = 'latest'
      )
    order by p.published_at desc nulls last
    limit ${limit}
  `);
}
