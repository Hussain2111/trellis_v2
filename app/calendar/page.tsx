import { selfAccountId } from '@/lib/chat/threads';
import { groupByWeek, listEntries } from '@/lib/calendar/entries';
import { CalendarView, type Entry } from '@/components/calendar-view';
import { NewEntryForm } from '@/components/new-entry-form';
import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';
import { formatRiyadh, formatRiyadhDate } from '@/lib/time';

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

  const entries = await listEntries(accountId);
  const overdue = entries.filter((e) => e.state === 'overdue');

  const weeks = groupByWeek(entries).map((week) => ({
    label: `Week of ${formatRiyadhDate(new Date(week.weekStart))}`,
    entries: week.entries.map((entry): Entry => ({
      id: entry.id,
      scheduledFor: entry.scheduledFor.toISOString(),
      scheduledLabel: formatRiyadh(entry.scheduledFor),
      state: entry.state,
      format: entry.format,
      title: entry.title,
      hook: entry.hook,
      caption: entry.caption,
      hashtags: entry.hashtags,
      notes: entry.notes,
    })),
  }));

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Header />
        <NewEntryForm />
      </div>

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

      {weeks.length === 0 ? (
        <Panel>
          <PanelHeader title="Nothing scheduled" />
          <EmptyState title="No posts planned">
            Add a date and a draft. Every field gets a copy button, so posting means pasting rather
            than retyping.
          </EmptyState>
        </Panel>
      ) : (
        <CalendarView weeks={weeks} />
      )}
    </main>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
      <p className="mt-1 text-sm text-[--color-ink-muted]">
        What you plan to post, and when. Times are Riyadh.
      </p>
    </header>
  );
}
