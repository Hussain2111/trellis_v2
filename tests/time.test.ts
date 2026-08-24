import { describe, expect, it } from 'vitest';
import {
  entryState,
  formatRiyadh,
  riyadhDayKey,
  riyadhDayStart,
  riyadhWeekStart,
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
