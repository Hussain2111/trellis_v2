/**
 * Every date decision in this app goes through here.
 *
 * Timestamps are stored UTC and rendered in `Asia/Riyadh`. Riyadh is UTC+3 with
 * no daylight saving (it has had none since 1990), so a fixed offset is correct
 * and no timezone library is needed.
 *
 * The boundary is the bug, not the offset. An entry at 01:00 Monday Riyadh is
 * 22:00 Sunday UTC, and a naive sort files it in the previous week. Nothing
 * outside this module does arithmetic on dates.
 */

export const RIYADH_OFFSET_MINUTES = 180;
const OFFSET_MS = RIYADH_OFFSET_MINUTES * 60_000;

/**
 * Shift an instant so that reading it with `getUTC*` yields the Riyadh wall
 * clock. The returned Date is a calculation vehicle, not a real instant — never
 * let one escape this module.
 */
function shift(date: Date): Date {
  return new Date(date.getTime() + OFFSET_MS);
}

/** `YYYY-MM-DD` for the Riyadh day an instant falls in. */
export function riyadhDayKey(date: Date): string {
  return shift(date).toISOString().slice(0, 10);
}

/** The instant at which the Riyadh week containing `date` began (Monday 00:00). */
export function riyadhWeekStart(date: Date): Date {
  const local = shift(date);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const midnightLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - daysSinceMonday,
  );
  return new Date(midnightLocal - OFFSET_MS);
}

/** The instant at which the Riyadh day containing `date` began. */
export function riyadhDayStart(date: Date): Date {
  const local = shift(date);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocal - OFFSET_MS);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** e.g. `Mon 17 Aug, 01:00`. */
export function formatRiyadh(date: Date): string {
  const local = shift(date);
  const day = DAYS[local.getUTCDay()];
  const month = MONTHS[local.getUTCMonth()];
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${day} ${local.getUTCDate()} ${month}, ${hh}:${mm}`;
}

/** e.g. `17 Aug 2026`. */
export function formatRiyadhDate(date: Date): string {
  const local = shift(date);
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()}`;
}

export type EntryState = 'planned' | 'due' | 'overdue' | 'published';

/**
 * Derived at read time, never stored. A status written to a row goes stale the
 * moment the clock passes it, and a stale "planned" on something three days
 * overdue is precisely the kind of believable-but-false statement this product
 * exists not to make.
 */
export function entryState(
  scheduledFor: Date,
  options: { published?: boolean; now?: Date; dueWithinHours?: number } = {},
): EntryState {
  if (options.published) return 'published';
  const now = options.now ?? new Date();
  const dueWindowMs = (options.dueWithinHours ?? 24) * 3_600_000;

  if (now.getTime() > scheduledFor.getTime()) return 'overdue';
  if (scheduledFor.getTime() - now.getTime() <= dueWindowMs) return 'due';
  return 'planned';
}

/**
 * `just now`, `2h ago`, `3d ago`, then an absolute date.
 *
 * Relative only while it is genuinely easier to read than the date itself.
 * Past a week "12d ago" stops meaning anything and the real date means more.
 */
export function relativeRiyadh(date: Date, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return formatRiyadhDate(date);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The Riyadh month an instant falls in, as `YYYY-MM`. */
export function riyadhMonthKey(date: Date): string {
  return riyadhDayKey(date).slice(0, 7);
}

/** `August 2026`, from a `YYYY-MM` key. */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
}

/** The month `delta` months away from a `YYYY-MM` key. */
export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1 + delta, 1));
  return shifted.toISOString().slice(0, 7);
}

/**
 * Six Monday-start weeks of `YYYY-MM-DD` day keys covering a month.
 *
 * Always six rows, always seven columns, whatever the month — a grid that
 * changes height as you page through the year is a grid that makes the whole
 * page jump. Days from the neighbouring months are included and the caller
 * tells them apart by comparing the key's `YYYY-MM` prefix.
 */
export function riyadhMonthMatrix(monthKey: string): string[][] {
  const [year, month] = monthKey.split('-').map(Number);
  const first = new Date(Date.UTC(year!, month! - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;

  const weeks: string[][] = [];
  for (let week = 0; week < 6; week++) {
    const days: string[] = [];
    for (let day = 0; day < 7; day++) {
      const cell = new Date(Date.UTC(year!, month! - 1, 1 - leading + week * 7 + day));
      days.push(cell.toISOString().slice(0, 10));
    }
    weeks.push(days);
  }
  return weeks;
}

/**
 * A Riyadh wall-clock time, as a real instant.
 *
 * `new Date('2026-09-01T18:00')` in a browser means 18:00 wherever that browser
 * happens to be. The calendar's times are Riyadh times — that is what the form
 * says and what every other reading in this app assumes — so the conversion
 * belongs here rather than being whatever the device's clock decided.
 */
export function riyadhInstant(dayKey: string, timeOfDay = '12:00'): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  const [hours, minutes] = timeOfDay.split(':').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, hours ?? 0, minutes ?? 0) - OFFSET_MS);
}

/** `18:00` — the Riyadh wall-clock time of an instant. */
export function riyadhTimeOfDay(date: Date): string {
  const local = shift(date);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * The instants a Riyadh day begins and ends, as a half-open range.
 *
 * `[start, end)` so a query can ask "is this today" without a second opinion
 * about whether midnight belongs to the day that ended or the one starting.
 * Riyadh has no daylight saving, so the day is exactly 24 hours and this is the
 * only place that gets to assume it.
 */
export function riyadhDayRange(date: Date): { start: Date; end: Date } {
  const start = riyadhDayStart(date);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
