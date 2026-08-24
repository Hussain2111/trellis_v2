import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  return (
    <main className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
        <p className="mt-1 text-sm text-[--color-ink-muted]">
          Ask about your own account. Every number comes from your data or is not given.
        </p>
      </header>

      <Panel>
        <PanelHeader title="Threads" />
        <EmptyState title="Not built yet">
          The chat reads your synced posts, insights, comments and follower history through tools.
          It arrives once the sync layer has something for it to read.
        </EmptyState>
      </Panel>
    </main>
  );
}
