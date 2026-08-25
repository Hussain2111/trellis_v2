import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Migrations run through this script, never by pasting SQL into the Supabase
 * dashboard editor.
 *
 * The difference is not stylistic. Drizzle applies every pending migration
 * inside ONE transaction, so a guard that aborts a destructive step actually
 * prevents it. The dashboard editor autocommits each statement, so the same
 * guard raises *after* the destruction has already committed.
 *
 * Related trap, recorded because it cost a debugging session on the previous
 * build: seeding a scratch database by piping SQL through `psql` does not write
 * drizzle's `__drizzle_migrations` bookkeeping table, so the next run replays
 * from the beginning and dies on a CREATE TABLE that already exists. Apply the
 * first migration through this script instead.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

// NOTICEs like `schema "drizzle" already exists, skipping` are normal on any
// re-run, but postgres-js prints them as fat objects that read exactly like
// errors. Swallow that severity and let everything else through — a migration
// script whose happy path looks like a failure gets ignored when it really
// does fail.
const sql = postgres(url, {
  max: 1,
  prepare: false,
  onnotice: (notice) => {
    if (notice.severity !== 'NOTICE') console.warn(notice.message);
  },
});

try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  console.log('migrations applied');
} catch (error) {
  console.error('migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
