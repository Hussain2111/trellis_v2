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
 * Clicking hands the note to the chat, which opens a conversation with the note
 * already in it as the first thing said. What crosses that boundary is the
 * note's own validated text plus a REFERENCE to it — never the evidence behind
 * it. The chat re-resolves the card through a tool call so its figures arrive
 * as a tool result, which is what the validator checks the next answer against.
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

export interface CitedPost {
  id: number;
  permalink: string | null;
  published: string | null;
  format: string;
  caption: string | null;
}

export function StickyNote({
  id,
  body,
  index,
  citedPosts,
}: {
  id: number;
  body: string;
  index: number;
  citedPosts: CitedPost[];
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
      router.push(`/chat?thread=${thread.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      style={{
        background: TINTS[index % TINTS.length],
        rotate: ROTATIONS[index % ROTATIONS.length],
      }}
      className="group relative flex min-h-[10rem] flex-col justify-between rounded-[--radius-note] p-5 shadow-[--shadow-note] transition-transform duration-150 hover:-translate-y-1 hover:shadow-[--shadow-lift]"
    >
      {/* The whole note is the target, but the post chips inside it are real
          links — so the note's own click surface sits underneath rather than
          wrapping them. A link inside a button is not a thing. */}
      <button
        type="button"
        onClick={openInChat}
        disabled={busy}
        aria-label="Ask about this note"
        className="absolute inset-0 z-0 rounded-[--radius-note]"
      />

      <div className="pointer-events-none relative z-10">
        <p className="text-[15px] leading-relaxed text-[--color-ink]">{body}</p>

        {citedPosts.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {citedPosts.map((post) => (
              <PostChip key={post.id} post={post} />
            ))}
          </div>
        ) : null}
      </div>

      <span className="relative z-10 mt-4 text-xs text-[--color-ink-muted] opacity-0 transition-opacity group-hover:opacity-100">
        {busy ? 'Opening…' : 'Ask about this →'}
      </span>
    </article>
  );
}

/**
 * A post named the way its author knows it: when it went up, and what it was
 * about. Never "post 94" — that is a row id in a database they have never seen.
 */
function PostChip({ post }: { post: CitedPost }) {
  const label = describePost(post);
  if (!post.permalink) {
    return (
      <span className="rounded-full bg-[--color-card]/60 px-2 py-1 text-[11px] text-[--color-ink-muted]">
        {label}
      </span>
    );
  }
  return (
    <a
      href={post.permalink}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className="pointer-events-auto max-w-full truncate rounded-full bg-[--color-card]/70 px-2 py-1 text-[11px] text-[--color-ink-muted] transition-colors hover:bg-[--color-card] hover:text-[--color-ink]"
    >
      {label} ↗
    </a>
  );
}

const FORMAT_WORDS: Record<string, string> = {
  IMAGE: 'photo',
  VIDEO: 'reel',
  CAROUSEL_ALBUM: 'carousel',
};

function describePost(post: CitedPost): string {
  const when = post.published ? shortDate(post.published) : null;
  const kind = FORMAT_WORDS[post.format] ?? post.format.toLowerCase();
  const subject = post.caption?.split('\n')[0]?.replace(/#\w+/g, '').trim().slice(0, 34);
  return [when, kind, subject ? `“${subject}${subject.length === 34 ? '…' : ''}”` : null]
    .filter(Boolean)
    .join(' · ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD` is already a Riyadh day key from SQL — no instant, no arithmetic. */
function shortDate(day: string): string {
  const [year, month, date] = day.split('-');
  const name = MONTHS[Number(month) - 1] ?? month;
  return `${Number(date)} ${name} ${year}`;
}
