import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, db } from '../lib/db/client';
import { UNAVAILABLE_REASONS, isUnavailableReason } from '../lib/db/unavailable';

afterAll(async () => {
  await closeDb();
});

/**
 * These run against the real schema, not a model of it. The point is to catch
 * a future migration reintroducing something the design forbids — which review
 * would not reliably catch, because a `default 0` looks helpful.
 */

const METRIC_COLUMNS: [table: string, column: string][] = [
  ['accounts', 'followers_count'],
  ['accounts', 'follows_count'],
  ['accounts', 'media_count'],
  ['posts', 'like_count'],
  ['posts', 'comments_count'],
  ['post_insights', 'reach'],
  ['post_insights', 'views'],
  ['post_insights', 'saved'],
  ['post_insights', 'shares'],
  ['post_insights', 'likes'],
  ['post_insights', 'comments'],
  ['post_insights', 'total_interactions'],
  ['account_daily', 'follower_count'],
  ['account_daily', 'reach'],
  ['account_daily', 'views'],
  ['account_daily', 'profile_views'],
  ['account_daily', 'accounts_engaged'],
  ['account_daily', 'total_interactions'],
  ['account_daily', 'follows'],
  ['account_daily', 'unfollows'],
];

describe('no metric column may default to zero', () => {
  it('every metric column is nullable with no default', async () => {
    const rows = await db().execute<{
      table_name: string;
      column_name: string;
      column_default: string | null;
      is_nullable: string;
    }>(sql`
      select table_name, column_name, column_default, is_nullable
      from information_schema.columns
      where table_schema = 'public'
    `);

    const byKey = new Map<string, (typeof rows)[number]>(
      [...rows].map((r) => [`${r.table_name}.${r.column_name}`, r]),
    );

    const violations: string[] = [];
    for (const [table, column] of METRIC_COLUMNS) {
      const key = `${table}.${column}`;
      const row = byKey.get(key);
      if (!row) {
        violations.push(`${key} — column is missing from the schema entirely`);
        continue;
      }
      // A zero written at the storage layer is unrecoverable: nothing
      // downstream can tell it from a real measurement of zero.
      if (row.column_default !== null) {
        violations.push(`${key} — has a default of ${row.column_default}`);
      }
      if (row.is_nullable !== 'YES') {
        violations.push(`${key} — is NOT NULL, so it cannot represent "unknown"`);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('unavailable reasons', () => {
  it('distinguishes never-sampled from Meta declining', () => {
    // The load-bearing distinction. Meta did not decline a t48 measurement on a
    // 2021 post — nobody asked at the time, and nobody can now. Collapsing
    // these would let the chat imply it looked and found nothing.
    expect(UNAVAILABLE_REASONS.never_sampled).not.toBe(UNAVAILABLE_REASONS.declined_by_meta);
    expect(UNAVAILABLE_REASONS.never_sampled).toMatch(/not measured/i);
    expect(UNAVAILABLE_REASONS.declined_by_meta).toMatch(/didn't report/i);
  });

  it('distinguishes not-backfilled from unavailable', () => {
    // A day outside the expensive-metric window was never requested. Saying
    // Instagram didn't report it would be a different, false claim.
    expect(UNAVAILABLE_REASONS.not_backfilled).toMatch(/not collected/i);
    expect(UNAVAILABLE_REASONS.not_backfilled).not.toBe(UNAVAILABLE_REASONS.declined_by_meta);
  });

  it('rejects a reason outside the closed set', () => {
    expect(isUnavailableReason('never_sampled')).toBe(true);
    expect(isUnavailableReason('probably fine')).toBe(false);
    expect(isUnavailableReason(undefined)).toBe(false);
  });

  it('round-trips through jsonb as a typed map', async () => {
    const [row] = await db().execute<{ unavailable: Record<string, string> }>(sql`
      select ${JSON.stringify({ views: 'not_backfilled', reach: 'declined_by_meta' })}::jsonb
        as unavailable
    `);
    expect(row?.unavailable.views).toBe('not_backfilled');
    expect(isUnavailableReason(row?.unavailable.reach)).toBe(true);
  });
});
