import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, db } from '../lib/db/client';
import { accountDaily, accounts, calendarEntries } from '../lib/db/schema';
import { currentAlerts } from '../lib/alerts';
import { riyadhDayRange, riyadhInstant } from '../lib/time';

let accountId: number;

beforeEach(async () => {
  await db().execute(sql`truncate accounts restart identity cascade`);
  const [account] = await db()
    .insert(accounts)
    .values({ igUserId: 'IG1', handle: 'glowithuzma', followersCount: 4876 })
    .returning();
  accountId = account!.id;
});

afterAll(async () => {
  await closeDb();
});

describe('follower alerts', () => {
  it('says nothing at all with only one reading', async () => {
    // A first sync has nothing to compare against. Silence is the honest
    // output; "no change" would be a claim about a comparison never made.
    await db()
      .insert(accountDaily)
      .values([{ accountId, day: '2026-08-25', followersTotal: 4876 }]);

    const { alerts } = await currentAlerts(accountId);
    expect(alerts).toEqual([]);
  });

  it('says nothing when the count held steady', async () => {
    await db()
      .insert(accountDaily)
      .values([
        { accountId, day: '2026-08-25', followersTotal: 4876 },
        { accountId, day: '2026-08-26', followersTotal: 4876 },
      ]);

    expect((await currentAlerts(accountId)).alerts).toEqual([]);
  });

  it('reports a drop as a net change, and never as a person', async () => {
    await db()
      .insert(accountDaily)
      .values([
        { accountId, day: '2026-08-25', followersTotal: 4885 },
        { accountId, day: '2026-08-26', followersTotal: 4876 },
      ]);

    const [alert] = (await currentAlerts(accountId)).alerts;
    expect(alert?.kind).toBe('followers_down');
    expect(alert?.tone).toBe('negative');
    expect(alert?.title).toBe('You lost 9 followers');
    expect(alert?.detail).toContain('Net change');
    expect(alert?.detail).toContain("Instagram doesn't say who");
  });

  it('reports a rise the same way', async () => {
    await db()
      .insert(accountDaily)
      .values([
        { accountId, day: '2026-08-25', followersTotal: 4876 },
        { accountId, day: '2026-08-26', followersTotal: 4877 },
      ]);

    const [alert] = (await currentAlerts(accountId)).alerts;
    expect(alert?.kind).toBe('followers_up');
    expect(alert?.title).toBe('You gained 1 follower');
  });

  it('ignores Meta’s own daily metric entirely', async () => {
    // `follower_count` is not a running total — see docs/graph-api.md. If the
    // alert ever reads this column it will announce movement that never
    // happened, which is exactly the failure this product exists to avoid.
    await db()
      .insert(accountDaily)
      .values([
        { accountId, day: '2026-08-25', followerCount: 3 },
        { accountId, day: '2026-08-26', followerCount: 41 },
      ]);

    expect((await currentAlerts(accountId)).alerts).toEqual([]);
  });

  it('compares the two most recent readings across a gap in syncing', async () => {
    await db()
      .insert(accountDaily)
      .values([
        { accountId, day: '2026-08-01', followersTotal: 5000 },
        { accountId, day: '2026-08-20', followersTotal: 4885 },
        { accountId, day: '2026-08-25', followerCount: 2 },
        { accountId, day: '2026-08-26', followersTotal: 4876 },
      ]);

    const [alert] = (await currentAlerts(accountId)).alerts;
    expect(alert?.title).toBe('You lost 9 followers');
    expect(alert?.detail).toContain('20 Aug 2026');
  });
});

describe('calendar alerts', () => {
  const now = new Date('2026-08-26T09:00:00Z'); // midday in Riyadh

  it('flags a post due later today', async () => {
    await db()
      .insert(calendarEntries)
      .values({
        accountId,
        scheduledFor: riyadhInstant('2026-08-26', '18:00'),
        title: 'Double cleansing carousel',
      });

    const { alerts, overdue } = await currentAlerts(accountId, now);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe('due_today');
    expect(alerts[0]?.title).toBe('1 post due today');
    expect(alerts[0]?.detail).toBe('Double cleansing carousel');
    expect(overdue).toBe(0);
  });

  it('calls a post overdue rather than due once its time has passed', async () => {
    // Both would be true of the same row read carelessly. Being told a thing is
    // due today AND overdue is being told nothing.
    await db()
      .insert(calendarEntries)
      .values({
        accountId,
        scheduledFor: riyadhInstant('2026-08-26', '08:00'),
        title: 'Morning reel',
      });

    const { alerts, overdue } = await currentAlerts(accountId, now);
    expect(alerts.map((alert) => alert.kind)).toEqual(['overdue']);
    expect(overdue).toBe(1);
  });

  it('does not flag tomorrow, and gets the Riyadh boundary right', async () => {
    // 22:00 UTC on the 26th is 01:00 on the 27th in Riyadh. A naive reading
    // files it today; it is tomorrow's problem.
    await db()
      .insert(calendarEntries)
      .values({ accountId, scheduledFor: new Date('2026-08-26T22:00:00Z'), title: 'Late one' });

    expect((await currentAlerts(accountId, now)).alerts).toEqual([]);
    expect(riyadhDayRange(now).end.toISOString()).toBe('2026-08-26T21:00:00.000Z');
  });

  it('stops flagging once the post is marked posted', async () => {
    const [entry] = await db()
      .insert(calendarEntries)
      .values({ accountId, scheduledFor: riyadhInstant('2026-08-26', '18:00'), title: 'Done' })
      .returning();

    await db()
      .update(calendarEntries)
      .set({ status: 'published' })
      .where(sql`id = ${entry!.id}`);

    expect((await currentAlerts(accountId, now)).alerts).toEqual([]);
  });

  it('gives each alert an identity that changes when the news does', async () => {
    // Dismissing "you lost 9 followers" must not silence tomorrow's movement.
    await db()
      .insert(accountDaily)
      .values([
        { accountId, day: '2026-08-25', followersTotal: 4885 },
        { accountId, day: '2026-08-26', followersTotal: 4876 },
      ]);
    const first = (await currentAlerts(accountId, now)).alerts[0]?.id;

    await db()
      .insert(accountDaily)
      .values([{ accountId, day: '2026-08-27', followersTotal: 4870 }]);
    const second = (await currentAlerts(accountId, now)).alerts[0]?.id;

    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });
});
