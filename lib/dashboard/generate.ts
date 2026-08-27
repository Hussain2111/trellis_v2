import { generateObject } from 'ai';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { insightBatches, insightCards } from '../db/schema';
import { asQuotaError, checkHeadroom, quotaCaps, resolveModel } from '../model/provider';
import { callsLastMinute, callsToday, oldestCallInWindow } from '../chat/threads';
import { modelRuns } from '../db/schema';
import { validateClaims } from '../validate/numbers';
import { buildCardPayload } from './payload';
import { postsByIds, type NamedPost } from '../chat/queries';

/**
 * SQL computes → the model interprets → code validates → the result is cached.
 *
 * Never generated on page load: that would burn the rate limit and be slow.
 * Generated on a schedule, or on an explicit refresh, and read from the
 * database thereafter.
 */

const cardSchema = z.object({
  cards: z
    .array(
      z.object({
        body: z
          .string()
          .min(20)
          .max(320)
          .describe('One opportunity, in plain language. Something they could act on.'),
        citedPostIds: z.array(z.number().int()).default([]),
      }),
    )
    .min(1)
    .max(6),
});

const SYSTEM = [
  'You write short, specific notes for an Instagram creator about their own account.',
  'They are not an analyst. They will read this on a phone, between other things.',
  '',
  'Each note is an OPPORTUNITY — something they could do — not a metric readout.',
  '"Your carousels reach 40% more people than your reels, but you post half as many"',
  'is a note. "Your reach was 3,961" is not.',
  '',
  'HOW TO WRITE ONE:',
  '- Lead with the thing to do, then the evidence for it. Not the other way round.',
  '- Plain words for measures: "accounts reached", "saves", "people who engaged".',
  '  Never the raw field names, and never a word they would have to look up.',
  '- NEVER refer to a post by a number or an id. "Post 94" means nothing to them —',
  '  it is a row number in a database they have never seen. Say WHEN it went up and',
  '  WHAT it was about: "your March carousel on double cleansing". Put the ids in',
  '  citedPostIds instead; they are shown as links to the real posts.',
  '- Say what the comparison is against. "Better than your usual" needs a "usual".',
  '',
  'HARD RULES:',
  '- Every number you write must appear in the data you were given. Do not compute,',
  '  do not round beyond one decimal, do not estimate. A number that is not in the',
  '  data will be deleted before anyone sees it.',
  '- Views, interactions and accounts-engaged were redefined by Instagram recently.',
  '  Do not draw trends through them across long periods.',
  '- Reach counts unique accounts. Never add it up across days.',
  '',
  'WRITE FEWER NOTES IF THE DATA ONLY SUPPORTS FEWER. Four real notes are better',
  'than six with two padded. There is no requirement to fill space.',
].join('\n');

export interface GenerateResult {
  batchId: number | null;
  kept: number;
  dropped: number;
  reason?: string;
  /** Set when the provider or the ledger said to wait rather than to stop. */
  retryAfterSeconds?: number;
}

