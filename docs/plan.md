# Trellis — rebuild plan

## Context

Trellis is a tool for one Instagram creator (`glowithuzma`, K-beauty, 4,881 followers, **243 posts reaching back to 2021**) that reads their own account through Meta's Graph API. A previous build shipped ten features, deployed late, and discovered every real infrastructure bug within hours of first contact with live services. It is being discarded and the repository recreated.

What is _not_ being discarded is the operational knowledge. That record — `NOTES.md`, `docs/roadmap.md`, `docs/cutover.md`, `docs/instagram-setup.md`, 3,291 lines — exists only in `Hussain2111/Trellis`, on branch `claude/trellis-v1-growy-parity-n509nm` at `2c97c27`. **So that repository is left exactly as it is.** The new build gets a new repository under a new name, which means the old one never has to be renamed, emptied or deleted, and no file has to be correctly enumerated to survive.

The new product is three surfaces and nothing else: a **Chat** grounded in the account's own data, a **Dashboard** of AI insight cards over account metrics, and a **Calendar** for drafts and posting dates. It runs at $0/month, serves one account, and is intended to become a commercial SaaS later.

The outcome this plan is aimed at: a deployed skeleton meeting real infrastructure before any feature exists, then three surfaces built on one schema, one design language, and one way of calling a model — with a hard guarantee that no number reaches the screen unless a SQL query produced it.

## Where this actually is

> **Keep this section current as work finishes, not as errors are noticed.** It has now been stale three times in two days, each time describing a world that had moved on — a repository that had been created, a stage that had been built, a token that had been regenerated. A roadmap that overstates what is left is as misleading as one that understates it, and the cost lands on whoever reads it next. Updating it is part of finishing a task, not a separate chore.

**Stage 0 — done.** `Hussain2111/trellis_v2` exists and carries the work. The old repository was never touched.

**Stage 1 — partly done.** Built and locally verified: the app, CI against a real Postgres container, migrations through a script, the keepalive write, cron auth (401/401/200 against a production build), the three-item nav, and `/settings` rendering resolved environment values. The **Supabase project exists** — the v1 project reused, dumped, `public` wiped, password reset — with its pooler string in `.env`. **Outstanding: run the migration against it, and deploy to Vercel.** Until the deploy exists, the scheduler has only been proven against `localhost`, which is a materially weaker claim than proving it against a domain.

**Stage 2 — probes written and run**, against a freshly regenerated seven-scope token with 56 days left. Q1 and Q2 answered, Q3 half-answered because the probe omitted a required parameter. Tasks 2.6 and 2.7 are the remainder, and 2.6 is the last thing blocking the schema.

**Stage 3 — one foundation piece landed early** (the provider interface, plus the validator and the time module from Stage 1), because nothing gated them. The data model waits on 2.6.

**Not started:** Stages 4, 5, 6.

---

## Decisions taken this session

| #   | Decision                                                       | Consequence                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`account_id` on every table, no auth**                       | One row in `accounts`. No users table, no login. The retrofit is the expensive part of multi-tenancy, not the column.                                                                                                                                                        |
| 2   | **Private repository**                                         | Private repos get 2,000 free Actions minutes a month; three daily workflows plus a weekly backup use a small fraction of that. Going public would have made the source of a product intended for sale world-readable in exchange for a resource already available. Reversed. |
| 3   | **No post-analytics readout, but keep the data** — reconfirmed | The dashboard's lower half is account/follower metrics only. **There is deliberately nowhere in the UI to glance at how recent posts performed.** Per-post insights are still synced and reachable by asking the chat.                                                       |
| 4   | **Chat acceptance test — set, see B1**                         | Answer-and-refuse in one turn. Chosen because answering fully and refusing fully are both easy; the hard case is holding both in one reply without the confident half lending credibility to the half it cannot support. Stage 4 cannot close until it is met.               |
| 5   | **Buffer → validate → render** for chat output                 | No token streaming of answer text. Tool progress may stream. The drop-don't-caveat rule is unconditionally enforceable this way.                                                                                                                                             |

## What the probes settled `[VERIFIED-LIVE]`

All three ran. The headline reverses the assumption the previous roadmap was built on.

### Q1 — RESOLVED. There is no lookback boundary.

**242 of 243 posts return insights. The oldest is 2021-06-04, 1,907 days old.** No older post lacked data — the boundary is beyond this account's entire history.

Four things follow, and none is small:

1. **The sparse-dashboard premise is dead.** Every note about coverage warnings and a dashboard that stays thin for months was written against an assumption that is now false. The chat has five years of real reach, views, saves and shares available on day one. Empty and thin-data states still have to exist and still have to be designed — they are now **rare rather than the default**.
2. **A backfill is mandatory, and it is the largest single operation in the project.** 243 posts, one insights request each. See Task 3.3.
3. **Historical posts can only ever hold `latest`.** Meta serves cumulative lifetime totals, so the backfill can fill `checkpoint = 'latest'` for all 243 — but `t24`, `t48` and `t7d` require having sampled at that age, and that age has passed. The data therefore has **two shapes, permanently**.
4. **Format comparison is viable — the earlier conclusion is reversed.** "This account posts one format" was an artefact of looking at ten posts. Across 243 there are substantial samples of `IMAGE/FEED`, `VIDEO/REELS` and `CAROUSEL_ALBUM/FEED`. The refusal path stays, because it is still correct when a floor genuinely is not met — but the design must not be built around refusing.

**One post fails**, with Meta error code `1` — their generic _transient_ error, not a permanent one. The backfill retries two or three times with backoff before writing `unavailable`. It is likely 243/243.

### Q2 — RESOLVED, but the mapping is ambiguous and must not be guessed.

`metric_type=total_value` **and** `breakdown=follow_type` together, over 30 days, return real values:

```
[{"dimension_values":["FOLLOWER"],"value":37},
 {"dimension_values":["NON_FOLLOWER"],"value":61}]
```

The dimension keys are `FOLLOWER` and `NON_FOLLOWER` — **not** `FOLLOW` and `UNFOLLOW`. Reading the first as follows and the second as unfollows is plausible; it is equally plausible that the breakdown describes the actor's relationship at the time of the event. Getting it backwards would put a confidently inverted number on the dashboard under the label "unfollows" — exactly the failure the blank-not-zero discipline exists to prevent.

**Verify before labelling anything.** See Task 2.7.

### Q3 — HALF-RESOLVED. The probe had a bug that hid the rest.

Four of five metrics errored identically:

```
(#100) The following metrics (views) should be specified with parameter metric_type=total_value
```

`views`, `profile_views`, `accounts_engaged` and `total_interactions` all require `metric_type=total_value`, and the probe did not send it. **So Q3 was only actually tested for `reach`.** This is a client-level finding, not merely a probe fix — the sync layer needs that parameter too.

Established: **`reach` backfills** (a 30-day window returned 30 days) and **`follower_count` backfills** (30 days returned). Note the metric is `follower_count`, **singular** — distinct from the account field `followers_count`. Two names for closely related things; the schema must not blur them.

**The unresolved half is a shape question, and it decides a table.** `metric_type=total_value` typically returns _one aggregate for the requested window_, not a per-day series. If those four metrics only support that, there is no daily series for them at all, and per-day values would mean **one request per day** — 30 for a month, 365 for a year. Affordable at the observed usage, but a different operation from the single windowed call `reach` supports. See Task 2.6.

### Rate limits are generous. Keep the guard anyway.

