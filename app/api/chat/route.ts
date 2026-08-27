import { generateText, stepCountIs } from 'ai';
import { respond } from '@/lib/api/respond';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { modelRuns } from '@/lib/db/schema';
import { chatTools } from '@/lib/chat/tools';
import {
  appendMessage,
  buildSystemPrompt,
  callsLastMinute,
  callsToday,
  selfAccountId,
  findThread,
  threadMessages,
  titleThread,
} from '@/lib/chat/threads';
import {
  asQuotaError,
  checkHeadroom,
  maxStepsFor,
  quotaCaps,
  resolveModel,
} from '@/lib/model/provider';
import { stripUnbackedSentences } from '@/lib/validate/numbers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  threadId: z.number().int(),
  message: z.string().min(1).max(4000),
});

/**
 * Buffered, validated, then rendered — deliberately not streamed.
 *
 * The rule is that an unbacked figure is DROPPED, not caveated. You cannot
 * un-send a token, so streaming the answer text and validating afterwards would
 * mean either showing a wrong number briefly or retracting it visibly. Both
 * defeat the point. Tool progress could stream; the answer cannot.
 */
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });
    const { threadId, message } = parsed.data;

    const accountId = await selfAccountId();
    if (!accountId) {
      return Response.json(
        { error: 'no_account', message: 'No account is set up yet. Run the sync first.' },
        { status: 409 },
      );
    }

    // Read off the thread row, not off the request. Which note a conversation
    // came from is a property of the conversation, and the client has no business
    // asserting it on every turn — and a thread id that belongs to nobody is
    // answered here rather than several queries later as a constraint violation.
    const thread = await findThread(accountId, threadId);
    if (!thread) {
      return Response.json(
        { error: 'no_thread', message: 'That conversation no longer exists.' },
        { status: 404 },
      );
    }
    const sourceCardId = thread.sourceCardId;

    await appendMessage({ threadId, role: 'user', content: message });
    const history = await threadMessages(threadId);
    // Titles the thread from the first thing the user says, and only if it has no
    // title — a thread opened from a note was already named after the note.
    if (history.filter((m) => m.role === 'user').length === 1) await titleThread(threadId, message);

    const caps = quotaCaps();
    const headroom = await checkHeadroom('chat', { callsToday, callsLastMinute }, caps);
    if (!headroom.allowed) {
      return Response.json(
        {
          error: 'quota',
          message: headroom.retryAfterSeconds
            ? `${headroom.reason} Try again in about ${headroom.retryAfterSeconds} seconds.`
            : headroom.reason,
          retryAfterSeconds: headroom.retryAfterSeconds,
        },
        {
          status: 429,
          ...(headroom.retryAfterSeconds
            ? { headers: { 'retry-after': String(headroom.retryAfterSeconds) } }
            : {}),
        },
      );
    }

    let model;
    try {
      model = resolveModel();
    } catch (error) {
      return Response.json(
        {
          error: 'model_unavailable',
          message: error instanceof Error ? error.message : 'no model',
        },
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
            ? [
                '',
                '',
                // The id is an instruction to the tool, never a name for the note.
                // Naming it in this sentence is what produced answers opening
                // "Dashboard note 1 (generated today) highlights…" — a preamble
                // about where the conversation started, in front of the answer
                // that was actually asked for.
                `This conversation was opened from a note on the dashboard. Call getInsightCard with cardId ${sourceCardId} before answering, so its figures come back as data you may restate.`,
                'Do NOT open with a preamble about the note, its number, or when it was generated. Answer the question that was asked. Mention the note only where it bears on the answer, and then as "the note you opened" — it has no number the reader can see.',
              ].join('\n')
            : ''),
        messages: history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        tools,
        // Every step is another provider request, so the ceiling is derived from
        // the per-minute limit rather than picked. A fixed 8 blew a 5-a-minute
        // budget from inside a single call, where no pre-flight check can reach.
        stopWhen: stepCountIs(maxStepsFor(caps)),
        // The SDK's default is three attempts. On a quota error that spends three
        // of the five requests a minute allows, on a call that could not have
        // succeeded — so retrying is handled here, by not doing it.
        maxRetries: 0,
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
          calls: result.steps.length,
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
      const quota = asQuotaError(error);

      await db()
        .insert(modelRuns)
        .values({
          accountId,
          purpose: 'chat',
          provider: model.provider,
          model: model.modelId,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          // A rejected call still reached the provider and still counted against
          // the limit. Recording it as zero would let the ledger drift below what
          // the provider is actually counting, which is how the guard gets
          // quietly overrun.
          calls: 1,
          durationMs: Date.now() - started,
        });

      // A quota error is not a failure of this app and clears by waiting. Saying
      // so — with the provider's own number for how long — is a different message
      // from "something went wrong", and the difference matters to whoever is
      // sitting in front of it.
      if (quota) {
        return Response.json(
          {
            error: 'quota',
            message: `The model is over its request limit for the moment. Try again in about ${quota.retryAfterSeconds} seconds.`,
            retryAfterSeconds: quota.retryAfterSeconds,
          },
          { status: 429, headers: { 'retry-after': String(quota.retryAfterSeconds) } },
        );
      }

      return Response.json(
        { error: 'failed', message: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  });
}
