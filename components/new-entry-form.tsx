'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Entries are added by hand. Nothing here proposes a schedule. */
export function NewEntryForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(form: FormData) {
    setSaving(true);
    try {
      const hashtags = String(form.get('hashtags') ?? '')
        .split(/[\s,]+/)
        .map((tag) => tag.trim())
        .filter(Boolean);

      await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scheduledFor: new Date(String(form.get('scheduledFor'))).toISOString(),
          format: String(form.get('format') || '') || undefined,
          title: String(form.get('title') || '') || undefined,
          hook: String(form.get('hook') || '') || undefined,
          caption: String(form.get('caption') || '') || undefined,
          notes: String(form.get('notes') || '') || undefined,
          hashtags,
        }),
      });
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-[--color-accent] px-4 py-2 text-sm font-medium text-white"
      >
        Add a post
      </button>
    );
  }

  return (
    <form
      action={submit}
      className="space-y-3 rounded-xl border border-[--color-rule] bg-[--color-card] p-5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="When (your time)">
          <input
            required
            type="datetime-local"
            name="scheduledFor"
            className="w-full rounded-lg border border-[--color-rule] bg-[--color-paper] px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Format">
          <select
            name="format"
            className="w-full rounded-lg border border-[--color-rule] bg-[--color-paper] px-3 py-2 text-sm"
          >
            <option value="">—</option>
            <option value="carousel">Carousel</option>
            <option value="reel">Reel</option>
            <option value="image">Photo</option>
          </select>
        </Field>
      </div>

      <Field label="Title">
        <input
          name="title"
          className="w-full rounded-lg border border-[--color-rule] bg-[--color-paper] px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Hook">
        <input
          name="hook"
          className="w-full rounded-lg border border-[--color-rule] bg-[--color-paper] px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Caption">
        <textarea
          name="caption"
          rows={4}
          className="w-full rounded-lg border border-[--color-rule] bg-[--color-paper] px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Hashtags">
        <input
          name="hashtags"
          placeholder="#kbeauty #skincare"
          className="w-full rounded-lg border border-[--color-rule] bg-[--color-paper] px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Notes">
        <textarea
          name="notes"
          rows={2}
          className="w-full rounded-lg border border-[--color-rule] bg-[--color-paper] px-3 py-2 text-sm"
        />
      </Field>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-[--color-accent] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-[--color-rule] px-4 py-2 text-sm text-[--color-ink-muted]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-[--color-ink-faint]">
        {label}
      </span>
      {children}
    </label>
  );
}
