import { cronAuthorised } from '@/lib/cron/auth';
import { runSyncTick } from '@/lib/sync/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * One bounded tick. The caller loops until `done`.
 *
 * It never blocks longer than the function's ceiling — it returns and expects
 * to be called back, which is the only shape that fits a serverless host
 * without a queue.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = cronAuthorised(request);
  if (!auth.ok) return Response.json({ error: 'unauthorised' }, { status: auth.status });

  try {
    const result = await runSyncTick({ maxRequests: 120, maxMs: 45_000 });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { done: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
