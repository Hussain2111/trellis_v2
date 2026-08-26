/**
 * Refuse to run the test suite against anything that is not a local, disposable
 * database.
 *
 * The DB-backed tests begin with `truncate ... cascade`. Vitest loads `.env` so
 * that they find a local Postgres — but `.env` on a machine that also operates
 * this app points at PRODUCTION SUPABASE, and `npm test` there would silently
 * destroy every synced post and every day of follower history that can never be
 * re-fetched.
 *
 * This is not a hypothetical. It was one command away from happening.
 */
const url = process.env.DATABASE_URL ?? '';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'];

function isLocal(connectionString: string): boolean {
  if (!connectionString) return true; // falls through to the schema default, which is local
  try {
    const { hostname } = new URL(connectionString);
    return LOCAL_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}

if (!isLocal(url)) {
  const redacted = url.replace(/:[^:@]*@/, ':***@');
  throw new Error(
    [
      '',
      '  ┌──────────────────────────────────────────────────────────────────┐',
      '  │  REFUSING TO RUN TESTS AGAINST A NON-LOCAL DATABASE              │',
      '  └──────────────────────────────────────────────────────────────────┘',
      '',
      `  DATABASE_URL points at: ${redacted}`,
      '',
      '  These tests TRUNCATE tables. Against your Supabase project that would',
      '  destroy every synced post, and every day of follower history — which',
      '  Meta only serves for 30 days and can never be re-fetched.',
      '',
      '  Run them against a local Postgres instead:',
      '',
      '    DATABASE_URL=postgres://postgres:postgres@localhost:5432/trellis_test npm test',
      '',
      '  Or put that line in .env.test.local, which vitest loads and git ignores.',
      '',
    ].join('\n'),
  );
}