After walking 243 posts and requesting insights for each:

```
x-business-use-case-usage: call_count: 1, total_cputime: 1, total_time: 1,
                           estimated_time_to_regain_access: 0
```

These read as percentages of the hourly allowance. **One percent for the largest operation the app will ever perform** means the backfill is comfortably affordable. It does **not** mean the backoff, the cursor or the per-run budget come out — they cost nothing when unused, and they are the difference between a throttled sync that resumes and one that silently restarts.

### Two smaller discrepancies

- **`media_count` says 229; the walk found 243.** Use **pagination exhaustion** as the sync's terminator, never the count — a completion check against `media_count` stops 14 posts early.
- **`thumbnail_url` confirmed type-conditional**, as expected: present on `VIDEO/REELS`, absent on `CAROUSEL_ALBUM/FEED` and `IMAGE/FEED`. The probe labelled it `TYPE-COND` rather than absent, which is the Stage 2 fix working.

---

## Stack

**Next.js (App Router) · Vercel · Supabase Postgres · Drizzle · Tailwind · Vitest · Vercel AI SDK.**

Kept deliberately: every operational constraint in the scar-tissue record is mapped to _this_ stack. Switching a layer resets that ledger to zero and buys nothing — the previous build's failures were never the stack's fault.

Three deltas from the old build:

- **Vercel AI SDK (`ai` v7) is the provider interface**, thinly wrapped. It already provides configurable models and first-party Google/Groq/Mistral/OpenRouter adapters. The wrapper's job is quota rationing and model selection, not transport.
- **No jobs table.** The old build needed one for Apify webhooks and a six-step chain. This product has a daily sync and a scheduled generation, both idempotent endpoints. Resumability is a cursor column; the thing advancing work is **the GitHub Actions runner calling the endpoint in a loop until it reports done**. A queue stays additive if this proves insufficient.
- **Hand-built component set** on Tailwind, borrowing from shadcn rather than installing it. A generic kit fights the look Part 6 asks for.

## Non-negotiables

These govern every section below. They are restated once here and assumed thereafter.

1. **A number that is not known renders blank, never zero.** No metric column carries a default of `0`. Summing an empty series yields `null`, not `0`.
2. **Every statistic is computed in SQL.** The model never does arithmetic.
3. **Every figure in model output must appear in what a tool actually returned.** Enforced in code. Unbacked figures are dropped, not caveated.
4. **Every aggregate declares its real sample size.** `17 posts (2 measured)`, never `17 posts`.
5. **Sample floors are applied before the model call**, so the model cannot caveat its way around thin data.
6. **No model name appears outside the provider interface.**
7. **No API field name appears in the interface.** "Accounts reached", not `reach`.
8. **Nothing is generated on page load.**

---

# PART A — FOUNDATION

Specified before any surface. Three features planned on three different underneaths is the failure this ordering prevents.

## A1 — Data model

`lib/db/schema.ts`, migrations in `drizzle/`. Every table carries `account_id`. Every metric column is nullable with no default.

### Identity and content

| Table           | Key columns                                                                                                                                                                                                          | Notes                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accounts`      | `id`, `ig_user_id`, `page_id`, `handle`, `name`, `followers_count`, `follows_count`, `media_count`, `timezone`, `last_synced_at`                                                                                     | One row. `timezone` defaults `Asia/Riyadh`.                                                                                                                                    |
| `posts`         | `account_id`, `ig_media_id` (unique per account), `shortcode`, `permalink`, `caption`, `media_type`, `media_product_type`, `thumbnail_url`, `media_url`, `published_at`, `like_count`, `comments_count`, `raw` jsonb | `raw` keeps the untouched payload so re-normalising after field drift costs nothing. `thumbnail_url` and `media_url` both stored — the field served is media-type conditional. |
| `post_comments` | `post_id`, `ig_comment_id` unique, `username`, `text`, `like_count`, `commented_at`, `parent_ig_id`                                                                                                                  |                                                                                                                                                                                |

### Measurement

| Table                                          | Key columns                                                                                                                                                                                                       | Notes                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post_insights`                                | `post_id`, `checkpoint` (`t24`\|`t48`\|`t7d`\|`latest`), `captured_at`, `reach`, `views`, `saved`, `shares`, `likes`, `comments`, `total_interactions`, `unavailable` jsonb — unique on (`post_id`, `checkpoint`) | Meta serves cumulative lifetime totals with no historical curve, so **a curve only exists if it was sampled**. This table is the sampling record. `unavailable` names _why_ a metric is missing, so a blank can explain itself.                                                                                                                                 |
| `account_daily`                                | `account_id`, `day` (text `YYYY-MM-DD`, Riyadh), `follower_count`, `reach`, `unavailable` jsonb — unique on (`account_id`, `day`)                                                                                 | **Confirmed per-day series only.** `reach` and `follower_count` both returned 30 days against an explicit window. `day` as text, not date, so the Riyadh boundary is decided once at write time.                                                                                                                                                                |
| `account_windows` — **shape pending Task 2.6** | `account_id`, `window_start`, `window_end`, `views`, `profile_views`, `accounts_engaged`, `total_interactions`, `follows`, `unfollows`                                                                            | Provisional. `metric_type=total_value` may return one aggregate per window rather than a series, in which case these four metrics cannot live in `account_daily` at all. If Task 2.6 shows a one-day window yields a usable daily value, they fold back into `account_daily` and this table does not exist. **Do not write either version before 2.6 returns.** |

### Product

| Table              | Key columns                                                                                                                                                                                 | Notes                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `insight_batches`  | `account_id`, `generated_at`, `status` (`ok`\|`fallback`), `reason`, `model`, `cards_requested`, `cards_kept`                                                                               | A generation that produced nothing usable still writes a row. Silence must be explicable.                                      |
| `insight_cards`    | `batch_id`, `account_id`, `body`, `payload` jsonb, `cited_post_ids`, `rank`                                                                                                                 | `payload` is the SQL-computed evidence the card was generated from. This is what the chat re-resolves — see **A5** and **B2**. |
| `chat_threads`     | `account_id`, `title`, `source_card_id` nullable, `created_at`, `updated_at`                                                                                                                |                                                                                                                                |
| `chat_messages`    | `thread_id`, `role`, `content`, `tool_calls` jsonb, `validation` jsonb, `created_at`                                                                                                        | `validation` records what was dropped and why — the audit trail for rule 3.                                                    |
| `calendar_entries` | `account_id`, `scheduled_for` timestamptz, `status` (`planned`\|`published`), `format`, `title`, `hook`, `caption`, `hashtags` jsonb, `notes`, `published_post_id` nullable, `published_at` | **`due` and `overdue` are derived at read time, never stored.** A stored status goes stale the moment the clock passes it.     |

### Operations

