import {
  EMPTY,
  ERROR,
  IG_USER_ID,
  OK,
  call,
  errorMessage,
  reportUsage,
  requireCredentials,
} from './common';

/**
 * Q1 — how far back do media insights actually reach?
 *
 *   npm run probe:lookback
 *
 * The highest-value unknown in the project. It decides whether the chat reasons
 * over most of the account's history or over a handful of recent posts, and a
 * grounded chat with two data points is not a product.
 *
 * The previous build asserted flatly that insights do not backfill and designed
 * a permanently sparse dashboard around it. Then a post roughly five months old
 * returned full lifetime insights on the first real probe. One data point
 * proving "never" wrong is not a boundary, which is what this establishes.
 *
 * Walks the media edge with pagination, requests insights for every post, and
 * reports the oldest post that returns data and the first that does not.
 */

const METRICS = 'reach,views,saved,shares,likes,comments,total_interactions';
const MAX_PAGES = 20;

interface Row {
  id: string;
  timestamp?: string;
  media_type?: string;
  media_product_type?: string;
}

interface Result {
  id: string;
  when: Date;
  ageDays: number;
  type: string;
  served: boolean;
  detail: string;
}

async function collectMedia(): Promise<Row[]> {
  const rows: Row[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params: Record<string, string> = {
      fields: 'id,timestamp,media_type,media_product_type',
      limit: '50',
    };
    if (after) params.after = after;

    const res = await call(`${IG_USER_ID}/media`, params);
    if (!res.ok) {
      console.error(`  media page ${page + 1} failed: ${errorMessage(res.body)}`);
      break;
    }
    const body = res.body as { data?: Row[]; paging?: { cursors?: { after?: string } } };
    rows.push(...(body.data ?? []));

    after = body.paging?.cursors?.after;
    if (!after || (body.data ?? []).length === 0) break;
  }

  return rows;
}

async function main(): Promise<void> {
  requireCredentials();
  console.log('Walking the media edge…');

  const media = await collectMedia();
  console.log(`  ${media.length} posts found\n`);
  if (media.length === 0) return;

  const dated = media
    .filter((row): row is Row & { timestamp: string } => Boolean(row.timestamp))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const now = Date.now();
  const results: Result[] = [];
  let lastUsage: Record<string, string> = {};

  for (const row of dated) {
    const when = new Date(row.timestamp);
    const res = await call(`${row.id}/insights`, { metric: METRICS });
    lastUsage = res.usage;

    const data = (res.body as { data?: { name?: string; values?: { value?: unknown }[] }[] })?.data;
    const served = Boolean(res.ok && data && data.length > 0);

    results.push({
      id: row.id,
      when,
      ageDays: Math.floor((now - when.getTime()) / 86_400_000),
      type: `${row.media_type ?? '?'}/${row.media_product_type ?? '?'}`,
      served,
      detail: res.ok
        ? served
          ? `${data!.length} metrics`
          : 'no data array'
        : errorMessage(res.body),
    });

    // Deliberately unhurried. This walks the whole account in one go and is
    // the largest burst any script here makes.
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log('  age(d)  date        type                      insights');
  for (const r of results) {
    console.log(
      `  ${String(r.ageDays).padStart(6)}  ${r.when.toISOString().slice(0, 10)}  ` +
        `${r.type.padEnd(24)}  ${(r.served ? OK : r.detail.includes('[') ? ERROR : EMPTY).padEnd(6)} ${r.served ? '' : r.detail}`,
    );
  }

  const servedRows = results.filter((r) => r.served);
  const missing = results.filter((r) => !r.served);

  console.log('\n── Answer ' + '─'.repeat(60));
  if (servedRows.length === 0) {
    console.log(
      '  No post returned insights at all. Something is wrong with scope or account type.',
    );
  } else {
    const oldestServed = servedRows[servedRows.length - 1]!;
    console.log(
      `  Oldest post WITH insights:  ${oldestServed.when.toISOString().slice(0, 10)} (${oldestServed.ageDays} days old)`,
    );
    const firstMissing = missing.find((m) => m.ageDays > oldestServed.ageDays);
    console.log(
      firstMissing
        ? `  First post WITHOUT:         ${firstMissing.when.toISOString().slice(0, 10)} (${firstMissing.ageDays} days old)`
        : "  No older post lacked insights — the boundary is beyond this account's history.",
    );
    console.log(`  Coverage: ${servedRows.length}/${results.length} posts.`);
  }

  if (missing.length > 0 && servedRows.length > 0) {
    console.log('\n  Posts missing insights, by reason:');
    const reasons = new Map<string, number>();
    for (const m of missing) reasons.set(m.detail, (reasons.get(m.detail) ?? 0) + 1);
    for (const [reason, count] of reasons) console.log(`    ${count}× ${reason}`);
  }

  console.log(
    '\n  If coverage is deep, a backfill task belongs in the plan and the chat has real\n' +
      '  history on day one. If it is shallow, the dashboard carries a coverage note —\n' +
      '  but with a date in it, not the word "never".',
  );
  reportUsage(lastUsage);
}

await main();
