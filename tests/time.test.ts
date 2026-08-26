import { describe, expect, it } from 'vitest';
import {
  entryState,
  formatRiyadh,
  monthLabel,
  riyadhDayKey,
  riyadhDayStart,
  riyadhInstant,
  riyadhMonthMatrix,
  riyadhTimeOfDay,
  riyadhWeekStart,
  shiftMonth,
} from '../lib/time';

describe('Riyadh boundaries', () => {
  it('files 22:00 Sunday UTC into the Monday that has already begun in Riyadh', () => {
    // The case that breaks a naive sort. 2026-08-16 is a Sunday.
    const stored = new Date('2026-08-16T22:00:00Z');

    expect(formatRiyadh(stored)).toBe('Mon 17 Aug, 01:00');
    expect(riyadhDayKey(stored)).toBe('2026-08-17');
    // Monday 00:00 Riyadh is 21:00 the previous day UTC.
    expect(riyadhWeekStart(stored).toISOString()).toBe('2026-08-16T21:00:00.000Z');
  });

  it('keeps 20:00 Sunday UTC in the previous week', () => {
    const stored = new Date('2026-08-16T20:00:00Z');
    expect(formatRiyadh(stored)).toBe('Sun 16 Aug, 23:00');
    expect(riyadhWeekStart(stored).toISOString()).toBe('2026-08-09T21:00:00.000Z');
  });

  it('starts weeks on Monday, not Sunday', () => {
    // A Monday afternoon is its own week start, not the Sunday before it.
    const monday = new Date('2026-08-17T12:00:00Z');
    expect(riyadhWeekStart(monday).toISOString()).toBe('2026-08-16T21:00:00.000Z');
    // The Sunday after belongs to the same week.
    const sunday = new Date('2026-08-23T12:00:00Z');
    expect(riyadhWeekStart(sunday).toISOString()).toBe('2026-08-16T21:00:00.000Z');
  });

  it('starts days at 21:00 UTC the day before', () => {
    expect(riyadhDayStart(new Date('2026-08-17T12:00:00Z')).toISOString()).toBe(
      '2026-08-16T21:00:00.000Z',
    );
  });

  it('crosses a month boundary correctly', () => {
    const stored = new Date('2026-08-31T22:00:00Z');
    expect(riyadhDayKey(stored)).toBe('2026-09-01');
    expect(formatRiyadh(stored)).toBe('Tue 1 Sep, 01:00');
  });
});

describe('entryState', () => {
  const now = new Date('2026-08-17T12:00:00Z');

  it('is planned when it is far off', () => {
    expect(entryState(new Date('2026-08-25T12:00:00Z'), { now })).toBe('planned');
  });

  it('is due inside the window', () => {
    expect(entryState(new Date('2026-08-18T06:00:00Z'), { now })).toBe('due');
  });

  it('is overdue once the moment has passed', () => {
    expect(entryState(new Date('2026-08-17T11:00:00Z'), { now })).toBe('overdue');
  });

  it('is published regardless of the clock', () => {
    expect(entryState(new Date('2026-08-01T00:00:00Z'), { now, published: true })).toBe(
      'published',
    );
  });
});

describe('the month grid', () => {
  it('always returns six Monday-start weeks', () => {
    for (const month of ['2026-02', '2026-08', '2027-01']) {
      const weeks = riyadhMonthMatrix(month);
      expect(weeks).toHaveLength(6);
      expect(weeks.every((week) => week.length === 7)).toBe(true);
    }
  });

  it('starts the grid on the Monday on or before the 1st', () => {
    // 1 August 2026 is a Saturday, so the grid opens on Monday 27 July.
    expect(riyadhMonthMatrix('2026-08')[0]?.[0]).toBe('2026-07-27');
    expect(riyadhMonthMatrix('2026-08')[0]?.[5]).toBe('2026-08-01');
  });

  it('runs consecutively with no gaps or repeats', () => {
    const days = riyadhMonthMatrix('2026-08').flat();
    expect(new Set(days).size).toBe(42);
    for (let i = 1; i < days.length; i++) {
      const previous = new Date(`${days[i - 1]}T00:00:00Z`).getTime();
      expect(new Date(`${days[i]}T00:00:00Z`).getTime() - previous).toBe(86_400_000);
    }
  });

  it('steps months across a year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthLabel('2026-08')).toBe('August 2026');
  });
});

describe('Riyadh wall time to instant', () => {
  // The boundary is the bug, not the offset. 01:00 Monday Riyadh is 22:00
  // Sunday UTC, and this is the conversion that decides which week it files in.
  it('stores a Riyadh wall time as the right instant', () => {
    expect(riyadhInstant('2026-08-17', '01:00').toISOString()).toBe('2026-08-16T22:00:00.000Z');
    expect(riyadhInstant('2026-08-17', '12:00').toISOString()).toBe('2026-08-17T09:00:00.000Z');
  });

  it('round-trips through the day key and the time of day', () => {
    const instant = riyadhInstant('2026-08-17', '01:00');
    expect(riyadhDayKey(instant)).toBe('2026-08-17');
    expect(riyadhTimeOfDay(instant)).toBe('01:00');
    expect(riyadhWeekStart(instant).toISOString()).toBe('2026-08-16T21:00:00.000Z');
  });

  it('defaults to midday, which cannot fall into the wrong day either way', () => {
    expect(riyadhDayKey(riyadhInstant('2026-08-17'))).toBe('2026-08-17');
  });
});
