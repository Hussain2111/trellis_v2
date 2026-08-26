import { selfAccountId } from '@/lib/chat/threads';
import { listEntries } from '@/lib/calendar/entries';
import { MonthCalendar, type Entry } from '@/components/month-calendar';
import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';
import { formatRiyadh, riyadhDayKey, riyadhMonthKey, riyadhTimeOfDay } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const accountId = await selfAccountId();

  if (!accountId) {
    return (
      <main className="space-y-8">
        <Header />
        <Panel>
          <PanelHeader title="Not set up yet" />
          <EmptyState title="No account">Run the sync first.</EmptyState>
        </Panel>
      </main>
    );
  }

  const now = new Date();
  const entries = await listEntries(accountId);
  const overdue = entries.filter((e) => e.state === 'overdue');

  // Keyed to Riyadh days here, on the server, so the grid never has to know
  // what timezone the browser drawing it is in.
  const forGrid: Entry[] = entries.map((entry) => ({
    id: entry.id,
    dayKey: riyadhDayKey(entry.scheduledFor),
    timeLabel: riyadhTimeOfDay(entry.scheduledFor),
    state: entry.state,
    format: entry.format,
    title: entry.title,
    hook: entry.hook,
    caption: entry.caption,
    hashtags: entry.hashtags,
    notes: entry.notes,
  }));

  return (
    <main className="space-y-6">
      <Header />

      {overdue.length > 0 ? (
        <div className="rounded-xl border border-[--color-rule] bg-[--color-accent-soft] px-5 py-4">
          <p className="text-sm font-medium">
            {overdue.length} post{overdue.length === 1 ? '' : 's'} past their time
          </p>
          <p className="mt-1 text-sm text-[--color-ink-muted]">
            {overdue
              .slice(0, 3)
              .map((e) => e.title || e.hook || formatRiyadh(e.scheduledFor))
              .join(' · ')}
          </p>
        </div>
      ) : null}

      <MonthCalendar
        entries={forGrid}
        initialMonth={riyadhMonthKey(now)}
        todayKey={riyadhDayKey(now)}
      />
    </main>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
      <p className="mt-1 text-sm text-[--color-ink-muted]">
        What you plan to post, and when. Press the <span className="font-medium">+</span> on a day
        to add a draft to it.
      </p>
    </header>
  );
}
