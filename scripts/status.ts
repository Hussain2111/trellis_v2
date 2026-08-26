import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { closeDb, db } from '../lib/db/client';
import { env } from '../lib/env';
import { explainError, schemaHint } from './explain-error';

/**
 * What is actually in the database.
 *
 *   npm run status
 *
 * Read-only. Written to answer "what did I get" after a sync, and to make the
 * answer specific — counts, coverage, date ranges, and the reasons behind every
 * gap, rather than a number that could mean anything.
 */

function heading(text: string): void {
  console.log(`\n${text}\n${'─'.repeat(Math.max(text.length, 60))}`);
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db().execute(query)) as unknown as T[];
}

async function main(): Promise<void> {
  console.log(`Database : ${env().DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`);

  heading('Account');
  const accounts = await rows<{
    id: number;
    handle: string;
    followers_count: number | null;
    media_count: number | null;
    last_synced_at: Date | string | null;
  }>(sql`select id, handle, followers_count, media_count, last_synced_at from accounts`);

  if (accounts.length === 0) {
    console.log('  none — run `npm run setup:account` first.');
    return;
  }
  for (const a of accounts) {
    console.log(
      `  #${a.id} @${a.handle} · ${a.followers_count ?? '—'} followers · Meta says ${a.media_count ?? '—'} media`,
    );
    console.log(`  last synced: ${a.last_synced_at ?? 'never'}`);
  }

  heading('Posts');
  const posts = await rows<{ media_type: string; n: number; oldest: string; newest: string }>(sql`
    select media_type, count(*)::int as n,
           min(published_at)::date::text as oldest,
           max(published_at)::date::text as newest
    from posts group by media_type order by n desc
  `);
  const totalPosts = posts.reduce((sum, p) => sum + p.n, 0);
  console.log(`  ${totalPosts} total`);
  for (const p of posts) {
    console.log(
      `    ${p.media_type.padEnd(10)} ${String(p.n).padStart(4)}   ${p.oldest} → ${p.newest}`,
    );
  }
  if (totalPosts === 0) console.log('    (the media walk has not run)');

  heading('Post insights — coverage');
  const checkpoints = await rows<{ checkpoint: string; n: number; with_reach: number }>(sql`
    select checkpoint, count(*)::int as n,
           count(reach)::int as with_reach
    from post_insights group by checkpoint order by checkpoint
  `);
  if (checkpoints.length === 0) {
    console.log('  none — the backfill has not run');
  }
  for (const c of checkpoints) {
    // `n` is rows written; `with_reach` is rows that carry a real number. The
    // gap between them is the honest coverage figure.
    console.log(
      `  ${c.checkpoint.padEnd(8)} ${String(c.n).padStart(4)} rows, ${c.with_reach} with a reach value`,
    );
  }

  const reasons = await rows<{ reason: string; n: number }>(sql`
    select value as reason, count(*)::int as n
    from post_insights, jsonb_each_text(coalesce(unavailable, '{}'::jsonb))
    group by value order by n desc
  `);
  if (reasons.length > 0) {
    console.log('\n  Why numbers are missing:');
    for (const r of reasons) console.log(`    ${r.reason.padEnd(24)} ${r.n}`);
  }

  heading('Account metrics — day by day');
  const daily = await rows<{
    days: number;
    oldest: string | null;
    newest: string | null;
    follower_count: number;
    reach: number;
    views: number;
    profile_views: number;
    accounts_engaged: number;
    total_interactions: number;
  }>(sql`
    select count(*)::int as days, min(day) as oldest, max(day) as newest,
           count(follower_count)::int as follower_count,
           count(reach)::int as reach,
           count(views)::int as views,
           count(profile_views)::int as profile_views,
           count(accounts_engaged)::int as accounts_engaged,
           count(total_interactions)::int as total_interactions
    from account_daily
  `);
  const d = daily[0];
  if (!d || d.days === 0) {
    console.log('  none — the account sync has not run');
  } else {
    console.log(`  ${d.days} days, ${d.oldest} → ${d.newest}\n`);
    console.log('  Days holding a real value, per metric:');
    for (const [label, n] of [
      ['follower_count', d.follower_count],
      ['reach', d.reach],
      ['views', d.views],
      ['profile_views', d.profile_views],
      ['accounts_engaged', d.accounts_engaged],
      ['total_interactions', d.total_interactions],
    ] as const) {
      const bar = '█'.repeat(Math.round((n / d.days) * 24)).padEnd(24, '·');
      console.log(`    ${label.padEnd(20)} ${bar} ${n}/${d.days}`);
    }
    console.log(
      '\n  reach and follower_count are expected to run deepest — they are the\n' +
        '  cheap, stable metrics. The other four are filled for the recent window\n' +
        '  only, and older days say so rather than reading as zero.',
    );
  }

  heading('Sync runs');
  const runs = await rows<{
    kind: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    stats: unknown;
    error: string | null;
  }>(sql`
    select kind, status, started_at::text, finished_at::text, stats, error
    from sync_runs order by started_at desc limit 12
  `);
  if (runs.length === 0) console.log('  none');
  for (const r of runs) {
    console.log(`  ${r.status.padEnd(8)} ${r.kind.padEnd(18)} ${r.started_at.slice(0, 19)}`);
    if (r.error) console.log(`           error: ${r.error.slice(0, 140)}`);
    if (r.stats) console.log(`           ${JSON.stringify(r.stats).slice(0, 160)}`);
  }
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
