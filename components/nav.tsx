'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Three items. The previous build had thirteen in a flat list.
 *
 * Bottom bar on mobile, sidebar rail on desktop — the calendar's "is something
 * due" question is asked from a phone, so mobile is the primary case rather
 * than the responsive afterthought.
 */
const ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/chat', label: 'Chat' },
  { href: '/calendar', label: 'Calendar' },
] as const;

export function Nav({ overdue = 0 }: { overdue?: number }) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-[--color-rule] bg-[--color-card] sm:inset-y-0 sm:right-auto sm:w-56 sm:border-r sm:border-t-0"
      aria-label="Main"
    >
      <div className="hidden px-5 py-6 sm:block">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Trellis
        </Link>
      </div>

      <ul className="flex sm:mt-2 sm:flex-col sm:gap-1 sm:px-3">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`block px-4 py-3 text-center text-sm font-medium sm:rounded-lg sm:text-left ${
                  active
                    ? 'text-[--color-accent] sm:bg-[--color-accent-soft] sm:text-[--color-ink]'
                    : 'text-[--color-ink-muted]'
                }`}
              >
                {item.label}
                {item.href === '/calendar' && overdue > 0 ? (
                  <span className="ml-1.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-[--color-accent] px-1 text-[10px] font-semibold text-white">
                    {overdue}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="hidden sm:absolute sm:bottom-4 sm:left-3 sm:right-3 sm:block">
        <Link
          href="/settings"
          className="block rounded-lg px-4 py-2 text-sm text-[--color-ink-faint]"
        >
          Settings
        </Link>
      </div>
    </nav>
  );
}
