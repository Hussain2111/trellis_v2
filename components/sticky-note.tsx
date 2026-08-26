'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The signature element.
 *
 * Restrained physicality on purpose — a slight rotation, a soft shadow, a warm
 * paper tint, and a lift on press. Paper texture and curled corners fight
 * legibility at phone width, which is where this is most often read.
 *
 * Clicking hands the note to the chat. What crosses that boundary is a
 * REFERENCE, not the evidence: the chat re-resolves the card so its figures
 * come back through a tool call, which is what the validator checks against. A
 * payload pasted into a prompt would be unbacked, and the chat would strip the
 * card's own numbers when repeating them.
 */
const TINTS = [
  'var(--color-note-1)',
  'var(--color-note-2)',
  'var(--color-note-3)',
  'var(--color-note-4)',
  'var(--color-note-5)',
  'var(--color-note-6)',
];

const ROTATIONS = ['-1.2deg', '0.8deg', '-0.5deg', '1.1deg', '-0.9deg', '0.4deg'];

export function StickyNote({
  id,
  body,
  index,
  citedPostIds,
}: {
  id: number;
  body: string;
  index: number;
  citedPostIds: number[] | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function openInChat() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/chat/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceCardId: id }),
      });
      const { thread } = await res.json();
      router.push(`/chat?thread=${thread.id}&card=${id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={openInChat}
      style={{
        background: TINTS[index % TINTS.length],
        rotate: ROTATIONS[index % ROTATIONS.length],
      }}
      className="group relative flex min-h-[10rem] w-full flex-col justify-between rounded-[--radius-note] p-5 text-left shadow-[--shadow-note] transition-transform duration-150 hover:-translate-y-1 hover:shadow-[--shadow-lift] active:translate-y-0 disabled:opacity-60"
      disabled={busy}
    >
      <p className="text-[15px] leading-relaxed text-[--color-ink]">{body}</p>
      <span className="mt-4 text-xs text-[--color-ink-muted] opacity-0 transition-opacity group-hover:opacity-100">
        {busy ? 'Opening…' : 'Ask about this →'}
        {citedPostIds?.length
          ? ` · ${citedPostIds.length} post${citedPostIds.length === 1 ? '' : 's'}`
          : ''}
      </span>
    </button>
  );
}
