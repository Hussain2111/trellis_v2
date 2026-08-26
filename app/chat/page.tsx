import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { chatThreads } from '@/lib/db/schema';
import { ChatPanel } from '@/components/chat-panel';
import { createThread, listThreads, selfAccountId, threadMessages } from '@/lib/chat/threads';
import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; card?: string }>;
}) {
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

  const params = await searchParams;
  const requested = params.thread ? Number(params.thread) : null;
  const cardId = params.card ? Number(params.card) : null;

  let thread = null;
  if (requested) {
    const [found] = await db()
      .select()
      .from(chatThreads)
      .where(eq(chatThreads.id, requested))
      .limit(1);
    thread = found ?? null;
  }
  if (!thread) {
    const threads = await listThreads(accountId);
    thread = threads[0] ?? (await createThread(accountId));
  }

  const history = await threadMessages(thread.id);

  return (
    <main className="space-y-6">
      <Header />
      <ChatPanel
        threadId={thread.id}
        // A card reference, never the card's evidence. The chat resolves it
        // through a tool so its figures arrive as a tool result — which is what
        // the validator checks the answer against.
        sourceCardId={cardId ?? thread.sourceCardId ?? null}
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
