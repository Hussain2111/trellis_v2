import { IG_USER_ID, call, errorMessage, reportUsage, requireCredentials } from './common';

/**
 * Q3a, Q3b and Q2a. One token, one sitting.
 *
 *   npm run probe:account-insights
 *
 * The previous version of this script had a bug that hid most of the answer:
 * it sent `metric` + `period` + window but not `metric_type=total_value`, so
 * four of five metrics errored `(#100)` and only `reach` was ever tested.
 *
 * That was a client-level finding, not just a probe bug — the sync layer needs
 * the parameter too. So this version does not assume which metrics need it. It
 * tries BOTH forms for every metric and reports what each one did, because the
 * point of a probe is to find out rather than to confirm.
 *
 * What it answers:
 *
 *   Q3a  Does a metric return a per-day SERIES or a single WINDOW TOTAL — and
 *        does a one-day window yield a usable daily value? This decides whether
 *        `account_daily` can hold all five metrics per day at all, or whether
 *        four of them are window aggregates needing their own table.
 *
 *   Q3b  How far back does the window reach? 30 days is confirmed. If 90 or 365
 *        also return, first sync populates proportionally more.
 *
 *   Q2a  Do FOLLOWER / NON_FOLLOWER mean follows / unfollows, or something
 *        else? Verified against the `follower_count` net change, judged on SIGN.
 */

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);

const METRICS = ['reach', 'views', 'profile_views', 'accounts_engaged', 'total_interactions'];
const WINDOWS = [2, 7, 30, 90, 365];

function windowParams(days: number): Record<string, string> {
  return { since: String(now - days * DAY), until: String(now) };
}

type Shape = 'series' | 'total' | 'empty' | 'error';

interface Outcome {
  shape: Shape;
  detail: string;
  /** Number of per-day values, when it is a series. */
  points?: number;
  /** First and last day covered, when it is a series. */
  span?: [string, string];
}

interface SeriesPoint {
  value?: unknown;
  end_time?: string;
}

interface InsightRow {
  name?: string;
  values?: SeriesPoint[];
  total_value?: { value?: unknown; breakdowns?: { results?: unknown[] }[] };
}

function classify(ok: boolean, body: unknown): Outcome {
  if (!ok) return { shape: 'error', detail: errorMessage(body) };

  const data = (body as { data?: InsightRow[] })?.data;
  if (!data || data.length === 0) return { shape: 'empty', detail: 'no data array' };

  const row = data[0]!;

  // A series is what `account_daily` needs: one value per day, each stamped.
  if (Array.isArray(row.values) && row.values.length > 0) {
    const days = row.values.map((v) => v.end_time?.slice(0, 10) ?? '?');
    return {
      shape: 'series',
      points: row.values.length,
      span: [days[0]!, days[days.length - 1]!],
      detail: `${row.values.length} day(s): ${days[0]} → ${days[days.length - 1]}`,
    };
  }

  // A single aggregate for the whole window. Cannot be spread across days
  // without one request per day.
  if (row.total_value && row.total_value.value !== undefined) {
    return { shape: 'total', detail: `single total: ${JSON.stringify(row.total_value.value)}` };
  }

  return { shape: 'empty', detail: 'metric present, no values and no total' };
}

async function ask(
  metric: string,
  extra: Record<string, string>,
): Promise<Outcome & { usage: Record<string, string> }> {
  const res = await call(`${IG_USER_ID}/insights`, { metric, period: 'day', ...extra });
  return { ...classify(res.ok, res.body), usage: res.usage };
}

/**
 * Q3a — shape, and whether a single day can be addressed at all.
 *
 * Both forms are tried for every metric. Assuming which metrics need
 * `metric_type=total_value` is how the last run lost four fifths of its answer.
 */
