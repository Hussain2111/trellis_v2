import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { closeDb, db } from '../lib/db/client';
import { accounts } from '../lib/db/schema';
import { env } from '../lib/env';
import { graphGet } from '../lib/graph/client';
import { riyadhDayKey } from '../lib/time';
import { explainError, schemaHint } from './explain-error';

/**
 * One-time setup: create the account row the sync works against.
 *
 *   npm run setup:account
 *
 * Deliberately a script rather than something the sync does for itself. It is
 * the first thing in this project that touches the real Graph API and the real
 * database in the same breath, so it doubles as a first-contact check: if the
 * token is wrong, the scopes are short, or DATABASE_URL points somewhere
 * unexpected, this says so before a 243-post walk finds out the hard way.
 *
 * Safe to re-run. It upserts.
 */

async function main(): Promise<void> {
  const e = env();

  const missing: string[] = [];
  if (!e.IG_USER_ID) missing.push('IG_USER_ID');
  if (!e.IG_ACCESS_TOKEN) missing.push('IG_ACCESS_TOKEN');
  if (missing.length > 0) {
    console.error(`Missing ${missing.join(', ')} in your .env.`);
    process.exit(1);
  }

  console.log(`Database : ${e.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`);
  console.log(`Graph    : ${e.GRAPH_API_VERSION}`);
  console.log(`IG user  : ${e.IG_USER_ID}\n`);

  console.log('Fetching the profile…');
  const { body, usage } = await graphGet<{
    id?: string;
    username?: string;
    name?: string;
    biography?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
  }>(e.IG_USER_ID!, {
    fields: 'id,username,name,biography,followers_count,follows_count,media_count',
  });

  console.log(`  @${body.username ?? '?'} — ${body.name ?? 'no name'}`);
  console.log(
    `  followers ${body.followers_count ?? '—'} · following ${body.follows_count ?? '—'}`,
  );
  console.log(
    `  media_count reports ${body.media_count ?? '—'} (not a completion check — see docs/graph-api.md)`,
  );

  const [existing] = await db()
    .select()
    .from(accounts)
    .where(eq(accounts.igUserId, e.IG_USER_ID!))
    .limit(1);

  const values = {
    igUserId: e.IG_USER_ID!,
    handle: body.username ?? e.IG_HANDLE ?? 'unknown',
    name: body.name ?? null,
    biography: body.biography ?? null,
    followersCount: body.followers_count ?? null,
    followsCount: body.follows_count ?? null,
    mediaCount: body.media_count ?? null,
    updatedAt: new Date(),
  };

  if (existing) {
    await db().update(accounts).set(values).where(eq(accounts.id, existing.id));
    console.log(`\nUpdated account row #${existing.id}.`);
  } else {
    const [created] = await db().insert(accounts).values(values).returning();
    console.log(`\nCreated account row #${created!.id}.`);
  }

  if (usage.raw) console.log(`\nRate-limit usage: ${usage.raw.slice(0, 200)}`);

  // Task 2.10 is pure elapsed time and its clock does not start until this
  // number is written down somewhere durable.
  console.log('\n' + '─'.repeat(72));
  console.log('WRITE THIS DOWN — it starts the seven-day follows/unfollows check:');
  console.log('');
  console.log(`    ${riyadhDayKey(new Date())}   followers_count = ${body.followers_count ?? '—'}`);
  console.log('');
  console.log('  In seven days, record it again and re-run probe:account-insights.');
  console.log('  Until both predictions hold, follows/unfollows stay UNLABELLED.');
  console.log('─'.repeat(72));

  console.log('\nNext: run the Sync workflow (GitHub → Actions → Sync → Run workflow).');
}

try {
  await main();
} catch (error) {
  const detail = explainError(error);
  console.error(`\nFailed: ${detail}`);
  const hint = schemaHint(detail);
  if (hint) console.error(`\n  ${hint}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
