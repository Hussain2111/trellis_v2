import { IG_USER_ID, call, errorMessage, reportUsage, requireCredentials } from './common';

/**
 * Q2 and Q3 in one run, because both are account-insight requests over an
 * explicit window and it is one token, one sitting.
 *
 *   npm run probe:account-insights
 *
 * Q2 — does `follows_and_unfollows` ever return values? The metric exists and
 * the request is accepted; the response carries the breakdown schema with no
 * results array. Either there were genuinely zero events in the default ~2-day
 * window, or the params need a different arrangement, or it is not populated
 * for this account. Re-requesting over 30 days separates the first from the
 * other two.
 *
 * Q3 — do account insights backfill with an explicit since/until? The claim
 * that they do not is consistent with a DEFAULT request returning ~2 days, but
 * the endpoint accepts a range. If it serves retroactively, the follower chart
 * is populated on day one instead of blank for a month.
 */

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);

const SERIES_METRICS = [
  'reach',
  'views',
  'profile_views',
  'accounts_engaged',
  'total_interactions',
];

function windowParams(days: number): Record<string, string> {
  return { since: String(now - days * DAY), until: String(now) };
}

function describeSeries(body: unknown): string {
  const data = (
    body as { data?: { name?: string; values?: { value?: unknown; end_time?: string }[] }[] }
  )?.data;
  if (!data || data.length === 0) return 'no data array';
  const first = data[0];
  const values = first?.values ?? [];
  if (values.length === 0) return 'metric present, zero values';
  const dates = values.map((v) => v.end_time?.slice(0, 10)).filter(Boolean);
  return `${values.length} day(s): ${dates[0]} → ${dates[dates.length - 1]}`;
}

async function probeBackfill(): Promise<void> {
  console.log('\n── Q3: do account insights backfill with an explicit range? ' + '─'.repeat(10));

  for (const days of [2, 7, 30]) {
    console.log(`\n  since/until = last ${days} days`);
    for (const metric of SERIES_METRICS) {
      const res = await call(`${IG_USER_ID}/insights`, {
        metric,
        period: 'day',
        ...windowParams(days),
      });
      console.log(
        `    ${metric.padEnd(20)} ${res.ok ? describeSeries(res.body) : `ERROR ${errorMessage(res.body)}`}`,
      );
    }
  }

  console.log(
    '\n  Read it this way: if the 30-day request returns ~30 days of values, account\n' +
      '  insights DO backfill and the follower chart is populated from first sync.\n' +
      '  If every window returns the same ~2 days, they do not.',
  );
}

async function probeFollowsUnfollows(): Promise<void> {
  console.log('\n── Q2: does follows_and_unfollows return values? ' + '─'.repeat(21));

  // Several arrangements, because "the params need a different shape" is one
  // of the three candidate causes and the only way to eliminate it is to try.
  const attempts: { label: string; params: Record<string, string> }[] = [
    {
      label: 'default window, no breakdown',
      params: { metric: 'follows_and_unfollows', period: 'day' },
    },
    {
      label: '30 days, no breakdown',
      params: { metric: 'follows_and_unfollows', period: 'day', ...windowParams(30) },
    },
    {
      label: '30 days, metric_type=total_value',
      params: {
        metric: 'follows_and_unfollows',
        period: 'day',
        metric_type: 'total_value',
        ...windowParams(30),
      },
    },
    {
      label: '30 days, total_value + breakdown=follow_type',
      params: {
        metric: 'follows_and_unfollows',
        period: 'day',
        metric_type: 'total_value',
        breakdown: 'follow_type',
        ...windowParams(30),
      },
    },
  ];

  for (const attempt of attempts) {
    const res = await call(`${IG_USER_ID}/insights`, attempt.params);
    const data = (
      res.body as {
        data?: {
          total_value?: { value?: unknown; breakdowns?: { results?: unknown[] }[] };
          values?: unknown[];
        }[];
      }
    )?.data;

    const row = data?.[0];
    const results = row?.total_value?.breakdowns?.[0]?.results;

    let verdict: string;
    if (!res.ok) verdict = `ERROR ${errorMessage(res.body)}`;
    else if (!row) verdict = 'accepted, no data array';
    else if (Array.isArray(results) && results.length > 0)
      verdict = `VALUES — ${results.length} breakdown result(s): ${JSON.stringify(results).slice(0, 120)}`;
    else if (row.total_value?.value !== undefined)
      verdict = `total only: ${JSON.stringify(row.total_value.value)}`;
    else if (Array.isArray(row.values) && row.values.length > 0)
      verdict = `series: ${JSON.stringify(row.values).slice(0, 120)}`;
    else verdict = 'schema present, NO results array';

    console.log(`  ${attempt.label.padEnd(46)} ${verdict}`);
  }

  // Net deltas are the fallback, and they need followers_count to be served
  // as a series rather than only as a current value.
  console.log('\n  Fallback if gross figures never appear — is followers_count a series?');
  const followers = await call(`${IG_USER_ID}/insights`, {
    metric: 'follower_count',
    period: 'day',
    ...windowParams(30),
  });
  console.log(
    `    follower_count       ${followers.ok ? describeSeries(followers.body) : `ERROR ${errorMessage(followers.body)}`}`,
  );

  console.log(
    '\n  If gross follows/unfollows never return values, the dashboard says they are\n' +
      '  unavailable. It does NOT render an empty breakdown as zeros — that is the\n' +
      '  blank-not-zero rule applied to a whole feature rather than one cell.',
  );
}

async function main(): Promise<void> {
  requireCredentials();
  await probeBackfill();
  await probeFollowsUnfollows();
  const last = await call(`${IG_USER_ID}/insights`, { metric: 'reach', period: 'day' });
  reportUsage(last.usage);
}

await main();
