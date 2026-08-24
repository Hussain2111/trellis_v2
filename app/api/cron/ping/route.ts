import { cronAuthorised } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';

/**
 * The scheduler's end-to-end proof.
 *
 * It touches nothing. Its only job is to answer the Stage 1 question — can a
 * GitHub Actions runner reach this deployment and authenticate — separately
 * from the question of whether the database works. When the two are entangled
 * in one endpoint, a 500 tells you nothing about which half failed.
 *
 * Deployment Protection is what usually breaks this, with a 401 from Vercel's
 * own SSO rather than from the app.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = cronAuthorised(request);
  if (!auth.ok) return Response.json({ error: 'unauthorised' }, { status: auth.status });
  return Response.json({ ok: true, at: new Date().toISOString() });
}
