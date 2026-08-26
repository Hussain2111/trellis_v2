'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyField } from './copy-field';

export interface Entry {
  id: number;
  scheduledFor: string;
  scheduledLabel: string;
  state: 'planned' | 'due' | 'overdue' | 'published';
  format: string | null;
  title: string | null;
  hook: string | null;
  caption: string | null;
  hashtags: string[] | null;
  notes: string | null;
}

const STATE_STYLES: Record<Entry['state'], string> = {
  planned: 'bg-[--color-paper-sunk] text-[--color-ink-muted]',
  due: 'bg-[--color-accent-soft] text-[--color-ink]',
  overdue: 'bg-[--color-accent-soft] text-[--color-negative]',
  published: 'bg-[--color-paper-sunk] text-[--color-ink-faint]',
};

const STATE_LABELS: Record<Entry['state'], string> = {
  planned: 'Planned',
  due: 'Due soon',
  overdue: 'Overdue',
  published: 'Posted',
};

export function CalendarView({ weeks }: { weeks: { label: string; entries: Entry[] }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const router = useRouter();

  async function act(id: number, body: object) {
    await fetch(`/api/calendar/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    router.refresh();
  }

  async function remove(id: number) {
    await fetch(`/api/calendar/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="space-y-8">
      {weeks.map((week) => (
        <section key={week.label}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[--color-ink-faint]">
            {week.label}
          </h3>
          <div className="space-y-3">
            {week.entries.map((entry) => (
              <article
                key={entry.id}
                className="overflow-hidden rounded-xl border border-[--color-rule] bg-[--color-card]"
              >
                <button
                  type="button"
                  onClick={() => setOpen(open === entry.id ? null : entry.id)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLES[entry.state]}`}
                      >
                        {STATE_LABELS[entry.state]}
                      </span>
                      <span className="text-xs text-[--color-ink-faint]">
                        {entry.scheduledLabel}
                        {entry.format ? ` · ${entry.format}` : ''}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">
                      {entry.title || entry.hook || 'Untitled draft'}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-[--color-ink-faint]">
                    {open === entry.id ? 'Close' : 'Open'}
                  </span>
                </button>

                {open === entry.id ? (
                  <div className="border-t border-[--color-rule] px-5 pb-4">
                    <div className="divide-y divide-[--color-rule]">
                      <CopyField label="Hook" value={entry.hook} />
                      <CopyField label="Caption" value={entry.caption} multiline />
                      <CopyField
                        label="Hashtags"
                        value={entry.hashtags?.length ? entry.hashtags.join(' ') : null}
                      />
                      <CopyField label="Notes" value={entry.notes} multiline />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {entry.state !== 'published' ? (
                        <button
                          type="button"
                          onClick={() => void act(entry.id, { action: 'publish' })}
                          className="rounded-full bg-[--color-accent] px-4 py-2 text-xs font-medium text-white"
                        >
                          Mark posted
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void remove(entry.id)}
                        className="rounded-full border border-[--color-rule] px-4 py-2 text-xs font-medium text-[--color-ink-muted]"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
