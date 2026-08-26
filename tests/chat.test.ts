import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, db } from '../lib/db/client';
import {
  accountDaily,
  accounts,
  insightBatches,
  insightCards,
  postInsights,
  posts,
} from '../lib/db/schema';
import { stripUnbackedSentences } from '../lib/validate/numbers';
import { chatTools } from '../lib/chat/tools';
import {
  accountOverview,
  followerSeries,
  formatBreakdown,
  insightCard,
  postPerformance,
  postsByIds,
  postsRanked,
  trailingMedian,
} from '../lib/chat/queries';
import { createThreadFromCard, threadMessages } from '../lib/chat/threads';

let accountId: number;

/**
 * Seeded to look like the real account after its first sync: a deep archive
 * whose posts have only a `latest` reading, plus one recent post that has been
 * measured over time. That difference is the whole point of the surface.
 */
beforeEach(async () => {
  await db().execute(sql`truncate accounts restart identity cascade`);
  const [account] = await db()
    .insert(accounts)
    .values({ igUserId: 'IG1', handle: 'glowithuzma', followersCount: 4876 })
    .returning();
  accountId = account!.id;

  const seed: [string, string, number][] = [
    ['carousel', '2024-01-01', 300],
    ['carousel', '2024-02-01', 400],
    ['carousel', '2024-03-01', 500],
    ['carousel', '2024-04-01', 600],
    ['carousel', '2024-05-01', 700],
    ['reel', '2024-06-01', 900],
    ['reel', '2024-07-01', 1000],
    ['reel', '2024-08-01', 1100],
    ['reel', '2024-09-01', 1200],
    ['reel', '2024-10-01', 1300],
    ['image', '2024-11-01', 200],
  ];

  for (const [format, day, reach] of seed) {
    const [post] = await db()
      .insert(posts)
      .values({
        accountId,
        igMediaId: `m-${format}-${day}`,
        shortcode: `S${day}`,
        permalink: `https://instagram.com/p/S${day}`,
        mediaType: format,
        publishedAt: new Date(`${day}T00:00:00Z`),
      })
      .returning();

    await db()
      .insert(postInsights)
      .values({ accountId, postId: post!.id, checkpoint: 'latest', reach, saved: reach / 100 });
    // Old posts can never have a timed reading.
    await db()
      .insert(postInsights)
      .values({
        accountId,
        postId: post!.id,
        checkpoint: 't48',
        unavailable: { all: 'never_sampled' },
      });
  }
});

afterAll(async () => {
  await closeDb();
});

describe('what the chat can state', () => {
  it('reports coverage rather than implying everything is measured', async () => {
    const overview = await accountOverview(accountId);
    expect(overview.coverage.posts).toBe(11);
    expect(overview.coverage.postsWithInsights).toBe(11);
    expect(overview.note).toMatch(/30/);
  });

  it('computes a median in SQL, with the sample it used', async () => {
    const result = await trailingMedian(accountId, 'reach', { format: 'reel' });
    expect(result.median).toBe(1100);
    expect(result.sampleSize).toBe(5);
  });

  it('ranks posts and hands back permalinks so a claim is checkable', async () => {
    const ranked = await postsRanked(accountId, 'reach', { limit: 3 });
    expect(ranked.posts[0]?.value).toBe(1300);
    expect(ranked.posts[0]?.permalink).toContain('instagram.com');
    expect(ranked.sampleSize).toBe(11);
  });

  it('compares formats when the samples support it', async () => {
    const result = await formatBreakdown(accountId, 'reach', { minSample: 5 });
    expect(result.comparable).toBe(true);
    // image has one post and is excluded rather than silently averaged in.
    expect(result.formats?.map((f) => f.format).sort()).toEqual(['carousel', 'reel']);
  });

  it('refuses a comparison the sample cannot support, instead of caveating one', async () => {
    const result = await formatBreakdown(accountId, 'reach', { minSample: 6 });
    expect(result.comparable).toBe(false);
    expect(result.refusal).toMatch(/would not mean anything|nothing to compare/);
  });
});

describe('the distinction the whole surface turns on', () => {
  it('says a pre-measurement post was never measured, not that it scored zero', async () => {
    const [post] = await db().select().from(posts).limit(1);
    const result = await postPerformance(accountId, post!.id);

    expect(result.found).toBe(true);
    if (!result.found) return;

    expect(result.hasCurve).toBe(false);
    expect(result.curveNote).toMatch(/never recorded/);
    // Not zero. Not "Meta declined". Nobody measured, and nobody can now.
    const t48 = result.checkpoints.find((c) => c.checkpoint === 't48');
    expect(t48?.reach).toBeNull();
    expect(t48?.missing).toBe('never_sampled');
  });

  it('reports a real curve when one was actually sampled', async () => {
    const [post] = await db().select().from(posts).limit(1);
    await db()
      .insert(postInsights)
      .values({ accountId, postId: post!.id, checkpoint: 't24', reach: 120 });

    const result = await postPerformance(accountId, post!.id);
    if (!result.found) throw new Error('seed failed');
    expect(result.hasCurve).toBe(true);
    expect(result.curveNote).toMatch(/moved over time/);
  });
});

describe('follower series', () => {
  it('returns a gap as null with a reason, never as zero', async () => {
    await db()
      .insert(accountDaily)
      .values([
        { accountId, day: '2026-08-24', followerCount: 4870 },
        { accountId, day: '2026-08-25', unavailable: { follower_count: 'declined_by_meta' } },
        { accountId, day: '2026-08-26', followerCount: 4876 },
      ]);

    const series = await followerSeries(accountId, 10);
    expect(series.days).toBe(3);
    expect(series.measured).toBe(2);
    const gap = series.points.find((p) => p.day === '2026-08-25');
    expect(gap?.value).toBeNull();
    expect(gap?.missing).toBe('declined_by_meta');
  });
});