| Table        | Purpose                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync_runs`  | `kind`, `started_at`, `finished_at`, `status`, `cursor`, `stats` jsonb, `error`. The resumption point and the audit trail.                                                             |
| `model_runs` | `purpose` (`chat`\|`cards`), `provider`, `model`, token counts, `status`, `error`. The quota-rationing ledger. Failures count against the ledger — a failed call spent the same quota. |

**Notes.** All timestamps `timestamptz`, stored UTC. Riyadh is a presentation and grouping concern only (**A6**, **B3**).

**Naming, because two of these are nearly the same word.** The Graph _metric_ is `follower_count` (singular); the account _field_ is `followers_count` (plural). They mean closely related but different things and the schema must not blur them: `accounts.followers_count` is the current value from the account edge, `account_daily.follower_count` is the historical series from the insights edge.

**The two shapes of `post_insights`, permanently.** Historical posts get exactly one row, at `checkpoint = 'latest'` — excellent for medians, baselines, format comparison and ranking. Posts published after go-live get a real curve. **`t24`/`t48`/`t7d` can never exist for a 2021 post**, because producing one would have required sampling at that age. Absence of `t24` must read as _not sampled_, distinct from zero and distinct from _too new_.

**Blockers.** `account_daily` / `account_windows` shape depends on **Task 2.6**. Everything else is unblocked — Q1 and Q2 are answered.

## A2 — Sync layer

`lib/graph/` (client), `lib/sync/` (orchestration), `app/api/sync/route.ts`.

**Four sync units**, each independently resumable and independently failable:

| Unit            | Fetches                                                                                                                                                                                                                   | Cadence                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `account`       | Account fields + account insights (`reach`, `views`, `profile_views`, `accounts_engaged`, `total_interactions`) into `account_daily`                                                                                      | Daily                                  |
| `media`         | Media edge, paginated, cursor in `sync_runs.cursor`. **Terminated by pagination exhaustion, never by `media_count`** — the count says 229 where the walk found 243, so a completion check against it stops 14 posts short | Daily; full walk on first run          |
| `post_insights` | Per-post insights at whichever checkpoints are now due                                                                                                                                                                    | Daily, and this is what creates curves |
| `comments`      | Comments for the most recent N posts                                                                                                                                                                                      | Daily                                  |
| `backfill`      | One-time historical pass over all 243 posts, `latest` only                                                                                                                                                                | **Runs once**, see below               |

**`metric_type=total_value` is required** for `views`, `profile_views`, `accounts_engaged` and `total_interactions`. Without it the request errors `(#100)` rather than returning partial data. `reach` does not need it. This is written down in `docs/graph-api.md` and enforced in the client, not remembered.

### The backfill — the largest single operation in the project

243 posts, one insights request each. The lookback probe took 4m53s to walk it at a deliberately unhurried pace, and that is roughly the right pace.

- **It runs once.** Guarded by a flag, or by checking whether `post_insights` is empty. A backfill that re-runs is a rate-limit incident waiting for a redeploy.
- **`latest` only.** It cannot produce `t24`/`t48`/`t7d` for a historical post, because that would have required sampling at that age. Attempting to synthesise one from a lifetime total would be inventing a measurement.
- **Same resumable cursor and per-run budget as the daily sync.** The Actions loop calls until done, across as many invocations as it takes.
- **Deliberately throttled.** There is no reason to rush a one-time operation, and this is exactly where a rate limit would bite.
- **Retry Meta error code `1` two or three times with backoff before writing `unavailable`.** Code 1 is their generic _transient_ error. The single failing post in the probe is likely recoverable, making it 243/243.

**Partial failure is the design centre, not an edge case:**

- A metric Meta declines is written `null` with a reason in `unavailable`. **Never `0`.**
- A failing post does not fail the page. A failing page records its cursor and returns `{done: false}` so the runner calls again.
- The endpoint returns `{done, cursor, stats}`. It never blocks longer than the function's ceiling; it returns and expects to be called back.
- Every unit is idempotent. Re-running never double-counts.

**Checkpoint policy.** On each run, for each post, write the checkpoints now due: `t24` if 24–36h old, `t48` if 48–60h, `t7d` if 7–8d, and `latest` always. A post older than a checkpoint's window at first sync **does not get that checkpoint, ever** — it renders as _not measured_, which is a different statement from zero and must be labelled as such.

### Rate limiting — designed for, not discovered

**The first sync is the largest burst this app will ever make**, and it happens before anything else works: a full media walk of 243 posts plus the backfill's per-post insights request on top.

**Measured, not feared.** After exactly that walk, the probe reported `call_count: 1, total_cputime: 1, total_time: 1, estimated_time_to_regain_access: 0` — roughly **one percent** of the hourly allowance for the largest operation the app will ever perform. The backfill is comfortably affordable.

**None of the guards come out on the strength of that.** They cost nothing when unused, and they are the difference between a throttled sync that resumes and one that silently restarts. A headroom measurement taken once on one account is not a guarantee about every future run.

Required in the client and the runner, not bolted on later:

- **429 and Meta's error-code handling as a first-class path.** A rate-limit response is a normal outcome, not an exception — it returns `{done: false}` with the cursor intact.
- **Exponential backoff with jitter**, honouring `Retry-After` when present.
- **A cursor that survives being rate-limited mid-walk.** `sync_runs.cursor` is written _before_ each page is processed, not after, so an interruption resumes from the right place rather than restarting the walk.
- **A per-run request budget.** The run stops itself well short of the cap and returns; the Actions loop calls again. Spreading the first sync across several runs is correct behaviour, not a failure.
- **Meta's own usage headers recorded** into `sync_runs.stats` and surfaced on the settings page, so throttling is visible before it becomes a stall.
- **A deliberately throttled first sync.** The initial full walk runs slower than steady-state syncing on purpose.

**Resources.** `docs/graph-api.md` (written from probe output, not from Meta's docs). Pinned API version from a single env-driven constant, surfaced on the settings page.
**Blockers.** Task 2.6 (the `account_daily` / `account_windows` shape) and Task 2.7 (the follows/unfollows mapping). Q1 is answered.

## A3 — Scheduling layer

**Vercel cron (2 entries, once daily each — a hard cap, not a rate limit):**

| Path                  | Schedule | Why here                                                                                                                |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/api/cron/keepalive` | daily    | Performs a **real write**. Supabase Free pauses after ~7 days idle. This is the one job that must not depend on GitHub. |
| —                     | —        | Second slot deliberately unspent, as headroom.                                                                          |

**GitHub Actions (private repo, 2,000 free minutes/month — these four use a small fraction):**

| Workflow       | Schedule          | Does                                                                           |
| -------------- | ----------------- | ------------------------------------------------------------------------------ |
| `sync.yml`     | daily             | Calls `/api/sync` **in a loop** until `{done:true}` or a bounded iteration cap |
| `insights.yml` | daily, after sync | Triggers card generation                                                       |
| `token.yml`    | weekly            | Refreshes the long-lived token; asserts all seven scopes                       |
| `backup.yml`   | weekly            | `pg_dump` → uploaded as a workflow artifact with a long retention. See below.  |

All endpoints behind `Authorization: Bearer $CRON_SECRET`. Repo **variable** `APP_URL` — the _stable production domain_, never a per-deployment URL. Repo **secret** `CRON_SECRET`, byte-identical to the Vercel variable.

**Notes.** The loop is the answer to "what is advancing the work". It is never a browser tab. A long sync is many short authenticated calls from a runner that is already awake, which fits a serverless host without a queue.
**Blockers.** Deployment Protection must be off or the runner gets 401 on every call. Verified in Stage 1.

### Backups — because one table is irreplaceable

Posts, comments and per-post insights can be re-fetched from Meta at any time — and after Q1, _all_ of them can, back to 2021.

**`account_daily` is the exception, and Q3 softened this without removing it.** `reach` and `follower_count` do backfill across at least a 30-day window, so a lost database is recoverable to a 30-day depth rather than to nothing. **Thirty days of recoverable history is not a disaster-recovery plan.** Beyond that rolling window the series is still built one row per day by a cron and still gone for good, and Supabase Free still has no automated backups.

So `backup.yml` ships before the sync writes, unchanged. If Task 2.6 shows the window reaches 90 or 365 days, the depth improves again — and the argument does not change, because the series only ever grows past whatever that window turns out to be.

`backup.yml` runs weekly against the pooler connection string, dumps to a compressed file, and uploads it as a workflow artifact with the longest retention available. A dump that comes back empty or implausibly small **fails the workflow loudly** rather than uploading a useless artifact — a backup that silently stopped working is worse than none, because it is believed.

This is required infrastructure, not housekeeping, and it is scheduled the moment `account_daily` starts accumulating rows.

## A4 — Model provider interface

`lib/model/provider.ts` — the only module that names a model.

```
getModel(purpose: 'chat' | 'cards') → { model, provider, modelId }
```

- Env-configured: `MODEL_PRIMARY`, `MODEL_FALLBACK`, provider keys. Failover is a config change, not a code change.
- **Quota rationed per purpose** against `model_runs`. Scheduled card generation reserves its allowance first; chat draws from what remains. Heavy chat use cannot starve the dashboard.
- **The unit is calls, not messages.** One chat message becomes several model calls once the tool loop runs — a request, a tool result, a follow-up, possibly a repair attempt. A cap expressed in messages-per-day silently means several times that in calls. Rationing counts **calls**, and the observed calls-per-message ratio is measured and written down rather than assumed.
- **Do not hardcode a quota number.** Free-tier limits changed substantially in late 2025 and are no longer published as a static table — they are surfaced live per project in AI Studio. The cap is an env value, read from the console and recorded in `docs/quota.md` with the date it was observed.
- Quota exhaustion is an explicit `429` naming the reset time. Never a silent degrade.

**Commercialization line item, not an optional upgrade:** free-tier usage is used to improve the provider's products; paid-tier usage is not. Acceptable for one owner's own account. **Not acceptable the moment another person's Instagram data flows through it.** Moving to a paid tier is a precondition of the first non-owner user, alongside Meta App Review.

## A5 — Validation layer

`lib/validate/numbers.ts`. Specified once, used by both surfaces.

```
allowedNumbers(payload)              → Set<string>
numbersIn(text)                      → number[]
unbackedNumbers(text, allowed)       → number[]
```

- `allowedNumbers` walks the tool payload collecting every number **plus its legitimate roundings** — `Math.round`, one decimal place, and ×100 for ratios in 0..1.
- `numbersIn` strips thousands separators before comparison.
- Structural small integers (0–10) are exempt — "three of your posts" is not a statistic.
- **Citations are validated too:** a cited post id that is not in the payload invalidates the claim exactly as an unbacked figure does.

**Two consumers, two enforcement points:**

| Consumer      | Shape              | On failure                                                                                                                                                                                                              |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Insight cards | Structured objects | Drop the card. Show fewer.                                                                                                                                                                                              |
| Chat          | Buffered text      | One repair attempt naming the offending figures; if still unbacked, drop the sentence; if that guts the answer, replace it with an explicit "I can't back that up from your data". **Never render an unbacked figure.** |

**Notes.** This is why decision 5 exists. Streaming and drop-don't-caveat are incompatible — you cannot un-send a token. Tool-call progress may stream; answer text may not.

## A6 — Design system

`app/globals.css` (tokens), `components/ui/`.

- **Tokens:** warm paper background, a full ink scale, one accent, semantic `positive`/`negative` used sparingly. Light and dark both defined; neither is an afterthought.
- **Type:** one UI face at generous size and line-height. Numbers tabular-aligned. No dense tables anywhere.
- **Mobile-first.** Bottom tab bar on mobile, sidebar on desktop. Three items — Dashboard · Chat · Calendar — with Settings tucked into a corner, not the bar.
- **Sticky notes** are the signature element: slight rotation, soft shadow, warm paper tint, a lift on press. **Restrained physicality** — paper texture and curled corners fight legibility at phone width, which is where this will most often be read.
- **Empty and thin-data states are components, not leftovers.** `<EmptyState>`, `<ThinData>`, and a `<Stat>` that takes an explicit `unknown` state distinct from zero. A blank that explains itself is the product working.
- **`<CopyField>`** — label, value, copy button, copied confirmation. Used throughout the calendar.
- **No jargon** anywhere in these components. The mapping from API field to human label lives in one place, `lib/labels.ts`.

---

# PART B — SURFACES

Chat first, because it is the core and the other two are shaped by it.

## B1 — Chat

### Requirements

- Reads synced data through **tools**, never a prompt stuffed with rows. The model decides what to fetch.
- Every statistic arrives from SQL. **Tools are pre-computed aggregates — never a generic query runner.** `getFormatBreakdown()`, not `runSQL()`.
- Numeric validation in code (**A5**). Answers cite post permalinks.
- Threads persist. Titled from first message or source card.
- States how many posts it reasoned from; declines comparisons that lack the sample.
- **Will not:** post to Instagram, write to the calendar, or answer about accounts other than the user's.

### The acceptance test `[DECISION]`

> **"Which of my carousels beat my reel median on saves, and which of them were still climbing after 48 hours?"**

It must **answer the first half** — from 243 posts of real history, every figure from SQL, stating the sample it reasoned from — and **refuse the second half**, because those posts were never sampled at 48 hours. In the same reply. Without letting the confident half lend credibility to the half it cannot support.

**Why this one rather than a harder-sounding one.** Answering fully is easy and refusing fully is easy. The failure mode that would make this product untrustworthy is **partial knowledge** — a fluent model blurring the boundary between what it measured and what it is guessing. That is the thing to gate on, and it is the only candidate that can be graded objectively, which matters for something that blocks a stage.

**It is graded twice, and the second time is the real one.**

1. **At the start of Stage 4**, _no_ post has `t48` data — the sync has not been running long enough. The refusal will be correct but for the weaker reason: nothing was sampled at all.
2. **A week or two later**, once posts published after go-live have real curves, run the identical question again. Now it must **split the set** — answer for the new posts, refuse for the old. That is the version that proves the distinction is actually understood rather than accidentally satisfied.

**Two further questions, hand-judged, not gates:**

- _"How has my carousel-vs-reel saves gap changed over the last two years?"_ — multi-step composition across the full history.
- _"What do my ten best-reaching posts have in common that my ten worst don't?"_ — the closest thing to what a creator actually wants, and impossible to score. Worth seeing what it does.

### Format comparison is a normal path, not an exception

The earlier "this account posts one format" finding was an artefact of a ten-post sample. Across 243 there are substantial samples of images, reels and carousels, so `getFormatBreakdown` clears its floors comfortably.

The refusal path stays — it is still correct behaviour when a floor genuinely is not met — but **the design must not be built around refusing**, and the tests must cover the answering path as the common case rather than treating thin data as the default.

### Design

**Tool surface** — every tool returns `{ data, sampleSize, coverage, asOf }`, so thin data and staleness travel with the answer rather than being available on request:

| Tool                                     | Returns                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAccountOverview()`                   | Followers, post count, sync freshness, insight coverage                                                                                                                                                                                                                                                         |
| `getFollowerSeries({days})`              | Daily series with explicit gaps — a missing day is missing, not zero                                                                                                                                                                                                                                            |
| `getPosts({limit, format, since, sort})` | Content: caption, format, date, permalink                                                                                                                                                                                                                                                                       |
| `getPostPerformance({postId})`           | Per-post insights **and which checkpoints exist**. Absence of `t48` must come back as _not sampled_ — distinct from zero, and distinct from _too new_. A 2021 post can never have one, and the chat must not imply it does                                                                                      |
| `getPostsRanked({metric, since, limit})` | Ranked, with the count actually measured                                                                                                                                                                                                                                                                        |
| `getTrailingMedian({metric, days})`      | The account's own baseline                                                                                                                                                                                                                                                                                      |
| `getFormatBreakdown({minSample})`        | Per-format medians with their real sample sizes. Across 243 posts, images, reels and carousels all clear the floors, so **the answering path is the common case**. It still **returns a refusal object when a floor genuinely is not met** — that path is correct and stays, it is simply no longer the default |
| `getComments({postId?, top?})`           | Commenters and what they commented on                                                                                                                                                                                                                                                                           |
| `getCalendarEntries({from, to, status})` | So "what's due this week" is answerable. **Ships in Stage 4 returning an honest empty result**, not in Stage 6 — see note below                                                                                                                                                                                 |
| `getInsightCard({id})`                   | The card→chat contract — see **B2**                                                                                                                                                                                                                                                                             |

**A cross-stage note, so it isn't discovered mid-build.** `getCalendarEntries` reads a surface that ships two stages later. The table exists from Task 3.1 — the whole schema lands at once — so in Stage 4 the tool is real and returns nothing, which is precisely the empty state this product is designed around. Shipping it then rather than in Stage 6 keeps the tool surface fixed across the chat's acceptance testing; adding a tool afterwards means re-checking that the model still reaches for the right one. The Stage 6 work is filling the table, not adding the tool.

**UI.** Thread list, message view, composer. Tool activity renders as live progress ("checking your follower history…"); the answer appears whole when validated. Citations render as permalink chips. A "reasoned from N posts" line under answers containing statistics.

**States.** No data yet → explains the sync hasn't run rather than showing an empty thread. Quota exhausted → says when it resets. Validation dropped everything → says so plainly.

### Implementation plan

1. Threads and messages: schema, list, persistence. Deployable.
2. Provider wiring through **A4**, no tools. Answers ungrounded but real. Deployable.
3. Tool surface over real tables, one tool at a time, each with its own test.
4. Buffer-validate-render pipeline (**A5**) including the repair attempt.
5. Citations and sample-size line.
6. `getInsightCard` and thread seeding (needs **B2**).

### Test plan

- **Unit:** every tool's SQL against seeded data, including data chosen to break it — one format only, a post with no insights, a follower series with a gap. The validator against payloads with roundings, thousands separators, and figures that are almost-but-not-quite backed.
- **Integration:** a fake model returning known-bad output; assert the figure is dropped, not caveated.
- **Live only — be honest that this is the category that broke the last build:** real model behaviour under real payloads, real quota limits, and whether the model reaches for the right tool unprompted. 246 green tests did not prevent first-contact failure. A **live smoke suite run against production after every deploy** is the mitigation, not more unit tests.

### Deployment

Provider key set in all three Vercel environments. Quota caps recorded. Settings page shows model, provider and today's usage.

### Maintenance

Model deprecation is the recurring failure — providers delete models that running code depends on. Failover config is the guard; a monthly check that `MODEL_FALLBACK` still resolves is the routine. Watch for tool-selection drift after any model change.

## B2 — Dashboard

### Requirements

**Top half — 4 to 6 sticky notes.** Each an _opportunity_, not a metric readout. Generated on a schedule and cached; **never on page load**. Each cites the posts it derives from. **When the data won't support six, show four. Never fill the grid.**

**Bottom half — account metrics only.** Per decision 3, reconfirmed after review: follower count over time, day-over-day change, gross follows/unfollows if **Q2** permits, and account-level reach/views/profile-views.

**No post-performance readout, and the lower half reserves room for one anyway.**

The decision was taken twice, the second time with the consequence spelled out — _"there's no screen where you can glance at how your last ten posts did"_ — and answered "keep it chat-only". It is a made decision, not an inference, so it stands. But the framing matters and is worth recording accurately: the brief's Dashboard section _lists_ post performance among the lower half's contents. Nothing in it prohibits post performance. **The exclusion is a decision layered on top of the brief, not something the brief asked for.**

That makes reversibility the thing to protect, and the risk is not the work — it is the layout settling around the absence. So:

- The lower half is built as a **vertical stack of independent, self-contained sections**, not a fixed two-panel or grid layout. Adding a section is an insertion, never a relayout.
- The data is already there. `getPostPerformance` and `getPostsRanked` exist for the chat, and their SQL is the same SQL a strip would render.
- Reversing it is one component plus one section, with no schema change and no sync change.

If the question turns out to be one you glance at rather than ask, say so and it goes in. Until then, it is asked.

### The card → chat contract

**Specified here, referenced from B1. A reference crosses the boundary, not the evidence.**

Clicking a card opens a **new thread**, seeded with a user message whose visible text is the card's `body`, carrying `source_card_id`. The chat's first turn calls `getInsightCard(id)`, which returns the stored `payload`, `cited_post_ids` and `generated_at`.

Three reasons it cannot be a paste of the evidence:

1. **The validator requires it.** Rule 3 is that figures must appear in _what a tool returned_. Evidence arriving as prompt text is unbacked, and the chat would strip the card's own numbers when repeating them.
2. **The card may be stale.** It was generated on a schedule. The tool returns freshness, so the chat says "computed Tuesday" rather than asserting it as current.
3. **The thread stays readable.** History shows what the user clicked, not a JSON blob.

### Design

**Generation pipeline** — the same architecture as the chat, run offline:

```
SQL computes evidence → sample floors → model interprets → code validates
numbers + citations → drop failures → keep 4–6 → write batch
```

A batch that keeps zero cards still writes an `insight_batches` row with a reason. The dashboard then says why it has nothing, rather than showing an empty wall.

**Manual refresh.** A "refresh insights" action, rate-limited to a small daily count against `model_runs`. Not on page load; on explicit intent. A creator who just posted should not wait a day.

**States.** Fewer than four cards → renders fewer, with a line explaining the sample was thin. No sync yet → an onboarding state, not an error. Metric unavailable → blank with a reason, never `0`.

**These states are now rare, and that changes how they are designed.** They were specified against a dashboard expected to be thin for months; with five years of history available from the backfill, thin data is the exception. They still have to exist and still have to explain themselves — but a design that leads with its empty state would now be designing for a case that mostly does not occur.

**Coverage belongs on `/settings`, not hidden.** The probe found 242 of 243 posts returning insights, with one failing on a transient error. After the backfill retries it, state the real figure. A coverage line that reads `243/243` is worth as much as one that reads `242/243` — what matters is that the number is stated rather than assumed.

### Implementation plan

1. Metrics half over `account_daily`. Real numbers, no model. Deployable.
2. Payload builders in SQL, with sample floors. Tested standalone.
3. Generation endpoint + `insights.yml`. Writes batches; nothing rendered yet.
4. Card validation and the drop path.
5. Sticky-note rendering.
6. Click → thread seeding (closes the contract with B1).
7. Manual refresh with rate limiting.

### Test plan

- **Unit:** payload builders under thin data; the floors; card validation dropping an unbacked figure and an uncited post id; "keep 4–6" degrading to fewer rather than padding.
- **Integration:** a fake model returning six cards of which two carry invented numbers → four cards render.
- **Live:** whether real model output is _useful_ — the one thing no test can assert. Judged by hand on first real batch.

### Deployment

`insights.yml` scheduled after `sync.yml`. First batch generated manually and read before the schedule is enabled.

### Maintenance

Card quality drifts as the account changes. The floors are the guard. Every threshold chosen before real data exists is provisional and belongs in `docs/thresholds.md` with its current value, to be argued with after a month of history.

## B3 — Calendar

### Requirements

- User **manually** adds entries: a date and a draft. **No auto-proposed schedule.**
- A draft holds caption, hashtags, hook, format, notes — **a copy button per field**.
- **The measure of success: "this is due" → "posted on Instagram" without retyping anything.**
- States: planned → due → overdue → published. **Due and overdue are derived at read time.**
- **Alerts in-app only.** A badge on the nav item, a dismissible banner listing overdue entries. No email, no push, no external service.
- All boundaries in `Asia/Riyadh`. Store UTC, render local.

### Design

**Time handling.** Riyadh is UTC+3, no DST, so no timezone library — but the boundary is the bug. An entry at 01:00 Monday Riyadh is 22:00 Sunday UTC, and a naive sort files it in the previous week. One helper, `lib/time.ts`, owns every conversion; nothing else does arithmetic on dates.

**Views.** Week view grouped by Riyadh weeks (Monday start) on desktop; a chronological list on mobile, which is where "is something due" is actually asked. Entry detail is a stack of `<CopyField>`s.

**Publishing.** Manual — the user posts on Instagram themselves. `instagram_content_publish` is requested with the token because regenerating later to add it is worse, **but auto-publishing is not a feature and nothing should be built toward it.**

**Auto-match.** When the sync ingests a post published within a window of a due entry, the entry surfaces a "is this it?" prompt. Confirming links `published_post_id` and moves the entry to published. Never automatic — a wrong link is worse than an unlinked entry.

### Implementation plan

1. `lib/time.ts` with its own tests, before any calendar code.
2. Schema, CRUD, list view. Deployable.
3. Derived state and the week grouping.
4. `<CopyField>` throughout.
5. Badge and banner.
6. Auto-match prompt.

### Test plan

- **Unit:** the boundary case explicitly — an entry stored `…T22:00:00Z` must render Monday 01:00 and file into the Monday week. Derived state at each transition. Auto-match window.
- **Live:** whether the copy→paste→post flow actually works on a phone, in Instagram. Only findable by doing it.

### Deployment

No new infrastructure. Ships with the app.

### Maintenance

The retention surface — the only one where the user _does_ something rather than reads. Watch whether entries are actually created; if they aren't, the copy flow is failing somewhere no test can see.

---

# PART C — ROADMAP

Stage → task → steps. No timelines.

## Stage 0 — Leave the old repository alone

**Task 0.1 — Do nothing to `Hussain2111/Trellis`**

- Steps: none. Do not delete it, do not rename it, do not extract from it.
- **Verified intact on the remote** at `2c97c27`: `NOTES.md` (1,290 lines), `docs/roadmap.md` (1,677), `docs/instagram-setup.md` (172), `docs/cutover.md` (152), across branches `main`, `claude/trellis-v1-growy-parity-n509nm` and `claude/instagram-coach-spec-r1grp1`.
- Notes: this went through three versions and the third is the best. Extracting four named files risked getting the list wrong — and it would have, since the brief names three and the fourth (`docs/instagram-setup.md`, holding the seven-scope walkthrough and the Page→`IG_USER_ID` resolution path) is arguably the most valuable. Renaming fixed that but still touched a repository holding the only copy of something. **Giving the new repository a different name removes the need to touch the old one at all** — the rename existed solely to free up the name. The safest version of an archival step is the one with no steps.
- Optional later, costs nothing and reverses freely: flip the old repo to private.

**Task 0.2 — Create the new repository** ✅ **DONE**

- `Hussain2111/trellis_v2` exists, is attached to the working session, and carries the Stage 1 and Stage 2 commits. The old repository was never touched.
- Notes, kept because it will recur: repository creation, renaming and visibility changes return `403 Resource not accessible by integration` from a session scoped to one repository's contents. Those are account-level actions and stay with the owner.

## Stage 1 — Walking skeleton, in production — **PARTLY DONE**

Deploy to real infrastructure before any feature exists. Every genuine infrastructure bug in the last build surfaced within hours of first contact and **none were reachable from local tests or CI**.

**Built and verified locally: 1.1, 1.4, 1.5.** The Supabase project also exists (1.2), reused from v1 and cleaned. **Outstanding: one migration command, and the Vercel deploy** — the deploy being exactly the "real infrastructure" half this stage exists for. Until it lands, the scheduler has been proven against `localhost` and not against a domain, which is a materially weaker claim.

**Task 1.1 — Repository and CI** ✅ **DONE**

- Steps: new **private** repo; Next app; ESLint/Prettier; CI running typecheck, lint, format, migrations and tests **against a real Postgres service container**.
- Notes: real Postgres in CI caught driver-level bugs last time that no mock would have. Private is the deliberate choice (decision 2) — 2,000 free Actions minutes covers four light workflows several times over, so there is nothing to buy by publishing the source.

**Task 1.2 — Supabase** ⚠️ **NEARLY DONE — one command left**

- **The project already exists.** The v1 project was reused, not replaced: dumped, `public` wiped, password reset. The pooler `DATABASE_URL` is in `.env`. **Do not create a second project.**
- Done: pooler string (transaction mode), prepared statements disabled in `lib/db/client.ts`, the migration script, and the Stage 1 tables.
- **Outstanding: run `npm run db:migrate` against the cleaned project.** That is the whole of what is left here.
- Notes: pooler, not direct — serverless functions are short-lived and numerous. The direct hostname is IPv6-only on new projects and unreachable from some networks; a connection that hangs with no error is this.
- Blocker: migrations run through the script, never pasted into the SQL editor — the editor autocommits per statement, so a guard aborting a destructive step raises _after_ the destruction committed.

**Task 1.3 — Deploy to Vercel** ⛔ **OUTSTANDING — owner**

- Steps: import `trellis_v2`; set env vars **with all three environments ticked** and **not marked Sensitive**; deploy; **turn Deployment Protection off**; redeploy.
- Notes: Sensitive makes a variable write-only, so a failed save is indistinguishable from a successful one — the previous build is still stuck with unreadable values. Environment changes need a redeploy. Deployment Protection is on by default and 401s every webhook and scheduler; it can return if the project is recreated.

**Task 1.4 — Scheduler, end to end** ⚠️ **BUILT, NOT PROVEN**

- Built: `CRON_SECRET` guard, `/api/cron/ping` (authenticated, touches nothing), `keepalive` on Vercel cron in `vercel.json`, and `.github/workflows/scheduler-check.yml`. Verified against a local production build — **401 unauthenticated, 401 with a wrong bearer, 200 with the right one**.
- Outstanding: the same run against the live domain. Needs repo variable `APP_URL` and repo secret `CRON_SECRET`, and depends on 1.3.
- Notes: `APP_URL` must be the **stable production domain**. Per-deployment URLs change every deploy and the scheduler silently no-ops. The workflow fails loudly on anything but a 200 — a scheduler that exits 0 on a 401 is one that has quietly stopped working.

**Task 1.5 — The settings page** ✅ **DONE**

- Steps: render **resolved** env values the running function sees; pinned API version; token scopes with all seven checked; last sync; today's model usage.
- Notes: built first, not last. In the previous build this was more reliable than Vercel's own dashboard for confirming a variable change took effect, and it is the instrument panel for every debugging session after this one.

## Stage 2 — Probes, before the sync layer is written

Standalone scripts in `scripts/`, importing **nothing** from app code — a probe sharing the code under test can only confirm its own assumptions. Each field requested individually so one failure doesn't mask others. Each media type probed separately.

**Task 2.1 — Token and scopes** ✅ **DONE**

- The token was **regenerated** — the original was lost with the old working folder. `probe:graph` confirms it: valid, **56 days remaining, all seven scopes**.
- Established: the `trellis` app (`4365362137020369`), the `Skincaring` Page (`223324307523350`), `IG_USER_ID` `17841402326320043`. The Meta app is independent of anything that happened to the repositories.
- Notes, kept for the next regeneration: Facebook Login flow, **not** "Instagram API with Instagram Login" — the latter issues a different token type and the resolution path doesn't exist on it. Resolution is user token → `/me/accounts` → Page id → `/{page-id}?fields=instagram_business_account` → `IG_USER_ID`. And without `business_management`, `/me/accounts` returns `{"data": []}` — empty, not an error, reading as "administers no Pages" rather than "token lacks a permission". Document that failure mode wherever scopes are listed and make the scope check test all seven.

**Task 2.2 — Media insights lookback (Q1)** ✅ **DONE — no boundary, 242/243, oldest 2021-06-04**

**Task 2.3 — `follows_and_unfollows` (Q2)** ✅ **DONE — values returned; mapping unverified, see 2.7**

**Task 2.4 — Account-insight backfill (Q3)** ⚠️ **PARTIAL — only `reach` was actually tested**

### Task 2.6 — Fix the probe and re-run Q3 properly ★ **next**

- **The bug:** `probeBackfill` in `scripts/probe/account-insights.ts` sends `metric` + `period` + window but **not** `metric_type=total_value`, so four of five metrics errored `(#100)` and only `reach` was tested.
- **Steps:**
  1. Send `metric_type=total_value` where required. **Fix the probe and any fixture in the same commit** — a fixture mirroring a wrong assumption manufactures confidence.
  2. Re-run all five account metrics, plus `follower_count`, over **2, 7, 30, 90 and 365 days**. If account insights reach back further than 30 days, first sync populates proportionally more and the backfill scope grows again.
  3. **Report, per metric, three things** — not just success or failure:
     - **series or single total?** `reach` with `period=day` returned a 30-day series. `total_value` typically returns _one aggregate for the window_.
     - **does a one-day window (`since` = `until`) yield a usable daily value?** This is the decisive one: it determines whether a per-day backfill is possible at all.
     - how far back the window can be pushed before values stop.
- **Why the shape question decides a table:** if those four metrics only support `total_value`, there is no daily series for them, and per-day values mean **one request per day** — 30 for a month, 365 for a year. Affordable at ~1% observed usage, but a different operation from the single windowed call `reach` supports. The schema question is therefore not only "which shape" but **whether `account_daily` can hold all five metrics per day at all, or whether four of them are window aggregates needing their own table.**
- **Owner:** account owner — holds the token.
- **Blocker:** Task 3.1 cannot be written until this returns.

### Task 2.7 — Verify the `FOLLOWER` / `NON_FOLLOWER` mapping ★

- **Steps:** request `follower_count` as a series over the **same 30-day window**; take the net change end to end; compare against `FOLLOWER − NON_FOLLOWER` (here, `37 − 61 = −24`).
- **Reading it:** the **sign** is what discriminates. If net change is ≈ −24, `FOLLOWER` means follows and `NON_FOLLOWER` means unfollows. If it is ≈ +24, the mapping is reversed. If it is neither, the dimensions mean something else entirely.
- **Two caveats on the method:** if the net change happens to be near zero the test is **inconclusive**, and a longer window is needed. And window boundaries must match exactly — an off-by-one at either edge produces a small mismatch, so tolerate magnitude drift and judge on sign.
- **If it cannot be confirmed:** the dashboard shows the metric **unlabelled or not at all**. It does not guess. A confidently inverted number under the word "unfollows" is precisely the failure mode this project is organised against.
- **Record the verification and its result in `docs/graph-api.md`.** This is a semantic question about someone else's API and it will otherwise be forgotten and then re-guessed.

### Task 2.8 — Write `docs/graph-api.md`

- **Steps:** write it from probe output, not from Meta's documentation. It must carry, at minimum:
  - `metric_type=total_value` and exactly which metrics require it
  - `follower_count` (metric, singular) vs `followers_count` (account field)
  - the `media_count` 229-vs-243 discrepancy, and that **pagination exhaustion is the terminator**
  - the checkpoint limitation: historical posts can hold only `latest`
  - the `FOLLOWER`/`NON_FOLLOWER` verification and its outcome
  - the pinned API version, and the version Meta actually served
  - Meta error code `1` as transient, worth retrying
- **Blocker:** Stage 3 does not start until this exists.

## Stage 3 — Foundation

**Task 3.1** — Data model (**A1**). **Blocker: Task 2.6 only** — the `account_daily` / `account_windows` shape. Q1 and Q2 are answered; the rest of the schema is unblocked.

**Task 3.2 — Backups** ⛔ blocks 3.3

- Steps: `backup.yml`; weekly `pg_dump` against the pooler string; upload as a workflow artifact at maximum retention; **assert a plausible minimum size and fail loudly otherwise**; restore one dump into a scratch database and confirm it reads back.
- Notes: `account_daily` is the only data in this system that cannot be re-fetched from Meta. Everything else is a re-sync away. Supabase Free has no automated backups, so this workflow is the entire disaster-recovery story. **An untested backup is not a backup** — the restore is part of the task, not a follow-up.
- **Blocker: this ships before the sync starts writing.** It sits ahead of 3.3 rather than at the end of the stage for one reason: the daily sync is what begins accumulating the irreplaceable table, and a backup added afterwards protects only the period after it. Backup first, then start collecting.

**Task 3.3** — Sync layer (**A2**) + the Actions loop, **including the one-time backfill**.

- Steps: rate-limit handling and the resumable cursor **first**, then account → media → insights → comments, each shipped and verified separately, then the backfill as an explicit first-run mode.
- The backfill is not a side effect of the daily sync. It runs once, guarded by a flag or by `post_insights` being empty; it writes `latest` only; it reuses the same cursor and per-run budget; it is deliberately throttled; and it retries Meta error code `1` before writing `unavailable`.
- Notes: backoff and the 429 path are not a hardening pass at the end. The full walk of 243 posts plus the backfill is the largest burst the app will make and it happens on day one of this task. Measured headroom is ~1% of the hourly allowance, which makes it affordable — not a reason to drop the guards.
- Blocker: 3.2. Also — the first sync must be run and watched, not fired and assumed. Meta's usage headers go into `sync_runs.stats` and onto the settings page in the same task.

**Task 3.4** — Provider interface (**A4**).

- Steps: read the project's live limits from AI Studio; record them in `docs/quota.md` **with the date observed**; measure the actual calls-per-message ratio from a handful of real chat turns; set caps in **calls**, not messages; wire per-purpose rationing with card generation reserving first.
- Notes: the ratio is the number that matters. A cap that looks generous in messages is several times tighter in calls once the tool loop runs. Write the assumed ratio down next to the cap so a later surprise is diagnosable.

**Task 3.5** — Validation layer (**A5**), with tests, before either consumer exists.

**Task 3.6** — Design system (**A6**), including empty and thin-data components.

## Stage 4 — Chat

Per **B1**'s implementation plan. **Does not close until the Stage 2 acceptance test passes against real data.**

## Stage 5 — Dashboard

Per **B2**. The card→chat contract closes the seam with Stage 4.

## Stage 6 — Calendar

Per **B3**. `lib/time.ts` and its boundary test come first.

## Stage 7 — Commercial track (roadmap-level only)

**Task 7.1 — Meta App Review.** Standard Access covers only accounts the developer owns. Advanced Access needs per-permission submissions with screencasts of each permission in use, plus business verification, a privacy policy URL and a data-deletion callback. **Pure calendar time — it cannot be compressed later**, and it gates the first non-owner user.
**Task 7.2 — Paid model tier.** Free-tier data use is not acceptable once another person's data flows through it (**A4**).
**Task 7.3 — Auth.** `account_id` is already everywhere (decision 1); this adds users, per-user OAuth, and per-user token refresh.

---

# PART D — OPEN QUESTIONS

Q1, Q2 and Q4 are answered. What remains is one shape question that blocks the
schema, one range question, and one semantic question about someone else's API.

| #         | Question                                                                                                                                                                                                      | Resolution method                                                                                                                                | Owner         | What changes on the answer                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q3a** ★ | Do `views`, `profile_views`, `accounts_engaged` and `total_interactions` return a **per-day series** or a **single window total** — and does a one-day window (`since` = `until`) yield a usable daily value? | Task 2.6 — re-run with `metric_type=total_value` over 2/7/30/90/365 days                                                                         | Account owner | **Whether `account_daily` can hold all five metrics per day at all**, or whether four of them are window aggregates needing their own table. Blocks Task 3.1. |
| **Q3b**   | How far back do account insights reach — is 30 days the ceiling, or do 90 and 365 also return?                                                                                                                | Task 2.6                                                                                                                                         | Account owner | How much history the first sync populates, and how deep the backup requirement really is.                                                                     |
| **Q2a** ★ | Do `FOLLOWER` / `NON_FOLLOWER` mean follows / unfollows, or something else?                                                                                                                                   | Task 2.7 — compare `FOLLOWER − NON_FOLLOWER` (−24) against the net change in the `follower_count` series over the same window; **judge on sign** | Account owner | Whether the dashboard can label these at all. If unconfirmed it shows the metric unlabelled or not at all — it does **not** guess.                            |
| **Q5**    | What are the current free-tier quota limits?                                                                                                                                                                  | Read live from AI Studio; record with date                                                                                                       | Account owner | Rationing caps. **Never hardcode a number from a blog** — limits were cut in late 2025 and are no longer published statically.                                |

### Resolved, kept for the record

- **Q1 — how far back do media insights reach?** No boundary. 242/243 posts, oldest 2021-06-04, 1,907 days. The sparse-dashboard premise is dead and a backfill is mandatory.
- **Q2 — does `follows_and_unfollows` return values?** Yes, with `metric_type=total_value` **and** `breakdown=follow_type`. The remaining question is semantic, not existential — see Q2a.
- **Q4 — what is the chat's acceptance test?** Set. Answer-and-refuse in one turn; see **B1**.
- **Is `shortcode` present on every media type?** Present across the types this account posts. The join key holds.
- **Is `thumbnail_url` universally present?** No — type-conditional, `VIDEO/REELS` only. Confirmed, and the probe now labels it correctly rather than reporting a false absence.

---

# PART E — VERIFICATION

How each stage is proven, not assumed.

| Stage | Verified by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | `Hussain2111/Trellis` still loads with all three branches and all four docs — **already verified at `2c97c27`**. The new repository exists separately under a new name. **Nothing was renamed, emptied or deleted.**                                                                                                                                                                                                                                                                                     |
| 1     | Vercel deploy green · Supabase migration applied through the script · **GitHub Actions run returns 200 from the authenticated route** · settings page shows correct resolved values · Deployment Protection confirmed off                                                                                                                                                                                                                                                                                |
| 2     | Each probe prints a reconciliation table. **Findings sent back as the terminal table, never the JSON — it contains real account data.** `docs/graph-api.md` written from output, not from Meta's docs.                                                                                                                                                                                                                                                                                                   |
| 3     | Migrations reversible on a scratch database seeded through the script. Sync run twice → identical row counts (idempotent). A deliberately failed metric writes `null` with a reason, never `0`. **The first full sync watched end to end**, with Meta's usage headers observed and a rate-limited interruption confirmed to resume from its cursor rather than restart. **One backup dump restored into a scratch database and `account_daily` read back from it** — an untested backup is not a backup. |
| 4     | **The acceptance test in B1**, graded twice — once at the start of the stage, and again a week or two later once post-go-live posts have real curves, when it must split the set rather than refuse wholesale. Every figure checked by hand against the database. Plus questions designed to make it lie: a comparison whose sample floor genuinely is not met (rarer now, so it must be constructed), a checkpoint that was never sampled, and a question about data it does not have.                  |
| 5     | A fake model returning six cards, two with invented numbers → four render. First real batch read by hand for usefulness.                                                                                                                                                                                                                                                                                                                                                                                 |
| 6     | An entry at `…T22:00:00Z` renders Monday 01:00 and files into the Monday week. Copy→paste→post performed end to end **on a phone**.                                                                                                                                                                                                                                                                                                                                                                      |

**Standing verification, every deploy:** a live smoke suite against production. The previous build had 246 green tests and broke on first contact with real services. More unit tests are not the mitigation; touching the real thing is.

---

# APPENDIX — carried-forward scar tissue

Checked at the stage named. Each cost real time to learn.

| Item                                                                                                | Stage                           |
| --------------------------------------------------------------------------------------------------- | ------------------------------- |
| Deployment Protection is on by default and 401s every scheduler and webhook                         | 1.3                             |
| Never mark Vercel variables Sensitive — they become unreadable                                      | 1.3                             |
| Tick all three environments; env changes need a redeploy                                            | 1.3                             |
| Scheduler must target the stable domain, never a per-deployment URL                                 | 1.4                             |
| Vercel Hobby cron: 2 entries, once daily each — a cap, not a rate                                   | A3                              |
| Supabase pooler string, transaction mode, prepared statements off                                   | 1.2                             |
| Supabase direct hostname is IPv6-only on new projects                                               | 1.2                             |
| Free tier pauses after ~7 days — keepalive must perform a real write                                | A3                              |
| **Free tier has no automated backups** — and `account_daily` is the only table Meta cannot re-serve | **3.2, before the sync writes** |
| **Meta enforces hourly traffic caps; the first sync is the largest burst the app ever makes**       | **3.3**                         |
| Migrations through a script, never the SQL editor                                                   | 1.2                             |
| `psql` seeding skips the migration tool's bookkeeping table                                         | 3.1                             |
| Nothing advances work by itself; the answer is never "a browser tab"                                | A3                              |
| Read the declared input schema before writing the caller                                            | 2.x                             |
| Probes import nothing from app code                                                                 | 2.x                             |
| Reality disagreeing with docs → fix code and fixture in the same commit                             | 2.5                             |
| `pkill -f "next start"` doesn't work — the process is `next-server`; use `fuser -k 3000/tcp`        | —                               |
| A ruling about storage is not a ruling about computation — ask which wins                           | —                               |
| Code disagreeing with the spec means the **spec** states intent; check the sibling module too       | —                               |