export async function generateInsightCards(accountId: number): Promise<GenerateResult> {
  const built = await buildCardPayload(accountId);

  if (!built.ok || !built.payload) {
    const [batch] = await db()
      .insert(insightBatches)
      .values({
        accountId,
        status: 'fallback',
        reason: built.reason,
        cardsRequested: 0,
        cardsKept: 0,
      })
      .returning();
    return { batchId: batch!.id, kept: 0, dropped: 0, reason: built.reason };
  }

  // This path used to call the model without asking the ledger and without
  // recording that it had. Two consequences, both bad: the reservation held
  // back for card generation was measured against a counter that never moved,
  // and a refresh could spend the per-minute allowance out from under the chat
  // with nothing to show for it afterwards.
  const caps = quotaCaps();
  const headroom = await checkHeadroom(
    'cards',
    { callsToday, callsLastMinute, oldestCallInWindow },
    caps,
  );
  if (!headroom.allowed) {
    const [batch] = await db()
      .insert(insightBatches)
      .values({
        accountId,
        status: 'fallback',
        reason: headroom.reason,
        cardsRequested: 0,
        cardsKept: 0,
      })
      .returning();
    return {
      batchId: batch!.id,
      kept: 0,
      dropped: 0,
      reason: headroom.reason,
      retryAfterSeconds: headroom.retryAfterSeconds,
    };
  }

  const model = resolveModel();
  const started = Date.now();

  let generated: z.infer<typeof cardSchema>;
  try {
    const result = await generateObject({
      model: model.model,
      schema: cardSchema,
      system: SYSTEM,
      prompt: `Here is the account's data. Write 4 to 6 notes.\n\n${JSON.stringify(built.payload)}`,
      // Retrying a quota error spends more of the same quota on a call that
      // could not have succeeded. Handled by not doing it.
      maxRetries: 0,
      temperature: 0.5,
    });
    generated = result.object;

    await db()
      .insert(modelRuns)
      .values({
        accountId,
        purpose: 'cards',
        provider: model.provider,
        model: model.modelId,
        promptTokens: result.usage?.inputTokens ?? null,
        completionTokens: result.usage?.outputTokens ?? null,
        status: 'ok',
        calls: 1,
        durationMs: Date.now() - started,
      });
  } catch (error) {
    const quota = asQuotaError(error);

    await db()
      .insert(modelRuns)
      .values({
        accountId,
        purpose: 'cards',
        provider: model.provider,
        model: model.modelId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        // It reached the provider and counted against the limit there.
        calls: 1,
        durationMs: Date.now() - started,
      });

    const [batch] = await db()
      .insert(insightBatches)
      .values({
        accountId,
        status: 'fallback',
        reason: quota
          ? `the model is over its request limit; try again in about ${quota.retryAfterSeconds} seconds`
          : error instanceof Error
            ? error.message
            : 'generation failed',
        model: model.modelId,
      })
      .returning();
    return {
      batchId: batch!.id,
      kept: 0,
      dropped: 0,
      reason: quota ? 'over the request limit' : 'generation failed',
      retryAfterSeconds: quota?.retryAfterSeconds,
    };
  }

  // The guarantee. A card stating a figure the payload cannot support, or
  // citing a post the payload never mentioned, is dropped whole — showing
  // fewer cards is the correct outcome, not a degraded one.
  const { kept, dropped } = validateClaims(generated.cards, built.payload);

  const [batch] = await db()
    .insert(insightBatches)
    .values({
      accountId,
      status: kept.length > 0 ? 'ok' : 'fallback',
      reason:
        kept.length === 0
          ? 'every generated note stated a figure the data could not support'
          : null,
      model: model.modelId,
      cardsRequested: generated.cards.length,
      cardsKept: kept.length,
    })
    .returning();

  if (kept.length > 0) {
    await db()
      .insert(insightCards)
      .values(
        kept.map((card, index) => ({
          accountId,
          batchId: batch!.id,
          body: card.body,
          payload: built.payload as object,
          citedPostIds: card.citedPostIds,
          rank: index,
        })),
      );
  }

  return { batchId: batch!.id, kept: kept.length, dropped: dropped.length };
}

/**
 * The most recent batch's cards, for rendering. Never generates.
 *
 * One query for the batch, one for its cards, one to resolve the posts they
 * cite. It used to be three queries for the batch alone — including a read of
 * every batch ever generated, sorted in memory to find the newest — which is
 * the sort of thing that is free on day one and quietly is not later.
 */
export async function latestCards(accountId: number) {
  const [newest] = await db()
    .select()
    .from(insightBatches)
    .where(eq(insightBatches.accountId, accountId))
    .orderBy(desc(insightBatches.generatedAt))
    .limit(1);

  if (!newest) return { batch: null, cards: [] };

  const cards = await db()
    .select()
    .from(insightCards)
    .where(eq(insightCards.batchId, newest.id))
    .orderBy(insightCards.rank);

  // Resolved once for the whole batch rather than per card.
  const ids = [...new Set(cards.flatMap((card) => card.citedPostIds ?? []))];
  const posts = await postsByIds(accountId, ids);
  const byId = new Map(posts.map((post) => [post.id, post]));

  return {
    batch: newest,
    cards: cards.map((card) => ({
      ...card,
      citedPosts: (card.citedPostIds ?? [])
        .map((id) => byId.get(id))
        .filter((post): post is NamedPost => post !== undefined),
    })),
  };
}
