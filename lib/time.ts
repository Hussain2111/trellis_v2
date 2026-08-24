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
