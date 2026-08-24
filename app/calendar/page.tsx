import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

export default function CalendarPage() {
  return (
    <main className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="mt-1 text-sm text-[--color-ink-muted]">
          What you plan to post, and when. Times are Riyadh.
        </p>
      </header>

      <Panel>
        <PanelHeader title="This week" />
        <EmptyState title="Not built yet">
          Drafts and posting dates, with a copy button on every field.
        </EmptyState>
      </Panel>
    </main>
  );
}
