import { and, asc, count, eq, gte, lt, lte } from 'drizzle-orm';
import { db } from '../db/client';
import { calendarEntries, type CalendarEntry } from '../db/schema';
import { entryState, riyadhWeekStart, type EntryState } from '../time';

/**
 * The calendar. The only surface where the user does something rather than
 * reads something.
 *
 * `due` and `overdue` are DERIVED at read time and never stored. A status
 * written to a row goes stale the moment the clock passes it, and a stale
 * "planned" on something three days overdue is exactly the believable
 * falsehood this product exists not to produce.
 */

export interface DecoratedEntry extends CalendarEntry {
  state: EntryState;
  weekStart: string;
}

export function decorate(entry: CalendarEntry, now = new Date()): DecoratedEntry {
  return {
    ...entry,
    state: entryState(entry.scheduledFor, {
      published: entry.status === 'published',
      now,
    }),
    weekStart: riyadhWeekStart(entry.scheduledFor).toISOString(),
  };
}

export async function listEntries(
  accountId: number,
  options: { from?: Date; to?: Date } = {},
): Promise<DecoratedEntry[]> {
  const rows = await db()
    .select()
    .from(calendarEntries)
    .where(
      and(
        eq(calendarEntries.accountId, accountId),
        options.from ? gte(calendarEntries.scheduledFor, options.from) : undefined,
        options.to ? lte(calendarEntries.scheduledFor, options.to) : undefined,
      ),
    )
    .orderBy(asc(calendarEntries.scheduledFor));

  return rows.map((row) => decorate(row));
}

/** Grouped into Riyadh weeks — Monday-start, and the boundary is why lib/time.ts exists. */
export function groupByWeek(
  entries: DecoratedEntry[],
): { weekStart: string; entries: DecoratedEntry[] }[] {
  const weeks = new Map<string, DecoratedEntry[]>();
  for (const entry of entries) {
    const list = weeks.get(entry.weekStart) ?? [];
    list.push(entry);
    weeks.set(entry.weekStart, list);
  }
  return [...weeks.entries()]
    .map(([weekStart, list]) => ({ weekStart, entries: list }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * Counted in the database rather than by reading every planned entry and
 * filtering in memory. `overdue` is the one derived state expressible in SQL —
 * planned, and its time has passed — so the count costs one round trip and
 * carries no rows back with it.
 */
export async function overdueCount(accountId: number, now = new Date()): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(calendarEntries)
    .where(
      and(
        eq(calendarEntries.accountId, accountId),
        eq(calendarEntries.status, 'planned'),
        lt(calendarEntries.scheduledFor, now),
      ),
    );
  return row?.n ?? 0;
}

export interface EntryInput {
  scheduledFor: Date;
  format?: string | null;
  title?: string | null;
  hook?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
  notes?: string | null;
}

export async function createEntry(accountId: number, input: EntryInput) {
  const [row] = await db()
    .insert(calendarEntries)
    .values({ accountId, ...input, hashtags: input.hashtags ?? [] })
    .returning();
  return row!;
}

export async function updateEntry(accountId: number, id: number, input: Partial<EntryInput>) {
  const [row] = await db()
    .update(calendarEntries)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(calendarEntries.accountId, accountId), eq(calendarEntries.id, id)))
    .returning();
  return row ?? null;
}

export async function markPublished(accountId: number, id: number, postId?: number) {
  const [row] = await db()
    .update(calendarEntries)
    .set({
      status: 'published',
      publishedAt: new Date(),
      publishedPostId: postId ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(calendarEntries.accountId, accountId), eq(calendarEntries.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteEntry(accountId: number, id: number) {
  await db()
    .delete(calendarEntries)
    .where(and(eq(calendarEntries.accountId, accountId), eq(calendarEntries.id, id)));
}
