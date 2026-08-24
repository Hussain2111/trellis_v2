import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return (
    <main className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-[--color-ink-muted]">
          What your account is doing, and what you could do about it.
        </p>
      </header>

      <Panel>
        <PanelHeader title="Opportunities" />
        <EmptyState title="Nothing to show yet">
          Insight cards are generated on a schedule from your own account data, once there is enough
          of it to say something real. Four honest cards beat six padded ones, so this stays empty
          until then.
        </EmptyState>
      </Panel>

      <Panel>
        <PanelHeader title="Your account" />
        <EmptyState title="No data synced yet">
          Follower history builds one day at a time from the daily sync. It has not run.
        </EmptyState>
      </Panel>
    </main>
  );
}
