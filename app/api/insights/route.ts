import { selfAccountId } from '@/lib/chat/threads';
import { generateInsightCards } from '@/lib/dashboard/generate';
import { cronAuthorised } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Generates a batch of insight cards.
 *
 * Called on a schedule, or by the refresh button. NEVER on page load — that
 * would burn the rate limit and make the dashboard slow for no benefit, since
 * the cards change once a day at most.
 *
 * The cron guard no-ops in development and permits the in-app refresh, which
 * is the same trust level as everything else in this single-user app.
 */
export async function POST(request: Request): Promise<Response> {
  const fromScheduler = request.headers.get('authorization');
  if (fromScheduler) {
    const auth = cronAuthorised(request);
    if (!auth.ok) return Response.json({ error: 'unauthorised' }, { status: auth.status });
  }

  const accountId = await selfAccountId();
  if (!accountId) return Response.json({ error: 'no_account' }, { status: 409 });

  try {
    const result = await generateInsightCards(accountId);
    // A wait is not a failure, and the refresh button should say which it got.
    return Response.json(result, {
      ...(result.retryAfterSeconds
        ? { status: 429, headers: { 'retry-after': String(result.retryAfterSeconds) } }
        : {}),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
