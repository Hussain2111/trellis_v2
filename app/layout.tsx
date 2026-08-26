import type { Metadata } from 'next';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trellis',
  description: 'What your Instagram account is actually doing.',
};

/**
 * The layout does no database work, deliberately.
 *
 * It used to resolve the account and count overdue drafts here, for a badge.
 * The root layout wraps every route, so those two queries sat in front of every
 * first paint — and on a cold serverless function they ran before anything at
 * all appeared. The badge is worth showing; it is not worth blocking the app
 * behind. It now loads after the shell is on screen (see `Nav`).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Nav />
        <div className="pb-24 sm:pb-0 sm:pl-16">
          <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">{children}</div>
        </div>
      </body>
    </html>
  );
}
