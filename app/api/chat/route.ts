import { generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { modelRuns } from '@/lib/db/schema';
import { chatTools } from '@/lib/chat/tools';
import {
  appendMessage,
  buildSystemPrompt,
  callsToday,
  selfAccountId,
  threadMessages,
  titleThread,
} from '@/lib/chat/threads';
import { checkHeadroom, resolveModel } from '@/lib/model/provider';
import { stripUnbackedSentences } from '@/lib/validate/numbers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  threadId: z.number().int(),
  message: z.string().min(1).max(4000),
  /** Set when the thread was opened from a dashboard note. */
  sourceCardId: z.number().int().optional(),
});

const CAPS = { dailyCalls: 200, reservedForCards: 40 };

/**
 * Buffered, validated, then rendered — deliberately not streamed.
 *
 * The rule is that an unbacked figure is DROPPED, not caveated. You cannot
 * un-send a token, so streaming the answer text and validating afterwards would
 * mean either showing a wrong number briefly or retracting it visibly. Both
 * defeat the point. Tool progress could stream; the answer cannot.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });
  const { threadId, message, sourceCardId } = parsed.data;

  const accountId = await selfAccountId();
  if (!accountId) {
    return Response.json(
      { error: 'no_account', message: 'No account is set up yet. Run the sync first.' },
      { status: 409 },
    );
  }

  await appendMessage({ threadId, role: 'user', content: message });
  const history = await threadMessages(threadId);
  if (history.length === 1) await titleThread(threadId, message);

  const headroom = await checkHeadroom('chat', { callsToday }, CAPS);
  if (!headroom.allowed) {
    return Response.json({ error: 'quota', message: headroom.reason }, { status: 429 });
  }

  let model;
  try {
    model = resolveModel();
  } catch (error) {
    return Response.json(
      { error: 'model_unavailable', message: error instanceof Error ? error.message : 'no model' },
      { status: 503 },
    );
  }

  const started = Date.now();
  const tools = chatTools(accountId);

  try {
    const result = await generateText({
      model: model.model,
      system:
        (await buildSystemPrompt(accountId)) +
        (sourceCardId
          ? `\n\nThis conversation began from dashboard note ${sourceCardId}. Call getInsightCard with cardId ${sourceCardId} first, and say when it was generated rather than implying it is current.`
          : ''),
      messages: history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools,
      // A tool loop needs room, but not unbounded room — a runaway loop on a
      // rationed free tier is expensive in the only currency this app has.
      stopWhen: stepCountIs(8),
      temperature: 0.4,
    });

    // Everything the tools actually returned this turn. This — and only this —
    // is what the model's numbers are allowed to be drawn from.
    const evidence = result.steps.flatMap((step) =>
      step.toolResults.map((r) => (r as { output?: unknown }).output),
    );

    const { text, dropped } = stripUnbackedSentences(result.text, evidence);

    const answer =
      text.trim().length > 0
        ? text
        : "I can't back that up from your data — every figure I was about to give you came from somewhere other than a query, so I've dropped it rather than show you a number I can't stand behind.";

    await appendMessage({
      threadId,
      role: 'assistant',
      content: answer,
      toolCalls: result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)),
      validation: dropped.length > 0 ? { dropped } : null,
    });

    await db()
      .insert(modelRuns)
      .values({
        accountId,
        purpose: 'chat',
        provider: model.provider,
        model: model.modelId,
        promptTokens: result.usage?.inputTokens ?? null,
        completionTokens: result.usage?.outputTokens ?? null,
        status: 'ok',
        durationMs: Date.now() - started,
      });

    return Response.json({
      answer,
      // Surfaced rather than hidden: if the validator had to remove something,
      // that is worth knowing about the model, not just about the answer.
      dropped: dropped.length,
      toolsUsed: result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)),
    });
  } catch (error) {
    await db()
      .insert(modelRuns)
      .values({
        accountId,
        purpose: 'chat',
        provider: model.provider,
        model: model.modelId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
    return Response.json(
      { error: 'failed', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
