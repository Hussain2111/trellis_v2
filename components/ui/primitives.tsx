import type { ReactNode } from 'react';

/**
 * Empty and thin-data states are components, not leftovers.
 *
 * This product is sparse on day one by design and possibly for a while. A blank
 * that explains itself is the product working, so the explaining is built in
 * rather than being whatever is left when data is missing.
 */

export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[--color-rule] bg-[--color-card] shadow-sm">
      {children}
    </section>
  );
}

export function PanelHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <header className="flex items-baseline justify-between gap-3 border-b border-[--color-rule] px-5 py-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {aside ? <div className="text-xs text-[--color-ink-faint]">{aside}</div> : null}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-medium text-[--color-ink-muted]">{title}</p>
      {children ? (
        <p className="mx-auto mt-2 max-w-sm text-sm text-[--color-ink-faint]">{children}</p>
      ) : null}
    </div>
  );
}

/**
 * A number, or an honest blank.
 *
 * `value === null` renders an em dash and, on request, why. It never renders 0
 * for an unknown — summing an empty series gives 0, which reads as "you held
 * steady", a different and false claim.
 */
export function Stat({
  label,
  value,
  unknownReason,
  sample,
}: {
  label: string;
  value: number | string | null;
  unknownReason?: string;
  sample?: { total: number; measured: number };
}) {
  const known = value !== null && value !== undefined;
  return (
    <div className="px-5 py-4">
      <div className="text-xs uppercase tracking-wide text-[--color-ink-faint]">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold">
        {known ? value : <span className="text-[--color-ink-faint]">—</span>}
      </div>
      {!known && unknownReason ? (
        <div className="mt-1 text-xs text-[--color-ink-faint]">{unknownReason}</div>
      ) : null}
      {known && sample ? <SampleNote {...sample} /> : null}
    </div>
  );
}

/**
 * Every median or aggregate declares its real sample size. `17 posts (2
 * measured)`, never `17 posts` — the population count is not the sample the
 * figure was computed from, and conflating them overstates the claim.
 */
export function SampleNote({ total, measured }: { total: number; measured: number }) {
  if (measured === total) {
    return (
      <div className="mt-1 text-xs text-[--color-ink-faint]">
        {total} {total === 1 ? 'post' : 'posts'}
      </div>
    );
  }
  return (
    <div className="mt-1 text-xs text-[--color-ink-faint]">
      {total} {total === 1 ? 'post' : 'posts'}{' '}
      <span className="text-[--color-accent]">({measured} measured)</span>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  const tones = {
    neutral: 'bg-[--color-paper-sunk] text-[--color-ink-muted]',
    good: 'bg-[--color-accent-soft] text-[--color-ink]',
    bad: 'bg-[--color-accent-soft] text-[--color-negative]',
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
