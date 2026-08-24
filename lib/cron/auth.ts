import { env } from '../env';

/**
 * The only thing between a scheduled endpoint and the open internet.
 *
 * This app has no user authentication by design — it is a single-user tool at
 * an obscure URL. That makes CRON_SECRET load-bearing rather than incidental.
 * Vercel sends it automatically as a bearer token on its own cron invocations
 * when the project variable is set; the GitHub Actions schedules send the same
 * header from a repository secret.
 *
 * Unset in local development, the guard no-ops. Unset in production, it
 * refuses — an endpoint that advances real work must never be open because a
 * variable was forgotten.
 */
export function cronAuthorised(request: Request): { ok: true } | { ok: false; status: number } {
  const secret = env().CRON_SECRET;

  if (!secret) {
    if (env().NODE_ENV === 'production') return { ok: false, status: 503 };
    return { ok: true };
  }

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (presented.length !== secret.length) return { ok: false, status: 401 };

  // Constant-time-ish comparison. The lengths already matched, so this leaks
  // nothing further about the secret's content.
  let mismatch = 0;
  for (let i = 0; i < secret.length; i += 1) {
    mismatch |= presented.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return mismatch === 0 ? { ok: true } : { ok: false, status: 401 };
}
