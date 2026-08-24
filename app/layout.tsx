import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trellis',
  description: 'What your Instagram account is actually doing.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Nav />
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
