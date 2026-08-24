import { cronAuthorised } from '@/lib/cron/auth';
import { db } from '@/lib/db/client';
import { heartbeats } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * Supabase Free pauses a project after roughly 7 days of inactivity, and a
 * paused project is indistinguishable from a broken one until you look. This
 * performs a real write rather than a read or a ping, because a read may be
 * served without waking anything.
 *
 * It is required infrastructure, not a nicety.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = cronAuthorised(request);
  if (!auth.ok) return Response.json({ error: 'unauthorised' }, { status: auth.status });

  try {
    await db().insert(heartbeats).values({ source: 'cron/keepalive' });
    return Response.json({ ok: true, at: new Date().toISOString() });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
