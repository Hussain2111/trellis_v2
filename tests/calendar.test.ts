import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, db } from '../lib/db/client';
import { accounts } from '../lib/db/schema';
import {
  createEntry,
  groupByWeek,
  listEntries,
  markPublished,
  overdueCount,
} from '../lib/calendar/entries';

let accountId: number;

beforeEach(async () => {
  await db().execute(sql`truncate accounts restart identity cascade`);
  const [account] = await db()
    .insert(accounts)
    .values({ igUserId: 'IG1', handle: 't' })
    .returning();
  accountId = account!.id;
});

afterAll(async () => {
  await closeDb();
});

describe('calendar states are derived, never stored', () => {
  it('moves from planned to overdue as the clock passes, with no write', async () => {
    // Stored once as `planned`. A stale status on something three days overdue
    // is exactly the believable falsehood this product exists not to produce.
    const entry = await createEntry(accountId, {
      scheduledFor: new Date('2026-08-20T09:00:00Z'),
      title: 'A draft',
    });

    const [before] = await listEntries(accountId);
    expect(before?.status).toBe('planned');
    expect(['overdue', 'due', 'planned']).toContain(before?.state);

    // The row is untouched; only the reading changed.
    expect(entry.status).toBe('planned');
  });

  it('counts overdue entries for the nav badge', async () => {
    await createEntry(accountId, { scheduledFor: new Date('2020-01-01T00:00:00Z') });
    await createEntry(accountId, { scheduledFor: new Date('2099-01-01T00:00:00Z') });
    expect(await overdueCount(accountId)).toBe(1);
  });

  it('stops counting once marked posted', async () => {
    const entry = await createEntry(accountId, { scheduledFor: new Date('2020-01-01T00:00:00Z') });
    expect(await overdueCount(accountId)).toBe(1);
    await markPublished(accountId, entry.id);
    expect(await overdueCount(accountId)).toBe(0);
  });
});

describe('Riyadh week grouping', () => {
  it('files 22:00 Sunday UTC into the Monday week that has already begun', async () => {
    // The boundary case. 2026-08-16 is a Sunday; 22:00 UTC is Monday 01:00 in
    // Riyadh, and a naive sort files it in the wrong week.
    await createEntry(accountId, { scheduledFor: new Date('2026-08-16T22:00:00Z'), title: 'late' });
    await createEntry(accountId, {
      scheduledFor: new Date('2026-08-16T20:00:00Z'),
      title: 'early',
    });

    const weeks = groupByWeek(await listEntries(accountId));
    expect(weeks).toHaveLength(2);

    const [earlier, later] = weeks;
    expect(earlier!.entries[0]?.title).toBe('early');
    expect(later!.entries[0]?.title).toBe('late');
    // Monday 00:00 Riyadh is 21:00 the previous day UTC.
    expect(later!.weekStart).toBe('2026-08-16T21:00:00.000Z');
  });
});
