'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PlusIcon, TrashIcon } from './icons';

export interface ThreadSummary {
  id: number;
  title: string | null;
  fromNote: boolean;
  updatedLabel: string;
}

/**
 * Conversations are kept, listed, and deleted on purpose.
 *
 * Before this existed the chat showed whichever thread was most recent and gave
 * you no way back to any other, so opening a note — which creates a thread —
 * looked exactly like the previous conversation being erased. Nothing was ever
 * being deleted; there was simply nowhere to see it.
 */
export function ChatSidebar({ threads, activeId }: { threads: ThreadSummary[]; activeId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function newChat() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/chat/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const { thread } = await res.json();
      router.push(`/chat?thread=${thread.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    try {
      await fetch(`/api/chat/threads/${id}`, { method: 'DELETE' });
      if (id === activeId) router.push('/chat');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <button
        type="button"
        onClick={() => void newChat()}
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-xl border border-rule bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-accent disabled:opacity-50"
      >
        <PlusIcon className="size-4" />
        New chat
      </button>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {threads.map((thread) => {
          const active = thread.id === activeId;
          return (
            <li key={thread.id} className="group relative">
              <Link
                href={`/chat?thread=${thread.id}`}
                className={`block rounded-lg py-2 pl-3 pr-9 text-sm transition-colors ${
                  active ? 'bg-accent-soft text-ink' : 'text-ink-muted hover:bg-paper-sunk'
                }`}
              >
                <span className="block truncate">
                  {thread.fromNote ? '📌 ' : ''}
                  {thread.title ?? 'New chat'}
                </span>
                <span className="mt-0.5 block text-xs text-ink-faint">{thread.updatedLabel}</span>
              </Link>
              <button
                type="button"
                onClick={() => void remove(thread.id)}
                disabled={busy}
                aria-label={`Delete ${thread.title ?? 'this chat'}`}
                className="absolute right-1.5 top-2 rounded-md p-1.5 text-ink-faint opacity-0 transition-opacity hover:text-negative focus-visible:opacity-100 group-hover:opacity-100"
              >
                <TrashIcon className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
