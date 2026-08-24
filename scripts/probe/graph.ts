import {
  ABSENT,
  API_VERSION,
  CONDITIONAL,
  EMPTY,
  ERROR,
  IG_USER_ID,
  OK,
  TOKEN,
  call,
  errorMessage,
  reportUsage,
  requireCredentials,
  table,
} from './common';

/**
 * First contact. Read-only, local, free.
 *
 *   npm run probe:graph
 *
 * Send back the TERMINAL TABLE. Do not send the JSON — it contains real
 * account data.
 */

const REQUIRED_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_manage_comments',
  'pages_read_engagement',
  'pages_show_list',
  'business_management',
];
const PUBLISHING_SCOPES = ['instagram_content_publish'];

const MEDIA_FIELDS = [
  'id',
  'shortcode',
  'caption',
  'media_type',
  'media_product_type',
  'timestamp',
  'permalink',
  'thumbnail_url',
  'media_url',
  'like_count',
  'comments_count',
];

const MEDIA_METRICS = [
  'reach',
  'views',
  'saved',
  'shares',
  'likes',
  'comments',
  'total_interactions',
];

interface MediaRow {
  id: string;
  media_type?: string;
  media_product_type?: string;
  [key: string]: unknown;
}

async function probeToken(): Promise<void> {
  console.log('\n── Token ' + '─'.repeat(60));
  const res = await call('debug_token', { input_token: TOKEN });
  if (!res.ok) {
    table([{ name: 'debug_token', verdict: ERROR, detail: errorMessage(res.body) }]);
    return;
  }

  const data = (
    res.body as { data?: { scopes?: string[]; is_valid?: boolean; expires_at?: number } }
  )?.data;
  const scopes = data?.scopes ?? [];

  const expiresAt = data?.expires_at ?? 0;
  const days = expiresAt > 0 ? Math.floor((expiresAt - Date.now() / 1000) / 86400) : null;
  console.log(
    `  valid: ${data?.is_valid !== false} · expiry: ${days === null ? 'none reported' : `${days} day(s)`}`,
  );

  table(
    [...REQUIRED_SCOPES, ...PUBLISHING_SCOPES].map((scope) => ({
      name: PUBLISHING_SCOPES.includes(scope) ? `${scope} (unused, held)` : scope,
      verdict: scopes.includes(scope) ? OK : ABSENT,
      detail:
        scopes.length === 0
          ? 'debug_token reported no scopes at all'
          : scope === 'business_management' && !scopes.includes(scope)
            ? 'THIS ONE FAILS SILENTLY — /me/accounts returns an empty list, not an error'
            : '',
    })),
  );
}

async function probeAccountResolution(): Promise<void> {
  console.log('\n── Account resolution ' + '─'.repeat(47));
  const me = await call('me', { fields: 'id,name' });
  const accounts = await call('me/accounts', { fields: 'id,name,instagram_business_account' });

  const pages = (accounts.body as { data?: unknown[] })?.data ?? [];
  table([
    {
      name: '/me',
      verdict: me.ok ? OK : ERROR,
      detail: me.ok ? 'profile returned' : errorMessage(me.body),
    },
    {
      name: '/me/accounts',
      verdict: !accounts.ok ? ERROR : pages.length > 0 ? OK : EMPTY,
      detail: !accounts.ok
        ? errorMessage(accounts.body)
        : pages.length > 0
          ? `${pages.length} Page(s)`
          : 'EMPTY — if /me worked, this is business_management missing, not "no Pages"',
    },
  ]);
}

async function probeAccount(): Promise<void> {
  console.log('\n── Account ' + '─'.repeat(59));
  const res = await call(IG_USER_ID, {
    fields: 'username,followers_count,follows_count,media_count,name,biography',
  });
  if (!res.ok) {
    table([{ name: 'GET /{ig-user-id}', verdict: ERROR, detail: errorMessage(res.body) }]);
    return;
  }
  const body = res.body as Record<string, unknown>;
  table(
    ['username', 'followers_count', 'follows_count', 'media_count', 'name', 'biography'].map(
      (field) => ({
        name: field,
        verdict: field in body ? (body[field] === null ? EMPTY : OK) : ABSENT,
        detail: field in body ? String(body[field]).slice(0, 40) : 'not in response',
      }),
    ),
  );
}

