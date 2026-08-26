'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CalendarIcon, ChatIcon, DashboardIcon, SettingsIcon } from './icons';

/**
 * Three destinations, as icons.
 *
 * The rail is narrow on purpose: the chat needs a sidebar of its own for its
 * threads, and two columns of text labels down the left of a phone-first app is
 * one column too many. Labels are still there for screen readers, still there
 * on hover, and still spelled out on mobile where there is width to spare and
 * no hover to reveal them.
 */
const ITEMS = [
  { href: '/', label: 'Dashboard', Icon: DashboardIcon },
  { href: '/chat', label: 'Chat', Icon: ChatIcon },
  { href: '/calendar', label: 'Calendar', Icon: CalendarIcon },
] as const;

/**
 * A clicked link has to react on the next frame, whatever the server is doing.
 *
 * Every route here reads the database on request, so there is real latency
 * between the click and the new page. `loading.tsx` covers the page area; this
 * covers the thing the finger actually landed on, so the nav never looks like
 * it ignored you.
 */
function Pending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="absolute right-1.5 top-1.5 size-1.5 animate-pulse rounded-full bg-[--color-accent]"
    />
  );
}

export function Nav() {
  const pathname = usePathname();
  const overdue = useOverdueCount();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-[--color-rule] bg-[--color-card] sm:inset-y-0 sm:right-auto sm:w-16 sm:border-r sm:border-t-0"
      aria-label="Main"
    >
      <Link
        href="/"
        className="hidden size-16 place-items-center text-lg font-semibold tracking-tight sm:grid"
        aria-label="Trellis home"
      >
        T
      </Link>

      <ul className="flex sm:flex-col sm:items-center sm:gap-1">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <li key={href} className="flex-1 sm:flex-none">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                title={label}
                className={`group relative flex flex-col items-center gap-1 px-2 py-3 text-[11px] font-medium transition-colors sm:size-11 sm:justify-center  sm:rounded-xl sm:p-0 ${
                  active
                    ? 'text-[--color-accent] sm:bg-[--color-accent-soft]'
                    : 'text-[--color-ink-faint] hover:text-[--color-ink]'
                }`}
              >
                <span className="relative">
                  <Icon />
                  {href === '/calendar' && overdue > 0 ? (
                    <span className="absolute -right-2 -top-1.5 inline-flex min-w-[1.05rem] items-center justify-center rounded-full bg-[--color-accent] px-1 text-[10px] font-semibold text-white">
                      {overdue}
                    </span>
                  ) : null}
                </span>
                <span className="sm:sr-only">{label}</span>
                <Pending />
              </Link>
            </li>
          );
        })}

        <li className="flex-1 sm:mt-auto sm:flex-none sm:pb-4">
          <Link
            href="/settings"
            title="Settings"
            className={`group relative flex flex-col items-center gap-1 px-2 py-3 text-[11px] font-medium transition-colors sm:size-11 sm:justify-center sm:rounded-xl sm:p-0 ${
              pathname === '/settings'
                ? 'text-[--color-accent] sm:bg-[--color-accent-soft]'
                : 'text-[--color-ink-faint] hover:text-[--color-ink]'
            }`}
          >
            <SettingsIcon />
            <span className="sm:sr-only">Settings</span>
            <Pending />
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/**
 * Fetched after the shell is on screen rather than awaited before it.
 *
 * A count of overdue drafts is useful; it is not worth a database round trip in
 * front of every first paint, which is where it used to live.
 */
function useOverdueCount(): number {
  const [overdue, setOverdue] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/calendar?view=overdue')
      .then((r) => (r.ok ? r.json() : { overdue: 0 }))
      .then((body: { overdue?: number }) => {
        if (!cancelled) setOverdue(body.overdue ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Re-read on navigation, so adding or posting a draft updates the badge.
  }, [pathname]);

  return overdue;
}
