import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from './db/client';
import { calendarEntries } from './db/schema';
import { formatRiyadhDate, riyadhDayRange } from './time';

/**
 * In-app alerts. No email, no push, no external service.
 *
 * Four things are worth interrupting someone for: their follower count moved,
 * a post is due today, or one has slipped past. Everything else is something
 * they can go and look at.
 *
 * The honesty rules apply here more than anywhere, because an alert is read in
 * one second and believed. Two in particular:
 *
 *   A follower alert reports a NET change between two readings this app took
 *   itself. Instagram publishes no follower list, no follow or unfollow events
 *   and no webhook for either, so there is no way to know who, and no way to
 *   separate three arrivals and twelve departures from a bare loss of nine.
 *   The wording says net, and never implies a person.
 *
 *   No reading, no alert. A first sync with nothing to compare against is
 *   silence, not "no change" — those are different claims.
 */

export type AlertTone = 'positive' | 'negative' | 'neutral';

export interface Alert {
  /**
   * Stable for as long as the alert means the same thing, and different the
   * moment it does not. Dismissing "you lost 9 followers on the 26th" must not
   * also dismiss tomorrow's, so the figures are part of the identity.
   */
  id: string;
  kind: 'followers_up' | 'followers_down' | 'due_today' | 'overdue';
  tone: AlertTone;
  title: string;
  detail?: string;
  /** A literal union rather than a string, so typed routes can check it. */
  href?: '/' | '/chat' | '/calendar';
}

export interface AlertsResult {
  alerts: Alert[];
  /** The nav badge's number, served by the same request rather than a second one. */
  overdue: number;
}

export async function currentAlerts(accountId: number, now = new Date()): Promise<AlertsResult> {
  const [followers, calendar] = await Promise.all([
    followerMove(accountId),
    calendarAlerts(accountId, now),
  ]);

  return {
    alerts: [...followers, ...calendar.alerts],
    overdue: calendar.overdue,
  };
}

/**
 * The two most recent readings of the profile's own follower total.
 *
 * Not Meta's `follower_count` metric, which is not a running total — see
 * `lib/dashboard/metrics.ts`. These are readings this app took, so a gap in
 * syncing shows up as a comparison across a longer span rather than as a wrong
 * number, and the alert says which two days it is comparing.
 */
async function followerMove(accountId: number): Promise<Alert[]> {
  const readings = (await db().execute(sql`
    select day, followers_total as total
    from account_daily
    where account_id = ${accountId} and followers_total is not null
    order by day desc
    limit 2
  `)) as unknown as { day: string; total: number }[];

  const [latest, previous] = readings;
  if (!latest || !previous) return [];

  const change = latest.total - previous.total;
  if (change === 0) return [];

  const size = Math.abs(change);
  const people = `${size} ${size === 1 ? 'follower' : 'followers'}`;

  return [
    {
      id: `followers:${latest.day}:${change}`,
      kind: change < 0 ? 'followers_down' : 'followers_up',
      tone: change < 0 ? 'negative' : 'positive',
      title: change < 0 ? `You lost ${people}` : `You gained ${people}`,
      // Net, and said so. Instagram will not tell anyone who, and a total that
      // fell by nine could be nine departures or twelve against three arrivals.
      detail:
        `Net change between ${dayLabel(previous.day)} and ${dayLabel(latest.day)}, ` +
        `now ${latest.total.toLocaleString('en-US')}. Instagram doesn't say who.`,
      href: '/',
    },
  ];
}

async function calendarAlerts(
  accountId: number,
  now: Date,
): Promise<{ alerts: Alert[]; overdue: number }> {
  const { end } = riyadhDayRange(now);

  // Due today means still ahead of you today. Anything already past its time is
  // overdue, and being told a thing is both is being told nothing.
  const [due, overdue] = await Promise.all([
    db()
      .select({ id: calendarEntries.id, title: calendarEntries.title, hook: calendarEntries.hook })
      .from(calendarEntries)
      .where(
        and(
          eq(calendarEntries.accountId, accountId),
          eq(calendarEntries.status, 'planned'),
          gte(calendarEntries.scheduledFor, now),
          lt(calendarEntries.scheduledFor, end),
        ),
      )
      .orderBy(asc(calendarEntries.scheduledFor)),
    db()
      .select({ id: calendarEntries.id, title: calendarEntries.title, hook: calendarEntries.hook })
      .from(calendarEntries)
      .where(
        and(
          eq(calendarEntries.accountId, accountId),
          eq(calendarEntries.status, 'planned'),
          lt(calendarEntries.scheduledFor, now),
        ),
      )
      .orderBy(asc(calendarEntries.scheduledFor)),
  ]);

  const alerts: Alert[] = [];
  const today = formatRiyadhDate(now);

  if (due.length > 0) {
    alerts.push({
      id: `due:${today}:${due.map((entry) => entry.id).join(',')}`,
      kind: 'due_today',
      tone: 'neutral',
      title: `${due.length} post${due.length === 1 ? '' : 's'} due today`,
      detail: names(due),
      href: '/calendar',
    });
  }

  if (overdue.length > 0) {
    alerts.push({
      id: `overdue:${today}:${overdue.map((entry) => entry.id).join(',')}`,
      kind: 'overdue',
      tone: 'negative',
      title:
        overdue.length === 1 ? '1 post past its time' : `${overdue.length} posts past their time`,
      detail: names(overdue),
      href: '/calendar',
    });
  }

  return { alerts, overdue: overdue.length };
}

function names(entries: { title: string | null; hook: string | null }[]): string {
  const shown = entries.slice(0, 3).map((entry) => entry.title || entry.hook || 'Untitled draft');
  const rest = entries.length - shown.length;
  return rest > 0 ? `${shown.join(' · ')} and ${rest} more` : shown.join(' · ');
}

/** `YYYY-MM-DD` is already a Riyadh day key — no instant, no arithmetic. */
function dayLabel(day: string): string {
  return formatRiyadhDate(new Date(`${day}T12:00:00Z`));
}
