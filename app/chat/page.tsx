import { ChatPanel } from '@/components/chat-panel';
import { createThread, listThreads, selfAccountId, threadMessages } from '@/lib/chat/threads';
import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const accountId = await selfAccountId();

  if (!accountId) {
    return (
      <main className="space-y-8">
        <Header />
        <Panel>
          <PanelHeader title="Not set up yet" />
          <EmptyState title="No account synced">
            The chat reads your own posts and follower history. Run the sync first and it will have
            something to reason about.
          </EmptyState>
        </Panel>
      </main>
    );
  }

  const threads = await listThreads(accountId);
  const thread = threads[0] ?? (await createThread(accountId));
  const history = await threadMessages(thread.id);

  return (
    <main className="space-y-6">
      <Header />
      <ChatPanel
        threadId={thread.id}
        initial={history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))}
      />
    </main>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
      <p className="mt-1 text-sm text-[--color-ink-muted]">
        Ask about your own account. Every number comes from your data, or it doesn&rsquo;t get said.
      </p>
    </header>
  );
}