async function probeShapes(): Promise<void> {
  console.log('\n══ Q3a: series or window total? ' + '═'.repeat(45));

  for (const metric of [...METRICS, 'follower_count']) {
    console.log(`\n  ${metric}`);

    const plain = await ask(metric, windowParams(30));
    console.log(`    period=day, 30d                    ${plain.shape.padEnd(7)} ${plain.detail}`);

    const totalValue = await ask(metric, {
      metric_type: 'total_value',
      ...windowParams(30),
    });
    console.log(
      `    period=day + total_value, 30d      ${totalValue.shape.padEnd(7)} ${totalValue.detail}`,
    );

    // The decisive test. If a one-day window yields one usable value, a per-day
    // backfill is possible — 30 requests for a month, 365 for a year, which the
    // measured ~1% headroom affords. If it does not, these metrics cannot live
    // in a per-day table at all.
    const yesterdayStart = Math.floor((now - DAY) / DAY) * DAY;
    const oneDay = { since: String(yesterdayStart), until: String(yesterdayStart + DAY) };

    const singlePlain = await ask(metric, oneDay);
    const singleTotal = await ask(metric, { metric_type: 'total_value', ...oneDay });
    const best = singlePlain.shape !== 'error' ? singlePlain : singleTotal;
    const which = singlePlain.shape !== 'error' ? 'plain' : 'total_value';

    console.log(
      `    ONE-DAY WINDOW (${which.padEnd(11)})      ${best.shape.padEnd(7)} ${best.detail}`,
    );

    const usableDaily =
      (best.shape === 'series' && best.points === 1) || best.shape === 'total'
        ? 'YES — a per-day backfill is possible'
        : best.shape === 'series'
          ? `partly — returned ${best.points} points for a one-day window`
          : 'NO — this metric cannot be addressed a day at a time';
    console.log(`    → usable daily value?              ${usableDaily}`);
  }
}

/** Q3b — how far back the window reaches. */
async function probeRange(): Promise<void> {
  console.log('\n══ Q3b: how far back does the window reach? ' + '═'.repeat(33));
  console.log('  (30 days is already confirmed for reach and follower_count)\n');

  for (const metric of [...METRICS, 'follower_count']) {
    const cells: string[] = [];
    for (const days of WINDOWS) {
      const plain = await ask(metric, windowParams(days));
      const outcome =
        plain.shape === 'error'
          ? await ask(metric, { metric_type: 'total_value', ...windowParams(days) })
          : plain;

      cells.push(
        outcome.shape === 'series'
          ? `${days}d:${outcome.points}pts`
          : outcome.shape === 'total'
            ? `${days}d:total`
            : `${days}d:${outcome.shape}`,
      );
    }
    console.log(`  ${metric.padEnd(20)} ${cells.join('  ')}`);
  }

  console.log(
    '\n  Read it this way: the largest window still returning values is how much\n' +
      '  history the first sync can populate. If 365 returns, the backfill scope\n' +
      '  grows again and the backup depth argument changes with it.',
  );
}

/**
 * Q2 — the values, and Q2a — what the dimensions actually mean.
 */
async function probeFollowsUnfollows(): Promise<void> {
  console.log('\n══ Q2: follows_and_unfollows ' + '═'.repeat(48));

  const days = 30;
  const params = {
    metric: 'follows_and_unfollows',
    period: 'day',
    metric_type: 'total_value',
    breakdown: 'follow_type',
    ...windowParams(days),
  };

  const res = await call(`${IG_USER_ID}/insights`, params);
  const row = (res.body as { data?: InsightRow[] })?.data?.[0];
  const results = row?.total_value?.breakdowns?.[0]?.results as
    { dimension_values?: string[]; value?: number }[] | undefined;

  if (!res.ok || !results || results.length === 0) {
    console.log(
      `  no breakdown returned: ${res.ok ? 'schema present, no results' : errorMessage(res.body)}`,
    );
    return;
  }

  const byDimension = new Map<string, number>();
  for (const entry of results) {
    const key = entry.dimension_values?.[0] ?? '?';
    byDimension.set(key, entry.value ?? 0);
  }
  for (const [key, value] of byDimension) console.log(`  ${key.padEnd(16)} ${value}`);

  const follower = byDimension.get('FOLLOWER');
  const nonFollower = byDimension.get('NON_FOLLOWER');
  if (follower === undefined || nonFollower === undefined) {
    console.log(
      '\n  Dimensions are not FOLLOWER/NON_FOLLOWER. Do not label them. Record what they are.',
    );
    return;
  }

  await verifyMapping(follower, nonFollower, days);
}

