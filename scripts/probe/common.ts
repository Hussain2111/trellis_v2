import 'dotenv/config';

/**
 * Shared plumbing for the probes — and nothing from `lib/`.
 *
 * A probe that imports the app's Graph client can only ever confirm the app's
 * own assumptions. On the previous build the actor input field name was wrong
 * in the caller AND in every fixture, and every test passed. So these scripts
 * build their own requests from scratch, deliberately.
 */

export const API_VERSION = process.env.GRAPH_API_VERSION ?? 'v21.0';
export const TOKEN = process.env.IG_ACCESS_TOKEN ?? '';
export const IG_USER_ID = process.env.IG_USER_ID ?? '';

export interface ProbeResponse {
  ok: boolean;
  status: number;
  body: unknown;
  /** The version Meta actually served, read off the response, not assumed. */
  servedVersion: string | null;
  usage: Record<string, string>;
}

export async function call(
  path: string,
  params: Record<string, string> = {},
): Promise<ProbeResponse> {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/${path}`);
  for (const [key, value] of Object.entries({ access_token: TOKEN, ...params })) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  // Meta silently upgrades calls to a retired version. The served version is
  // read from any URL echoed in the response rather than trusted to match what
  // was asked for — that mismatch is how a renamed metric goes unnoticed.
  const served = /graph\.facebook\.com\\?\/(v\d+\.\d+)/.exec(text)?.[1] ?? null;

  const usage: Record<string, string> = {};
  for (const header of ['x-app-usage', 'x-business-use-case-usage', 'x-ad-account-usage']) {
    const value = res.headers.get(header);
    if (value) usage[header] = value;
  }

  return { ok: res.ok, status: res.status, body, servedVersion: served, usage };
}

export function requireCredentials(needsUserId = true): void {
  const missing: string[] = [];
  if (!TOKEN) missing.push('IG_ACCESS_TOKEN');
  if (needsUserId && !IG_USER_ID) missing.push('IG_USER_ID');
  if (missing.length > 0) {
    console.error(`Missing ${missing.join(', ')} in your environment (.env).`);
    process.exit(1);
  }
}

export function errorMessage(body: unknown): string {
  const error = (body as { error?: { message?: string; code?: number } })?.error;
  if (!error) return '';
  return `[${error.code ?? '?'}] ${error.message ?? 'unknown'}`;
}

/** Meta's rate-limit signals, in the form the sync layer will have to read. */
export function reportUsage(usage: Record<string, string>): void {
  if (Object.keys(usage).length === 0) return;
  console.log('\nRate-limit headers (the sync layer records these):');
  for (const [key, value] of Object.entries(usage)) {
    console.log(`  ${key}: ${value.slice(0, 300)}`);
  }
}

export function table(rows: { name: string; verdict: string; detail?: string }[]): void {
  const width = Math.max(...rows.map((r) => r.name.length), 4);
  for (const row of rows) {
    console.log(
      `  ${row.verdict.padEnd(14)} ${row.name.padEnd(width)}  ${(row.detail ?? '').slice(0, 90)}`,
    );
  }
}

export const OK = 'OK';
export const ABSENT = 'ABSENT';
export const EMPTY = 'EMPTY';
export const ERROR = 'ERROR';
export const CONDITIONAL = 'TYPE-COND';