describe('the guarantee, against real tool output', () => {
  /**
   * The end-to-end shape of the promise: the model answers, the answer is
   * checked against what the tools ACTUALLY returned this turn, and any figure
   * that is not in there is removed rather than softened.
   */
  async function evidenceFrom(toolName: 'getTrailingMedian' | 'getPostsRanked') {
    const tools = chatTools(accountId);
    // The SDK's execute signature carries call metadata the tool never reads.
    // Calling through the real tool rather than the query underneath it is the
    // point — it proves the wiring the model will actually use.
    const options = { toolCallId: 't', messages: [] } as never;
    const output =
      toolName === 'getTrailingMedian'
        ? await tools.getTrailingMedian.execute!({ metric: 'reach', format: 'reel' }, options)
        : await tools.getPostsRanked.execute!({ metric: 'reach', limit: 3 }, options);
    return [output];
  }

  it('keeps a figure the tool returned', async () => {
    const evidence = await evidenceFrom('getTrailingMedian');
    const { text, dropped } = stripUnbackedSentences(
      'Your reels sit at a median reach of 1100 across 5 measured posts.',
      evidence,
    );
    expect(dropped).toHaveLength(0);
    expect(text).toContain('1100');
  });

  it('drops a plausible figure the tool did not return', async () => {
    const evidence = await evidenceFrom('getTrailingMedian');
    const { text, dropped } = stripUnbackedSentences(
      'Your reels sit at a median reach of 1100. Carousels average 850, well behind.',
      evidence,
    );
    // 850 is entirely invented. It is removed, not hedged — a wrong number with
    // a caveat in front of it is still a wrong number.
    expect(dropped[0]?.figures).toContain(850);
    expect(text).toContain('1100');
    expect(text).not.toContain('850');
  });

  it('does not let a post id launder itself into a statistic', async () => {
    const evidence = await evidenceFrom('getPostsRanked');
    const [{ posts: ranked }] = evidence as unknown as [{ posts: { id: number }[] }];
    const anId = ranked[0]!.id;
    const { dropped } = stripUnbackedSentences(
      `Engagement climbed ${anId + 1000} percent last month.`,
      evidence,
    );
    expect(dropped).toHaveLength(1);
  });
});

/**
 * The seam between the dashboard and the chat, which had never once worked.
 *
 * `getInsightCard` selected `generated_at` from `insight_cards` — a column that
 * lives on `insight_batches`. Every call threw, so clicking a note reached a
 * tool that could only error. The build was green, the types were fine, and
 * nothing here exercised it. It surfaced from opening the page.
 */
describe('the card to chat contract', () => {
  async function seedCard() {
    const [post] = await db().select().from(posts).limit(1);
    const [batch] = await db()
      .insert(insightBatches)
      .values({ accountId, status: 'ok', cardsRequested: 1, cardsKept: 1 })
      .returning();
    const [card] = await db()
      .insert(insightCards)
      .values({
        accountId,
        batchId: batch!.id,
        body: 'Your carousels reach fewer people than your reels.',
        payload: { medianReach: 700 },
        citedPostIds: [post!.id],
        rank: 0,
      })
      .returning();
    return { card: card!, post: post! };
  }

  it('resolves a card, with the batch it was generated in', async () => {
    const { card } = await seedCard();
    const resolved = await insightCard(accountId, card.id);

    expect(resolved.found).toBe(true);
    if (!resolved.found) return;
    expect(resolved.body).toBe('Your carousels reach fewer people than your reels.');
    expect(resolved.evidence).toEqual({ medianReach: 700 });
    expect(resolved.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(resolved.freshness).toBe('generated today');
  });

  it('answers found:false rather than throwing for a card that is not there', async () => {
    expect((await insightCard(accountId, 9999)).found).toBe(false);
  });

  it('will not resolve another account’s card', async () => {
    const { card } = await seedCard();
    const [other] = await db()
      .insert(accounts)
      .values({ igUserId: 'IG2', handle: 'someone-else' })
      .returning();
    expect((await insightCard(other!.id, card.id)).found).toBe(false);
  });

  it('opens a thread with the note already in it, as the assistant', async () => {
    const { card } = await seedCard();
    const thread = await createThreadFromCard(accountId, card.id);
    const history = await threadMessages(thread.id);

    expect(thread.sourceCardId).toBe(card.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.role).toBe('assistant');
    expect(history[0]?.content).toContain('Your carousels reach fewer people');
    // The evidence does NOT cross over — only the note's own validated text.
    expect(history[0]?.content).not.toContain('medianReach');
  });
});

describe('naming a post the way its author knows it', () => {
  it('returns date, format and caption for the ids a note cites', async () => {
    const all = await db().select().from(posts).limit(2);
    const named = await postsByIds(
      accountId,
      all.map((p) => p.id),
    );

    expect(named).toHaveLength(2);
    expect(named[0]?.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(named[0]?.format).toBeTruthy();
  });

  it('returns nothing for an empty list rather than every post', async () => {
    expect(await postsByIds(accountId, [])).toEqual([]);
  });

  it('will not return another account’s posts', async () => {
    const all = await db().select().from(posts).limit(2);
    const [other] = await db()
      .insert(accounts)
      .values({ igUserId: 'IG3', handle: 'someone-else' })
      .returning();
    expect(
      await postsByIds(
        other!.id,
        all.map((p) => p.id),
      ),
    ).toEqual([]);
  });
});