/**
 * Q2a — the semantic check.
 *
 * `FOLLOWER` and `NON_FOLLOWER` are NOT `FOLLOW` and `UNFOLLOW`. Reading the
 * first as follows and the second as unfollows is plausible, and so is the
 * reading where the breakdown describes the actor's relationship at the time of
 * the event. Getting it backwards would put a confidently inverted number on
 * the dashboard under the word "unfollows".
 *
 * The check: net follower change over the same window should equal
 * follows − unfollows. So compare it against FOLLOWER − NON_FOLLOWER and judge
 * on SIGN. Magnitude will drift a little — window edges do not align perfectly
 * — so the sign is the signal and the size is not.
 */
async function verifyMapping(follower: number, nonFollower: number, days: number): Promise<void> {
  console.log('\n══ Q2a: what do the dimensions mean? ' + '═'.repeat(40));

  const difference = follower - nonFollower;
  console.log(`  FOLLOWER − NON_FOLLOWER = ${follower} − ${nonFollower} = ${difference}`);

  const res = await call(`${IG_USER_ID}/insights`, {
    metric: 'follower_count',
    period: 'day',
    ...windowParams(days),
  });
  const values = (res.body as { data?: InsightRow[] })?.data?.[0]?.values;

  if (!res.ok || !Array.isArray(values) || values.length < 2) {
    console.log(
      '  Could not read a follower_count series. INCONCLUSIVE — do not label the metric.',
    );
    return;
  }

  // follower_count from the insights edge is a daily *delta*, not a running
  // total, on some accounts — and a running total on others. Report both
  // readings so the comparison cannot be made against the wrong one.
  const numeric = values.map((v) => Number(v.value)).filter((n) => Number.isFinite(n));
  const sumOfDailies = numeric.reduce((total, n) => total + n, 0);
  const endToEnd = numeric[numeric.length - 1]! - numeric[0]!;

  console.log(`  follower_count, ${numeric.length} points`);
  console.log(`    first ${numeric[0]}  last ${numeric[numeric.length - 1]}`);
  console.log(`    sum of values (if daily deltas):  ${sumOfDailies}`);
  console.log(`    last − first  (if running total): ${endToEnd}`);

  const candidates = [
    { label: 'sum of values', value: sumOfDailies },
    { label: 'last − first', value: endToEnd },
  ];

  console.log('');
  for (const candidate of candidates) {
    // A near-zero net change cannot discriminate: both mappings predict
    // something close to nothing, so agreement proves nothing. That is an
    // inconclusive result, not a confirmation — the quiet false positive this
    // check exists to avoid.
    if (Math.abs(candidate.value) < Math.abs(difference) * 0.25) {
      console.log(
        `  ${candidate.label.padEnd(16)} ${candidate.value} — INCONCLUSIVE, too close to zero to discriminate. Widen the window.`,
      );
      continue;
    }
    if (Math.sign(candidate.value) === Math.sign(difference)) {
      console.log(
        `  ${candidate.label.padEnd(16)} ${candidate.value} — signs AGREE: FOLLOWER = follows, NON_FOLLOWER = unfollows.`,
      );
    } else {
      console.log(
        `  ${candidate.label.padEnd(16)} ${candidate.value} — signs DISAGREE: the mapping is REVERSED, or the dimensions mean something else.`,
      );
    }
  }

  console.log(
    '\n  Judge on sign, not size — window edges do not align perfectly and a few\n' +
      '  units of drift are expected. If both readings are inconclusive, widen the\n' +
      '  window and re-run. If they disagree with each other, the dashboard shows\n' +
      '  this metric UNLABELLED or not at all until it is understood. It does not guess.\n' +
      '  Record the outcome in docs/graph-api.md — this will otherwise be re-guessed.',
  );
}

async function main(): Promise<void> {
  requireCredentials();
  await probeShapes();
  await probeRange();
  await probeFollowsUnfollows();

  const last = await call(`${IG_USER_ID}/insights`, { metric: 'reach', period: 'day' });
  reportUsage(last.usage);
}

await main();
