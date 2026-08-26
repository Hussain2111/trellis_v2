import { generateObject } from 'ai';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { insightBatches, insightCards } from '../db/schema';
import { resolveModel } from '../model/provider';
import { validateClaims } from '../validate/numbers';
import { buildCardPayload } from './payload';

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
  '',
  'Each note is an OPPORTUNITY — something they could do — not a metric readout.',
  '"Your carousels reach 40% more people than your reels, but you post half as many"',
  'is a note. "Your reach was 3,961" is not.',
  '',
  'HARD RULES:',
  '- Every number you write must appear in the data you were given. Do not compute,',
  '  do not round beyond one decimal, do not estimate. A number that is not in the',
  '  data will be deleted before anyone sees it.',
  '- Cite the post ids a note is about, when it is about specific posts.',
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

  const model = resolveModel();

  let generated: z.infer<typeof cardSchema>;
  try {
    const result = await generateObject({
      model: model.model,
      schema: cardSchema,
      system: SYSTEM,
      prompt: `Here is the account's data. Write 4 to 6 notes.\n\n${JSON.stringify(built.payload)}`,
      temperature: 0.5,
    });
    generated = result.object;
  } catch (error) {
    const [batch] = await db()
      .insert(insightBatches)
      .values({
        accountId,
        status: 'fallback',
        reason: error instanceof Error ? error.message : 'generation failed',
        model: model.modelId,
      })
      .returning();
    return { batchId: batch!.id, kept: 0, dropped: 0, reason: 'generation failed' };
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

/** The most recent batch's cards, for rendering. Never generates. */
export async function latestCards(accountId: number) {
  const [batch] = await db()
    .select()
    .from(insightBatches)
    .where(eq(insightBatches.accountId, accountId))
    .orderBy(insightBatches.generatedAt)
    .limit(1);

  const batches = await db()
    .select()
    .from(insightBatches)
    .where(eq(insightBatches.accountId, accountId));
  const newest =
    batches.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())[0] ?? batch;

  if (!newest) return { batch: null, cards: [] };

  const cards = await db()
    .select()
    .from(insightCards)
    .where(eq(insightCards.batchId, newest.id))
    .orderBy(insightCards.rank);

  return { batch: newest, cards };
}
