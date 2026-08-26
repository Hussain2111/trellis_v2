import { selfAccountId } from '@/lib/chat/threads';
import { latestCards } from '@/lib/dashboard/generate';
import { followerChart, followsSummary, recentTotals } from '@/lib/dashboard/metrics';
import { accountOverview } from '@/lib/chat/queries';
import { StickyNote } from '@/components/sticky-note';
import { RefreshInsights } from '@/components/refresh-insights';
import { EmptyState, Panel, PanelHeader, Stat } from '@/components/ui/primitives';
import { formatRiyadhDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const accountId = await selfAccountId();

  if (!accountId) {
    return (
      <main className="space-y-8">
        <Header handle={null} />
        <Panel>
          <PanelHeader title="Nothing synced yet" />
          <EmptyState title="No account">
            Run <span className="font-mono">npm run setup:account</span>, then the Sync workflow.
          </EmptyState>
        </Panel>
      </main>
    );
  }

  const [overview, { batch, cards }, followers, totals, follows] = await Promise.all([
    accountOverview(accountId),
    latestCards(accountId),
    followerChart(accountId, 30),
    recentTotals(accountId, 30),
    followsSummary(accountId, 30),
  ]);

  return (
    <main className="space-y-10">
      <Header handle={overview.handle} />

      <section>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold">Opportunities</h2>
          <RefreshInsights />
        </div>

        {cards.length > 0 ? (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card, i) => (
                <StickyNote
                  key={card.id}
                  id={card.id}
                  body={card.body}
                  index={i}
                  citedPosts={card.citedPosts}
                />
              ))}
            </div>
            {/* Fewer than six is the honest outcome, not a failure — so say so
                rather than leaving a gap that reads as something missing. */}
            {cards.length < 4 ? (
              <p className="mt-4 text-xs text-[--color-ink-faint]">
                {cards.length} note{cards.length === 1 ? '' : 's'} this time. The rest weren&rsquo;t
                supported by enough data to be worth showing.
              </p>
            ) : null}
          </>
        ) : (
          <Panel>
            <EmptyState title="No notes yet">
              {batch?.reason ??
                'Notes are generated on a schedule from your own data. Nothing has been generated yet.'}
            </EmptyState>
          </Panel>
        )}
      </section>

      <section className="space-y-5">
        <h2 className="text-base font-semibold">Your account</h2>

        <Panel>
          <PanelHeader
            title="Followers"
            aside={
              followers.from && followers.to
                ? `${followers.measured} of ${followers.total} days measured`
                : undefined
            }
          />
          <div className="grid divide-y divide-[--color-rule] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Stat label="Now" value={overview.followers ?? null} />
            <Stat
              label="Change, 30 days"
              value={followers.change === null ? null : formatChange(followers.change)}
              unknownReason={
                followers.measured < 2
                  ? 'Needs two readings. One reading is not a change.'
                  : undefined
              }
            />
            <Stat label="Following" value={overview.following ?? null} />
          </div>
          <p className="px-5 pb-4 text-xs text-[--color-ink-faint]">
            Instagram serves about 30 days of follower history and no more. Days before that were
            never available — the series grows forward from here.
          </p>
        </Panel>

        <Panel>
          <PanelHeader title="Last 30 days" />
          <div className="grid divide-y divide-[--color-rule] sm:grid-cols-2 sm:divide-x lg:grid-cols-3">
            {totals.map((metric) => (
              <Stat
                key={metric.metric}
                label={metric.label}
                value={metric.total}
                unknownReason={metric.measured === 0 ? 'Not collected for this period' : undefined}
                sample={{ total: metric.days, measured: metric.measured }}
              />
            ))}
          </div>
          {totals.some((m) => m.unstable && m.measured > 0) ? (
            <p className="px-5 pb-4 text-xs text-[--color-ink-faint]">
              Views, interactions and accounts-engaged were redefined by Instagram within the last
              two years, so they are worth reading now but not worth comparing against older
              periods.
            </p>
          ) : null}
        </Panel>

        {follows.measured > 0 && !follows.labelled ? (
          <Panel>
            <PanelHeader title="Follows and unfollows" aside="unlabelled" />
            <div className="px-5 py-4 text-sm text-[--color-ink-muted]">
              Instagram reports two figures here — {follows.follows} and {follows.unfollows} over 30
              days — but labels them <span className="font-mono">FOLLOWER</span> and{' '}
              <span className="font-mono">NON_FOLLOWER</span> rather than follows and unfollows.
              Guessing which is which could show you a number that is exactly backwards, so they
              stay unlabelled until a check against your actual follower count settles it.
            </div>
          </Panel>
        ) : null}
      </section>

      <p className="text-xs text-[--color-ink-faint]">
        {overview.coverage.postsWithInsights} of {overview.coverage.posts} posts have performance
        data
        {overview.coverage.oldestPost
          ? `, back to ${formatRiyadhDate(new Date(overview.coverage.oldestPost))}`
          : ''}
        .
      </p>
    </main>
  );
}

function formatChange(change: number): string {
  return change > 0 ? `+${change}` : String(change);
}

function Header({ handle }: { handle: string | null }) {
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-[--color-ink-muted]">
        {handle ? `@${handle} — ` : ''}what your account is doing, and what you could do about it.
      </p>
    </header>
  );
}
