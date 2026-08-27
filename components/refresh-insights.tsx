'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Notes are generated on a schedule and cached — never on page load, which
 * would burn the rate limit and make the page slow for something that changes
 * once a day.
 *
 * But a creator who has just posted should not have to wait until tomorrow, so
 * refreshing is available on explicit intent. It is deliberately a button and
 * not an effect.
 */
export function RefreshInsights() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');
  const [note, setNote] = useState<string | null>(null);

  async function refresh() {
    setState('working');
    setNote(null);
    try {
      const res = await fetch('/api/insights', { method: 'POST' });
      // Not every failure answers in JSON. Parsing one that does not used to
      // throw into the catch below and report a network problem.
      const body = (await res.json().catch(() => null)) ?? {};
      if (!res.ok) {
        // Over the request limit is a wait, not a breakage. Saying "try again
        // in 40 seconds" is a different instruction from "that failed", and
        // only one of them is worth acting on.
        setState('error');
        setNote(
          body.retryAfterSeconds
            ? `Over the request limit. Try again in about ${body.retryAfterSeconds} seconds.`
            : (body.message ?? body.reason ?? `The server returned an error (${res.status}).`),
        );
        return;
      }
      setState('idle');
      if (body.kept === 0) setNote(body.reason ?? 'Nothing the data could support.');
      else if (body.dropped > 0)
        setNote(`${body.dropped} note(s) dropped — figures not in the data.`);
      router.refresh();
    } catch {
      setState('error');
      setNote('Could not reach the server — the request never completed.');
    }
  }

  return (
    <div className="flex items-center gap-3">
      {note ? <span className="text-xs text-ink-faint">{note}</span> : null}
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={state === 'working'}
        className="rounded-full border border-rule px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-paper-sunk disabled:opacity-50"
      >
        {state === 'working' ? 'Thinking…' : 'Refresh'}
      </button>
    </div>
  );
}
