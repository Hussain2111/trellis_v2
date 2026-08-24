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

**Stage 1 — the walking skeleton.** Deployed-shaped but not yet deployed: the
app builds, migrations run through a script, the keepalive writes, cron auth
holds, and `/settings` reports the resolved environment. No account data is
synced and none of the three surfaces is built.

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
