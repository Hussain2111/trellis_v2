import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/nav';
import { overdueCount } from '@/lib/calendar/entries';
import { selfAccountId } from '@/lib/chat/threads';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trellis',
  description: 'What your Instagram account is actually doing.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Alerts are in-app only — a badge and a banner, no email and no push.
  const accountId = await selfAccountId().catch(() => null);
  const overdue = accountId ? await overdueCount(accountId).catch(() => 0) : 0;

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Nav overdue={overdue} />
        <div className="pb-20 sm:pb-0 sm:pl-56">
          <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
            <div className="mb-8 flex items-center justify-between sm:hidden">
              <span className="text-lg font-semibold tracking-tight">Trellis</span>
              <Link href="/settings" className="text-sm text-[--color-ink-faint]">
                Settings
              </Link>
            </div>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
