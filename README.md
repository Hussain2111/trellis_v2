# Trellis

A tool for one Instagram creator. It reads their own account through Meta's
Graph API and helps them understand and plan their content.

Three surfaces and nothing else:

- **Dashboard** — 4–6 AI insight cards rendered as sticky notes, over account
  and follower metrics. Clicking a card hands it to the chat.
- **Chat** — a grounded conversation about the account. It reads synced data
  through tools, every statistic is computed in SQL, and **every figure it
  states must appear in what a tool returned** or it is dropped.
- **Calendar** — manually added posting dates and drafts, with a copy button on
  every field. Riyadh time throughout.

Cloud-hosted on **Vercel** and **Supabase**, at $0/month.

## Where this is

**Deployed, with the data layer built.** The app is live on Vercel against a
real Supabase project, the scheduler runs from GitHub Actions against the
production domain, the schema is applied, and the Graph client and sync layer
are written and tested.

**Not yet built: the three surfaces.** Chat, the dashboard's insight cards, and
the calendar are all still empty states.

The full plan is in [`docs/plan.md`](docs/plan.md) — foundation, three surface
lifecycles, a staged roadmap, and an open-questions register. The written record
of the previous build is in [`docs/history/`](docs/history/README.md).

## The rules everything follows

1. **A number that is not known renders blank, never zero.** Summing an empty
   series gives 0, which reads as "you held steady" — a different and false
   claim.
2. **Every statistic is computed in SQL.** The model never does arithmetic.
3. **Every figure in model output must appear in what a tool returned** —
   enforced in `lib/validate/numbers.ts`, not asked for in a prompt. Unbacked
   figures are dropped, never caveated.
4. **Every aggregate declares its real sample size.** `17 posts (2 measured)`.
5. **Sample floors are applied before the model call**, so it cannot caveat its
   way around thin data.
6. **No model name outside the provider interface.**
7. **No API field name in the interface.** "Accounts reached", not `reach`.
8. **Nothing is generated on page load.**

## Running it

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL at minimum
npm run db:migrate
npm run dev
```

Checks:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

The dev server process is `next-server`, not `next start` — `pkill -f "next
start"` does nothing and you will spend a round testing stale code. Use
`fuser -k 3000/tcp`.

## What the probes established

The Graph API's real behaviour is in [`docs/graph-api.md`](docs/graph-api.md),
written from probe output rather than documentation. The three findings that
shape everything else:

- **Insights have no lookback boundary** — 242 of 243 posts return data, the
  oldest 1,907 days old. The chat has five years of history on day one.
- **But Meta serves cumulative totals and no curve.** A curve exists only where
  it was sampled at the time, so `t24`/`t48`/`t7d` can never exist for a post
  published before this app did. Those carry `never_sampled`, which is a
  different claim from zero, from "too new", and from Meta declining.
- **30 days is a per-request range cap, not a horizon.** History is walked by
  paging backwards in 30-day windows.

## First run

Once, in order. Each step tells you whether the next one can work.

```bash
git pull
npm install
npm run setup:account      # verifies the token, creates the account row
```

`setup:account` is the first thing that touches the real Graph API and the real
database together, so it doubles as a first-contact check — a wrong token, a
short scope list or a `DATABASE_URL` pointing somewhere unexpected all surface
here rather than part-way through a 243-post walk. It is safe to re-run.

It also prints today's `followers_count` in a box. **Write that number down** —
it starts the seven-day check that decides whether follows/unfollows can be
labelled at all.

Then, on GitHub: **Actions → Sync → Run workflow**.

It calls `/api/sync` repeatedly until the response says `"done":true`. Each
call does a bounded amount of work and returns; the runner calls it back. Expect
several iterations — the one-time backfill walks 243 posts and is deliberately
unhurried. Watch the `stats` in each iteration's output: they carry request
counts and Meta's own rate-limit usage.

If it hits the iteration cap without finishing, that is not a failure. The
cursor is stored and the next run resumes from it.

## Scheduling

Vercel Hobby cron allows **2 entries, once daily each** — a cap, not a rate.
The single slot in use is the keepalive, because Supabase Free pauses a project
after ~7 days idle and that is the one job that must not depend on GitHub.

Everything else runs from GitHub Actions, which is not subject to that cap. It
needs a repository **variable** `APP_URL` pointing at the stable production
domain — never a per-deployment URL — and a repository **secret** `CRON_SECRET`
byte-identical to the Vercel variable.

If a scheduled workflow gets a 401 from Vercel rather than from the app,
**Deployment Protection** is on. It is on by default and blocks every external
scheduler and webhook.
