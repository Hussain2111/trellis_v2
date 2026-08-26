'use client';

import { useState } from 'react';

/**
 * The point of the calendar.
 *
 * Success is going from "this is due" to "posted on Instagram" without
 * retyping anything, so every field a creator needs to paste has its own copy
 * button. One button for the whole draft would not do — Instagram takes the
 * caption and the hashtags in different places.
 */
export function CopyField({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string | null;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (!value) {
    return (
      <div className="py-2">
        <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
        <div className="mt-1 text-sm text-ink-faint">—</div>
      </div>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be refused; the text is on screen and selectable anyway.
    }
  }

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-full border border-rule px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-paper-sunk"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className={`mt-1 text-sm text-ink ${multiline ? 'whitespace-pre-wrap' : 'truncate'}`}>
        {value}
      </div>
    </div>
  );
}