async function probeMedia(): Promise<MediaRow[]> {
  console.log('\n── Media edge ' + '─'.repeat(56));
  const res = await call(`${IG_USER_ID}/media`, { fields: MEDIA_FIELDS.join(','), limit: '25' });
  if (!res.ok) {
    table([{ name: 'GET /media', verdict: ERROR, detail: errorMessage(res.body) }]);
    return [];
  }

  const rows = ((res.body as { data?: MediaRow[] })?.data ?? []) as MediaRow[];
  if (rows.length === 0) {
    table([{ name: 'GET /media', verdict: EMPTY, detail: 'no media returned' }]);
    return rows;
  }

  // One sample per media type, not just rows[0]. Fields on this edge are
  // type-conditional — thumbnail_url is served for VIDEO/REELS and omitted for
  // CAROUSEL_ALBUM/IMAGE — so inspecting the newest item alone reports ABSENT
  // for a field that is present two rows down. That false negative is worse
  // than silence: a probe that cries wolf gets discounted, and then the next
  // real finding is waved through with it.
  const byType = new Map<string, MediaRow>();
  for (const row of rows) {
    const key = `${row.media_type ?? '?'}/${row.media_product_type ?? '?'}`;
    if (!byType.has(key)) byType.set(key, row);
  }
  const samples = [...byType.entries()];
  console.log(`  types in this page: ${samples.map(([t]) => t).join(', ')}`);

  table(
    MEDIA_FIELDS.map((field) => {
      const carriers = samples.filter(([, row]) => field in row);
      const missing = samples.filter(([, row]) => !(field in row));
      if (carriers.length === 0) {
        return {
          name: field,
          verdict: ABSENT,
          detail: `not served for any of ${samples.map(([t]) => t).join(', ')}`,
        };
      }
      if (missing.length === 0) {
        return { name: field, verdict: OK, detail: String(carriers[0]![1][field]).slice(0, 50) };
      }
      return {
        name: field,
        verdict: CONDITIONAL,
        detail: `on ${carriers.map(([t]) => t).join(',')} — not on ${missing.map(([t]) => t).join(',')}`,
      };
    }),
  );

  const unseen = ['IMAGE', 'CAROUSEL_ALBUM', 'VIDEO'].filter(
    (t) => !samples.some(([k]) => k.startsWith(`${t}/`)),
  );
  if (unseen.length > 0) {
    console.log(
      `  NOTE: no ${unseen.join(', ')} in this page — those types are UNPROBED, not clean.`,
    );
  }

  return rows;
}

async function probeMediaInsights(rows: MediaRow[]): Promise<void> {
  console.log('\n── Media insights, per type, per metric ' + '─'.repeat(30));
  const byType = new Map<string, MediaRow>();
  for (const row of rows) {
    const key = `${row.media_type ?? '?'}/${row.media_product_type ?? '?'}`;
    if (!byType.has(key)) byType.set(key, row);
  }

  for (const [type, row] of byType) {
    console.log(`\n  ${type}  (media ${row.id})`);

    // Batched first — the shape the sync layer wants to use.
    const batched = await call(`${row.id}/insights`, { metric: MEDIA_METRICS.join(',') });
    console.log(
      `    batched request: ${batched.ok ? OK : ERROR} ${batched.ok ? '' : errorMessage(batched.body)}`,
    );

    // Then one at a time, so a single unsupported metric does not mask the
    // rest. This is how a renamed metric gets found rather than inferred.
    const findings: { name: string; verdict: string; detail?: string }[] = [];
    for (const metric of MEDIA_METRICS) {
      const one = await call(`${row.id}/insights`, { metric });
      const values = (one.body as { data?: { values?: { value?: unknown }[] }[] })?.data?.[0]
        ?.values?.[0]?.value;
      findings.push({
        name: metric,
        verdict: !one.ok ? ERROR : values === undefined ? EMPTY : OK,
        detail: !one.ok ? errorMessage(one.body) : String(values),
      });
    }
    table(findings);
  }
}

async function main(): Promise<void> {
  requireCredentials();
  console.log(`Probing Graph API — requesting ${API_VERSION}`);

  await probeToken();
  await probeAccountResolution();
  await probeAccount();
  const rows = await probeMedia();
  if (rows.length > 0) await probeMediaInsights(rows);

  const last = await call('me', { fields: 'id' });
  if (last.servedVersion && last.servedVersion !== API_VERSION) {
    console.log(
      `\n!! VERSION MISMATCH: requested ${API_VERSION}, Meta served ${last.servedVersion}.` +
        '\n   Pin GRAPH_API_VERSION to what is actually served, or accept silent upgrades.',
    );
  }
  reportUsage(last.usage);
}

await main();
