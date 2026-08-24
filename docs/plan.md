# Trellis — rebuild plan

## Context

Trellis is a tool for one Instagram creator (`glowithuzma`, K-beauty, 4,881 followers, 228 posts) that reads their own account through Meta's Graph API. A previous build shipped ten features, deployed late, and discovered every real infrastructure bug within hours of first contact with live services. It is being discarded and the repository recreated.

What is _not_ being discarded is the operational knowledge. That record — `NOTES.md`, `docs/roadmap.md`, `docs/cutover.md`, `docs/instagram-setup.md`, 3,291 lines — exists only in `Hussain2111/Trellis`, on branch `claude/trellis-v1-growy-parity-n509nm` at `2c97c27`. **So that repository is left exactly as it is.** The new build gets a new repository under a new name, which means the old one never has to be renamed, emptied or deleted, and no file has to be correctly enumerated to survive.

The new product is three surfaces and nothing else: a **Chat** grounded in the account's own data, a **Dashboard** of AI insight cards over account metrics, and a **Calendar** for drafts and posting dates. It runs at $0/month, serves one account, and is intended to become a commercial SaaS later.

The outcome this plan is aimed at: a deployed skeleton meeting real infrastructure before any feature exists, then three surfaces built on one schema, one design language, and one way of calling a model — with a hard guarantee that no number reaches the screen unless a SQL query produced it.

---

## Decisions taken this session

| #   | Decision                                                       | Consequence                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`account_id` on every table, no auth**                       | One row in `accounts`. No users table, no login. The retrofit is the expensive part of multi-tenancy, not the column.                                                                                                                                                        |
| 2   | **Private repository**                                         | Private repos get 2,000 free Actions minutes a month; three daily workflows plus a weekly backup use a small fraction of that. Going public would have made the source of a product intended for sale world-readable in exchange for a resource already available. Reversed. |
| 3   | **No post-analytics readout, but keep the data** — reconfirmed | The dashboard's lower half is account/follower metrics only. **There is deliberately nowhere in the UI to glance at how recent posts performed.** Per-post insights are still synced and reachable by asking the chat.                                                       |
| 4   | **Chat acceptance test deferred to Stage 2**                   | Set once the probes show what data actually exists to reason over. Stage 4 cannot close until it is set and met.                                                                                                                                                             |
| 5   | **Buffer → validate → render** for chat output                 | No token streaming of answer text. Tool progress may stream. The drop-don't-caveat rule is unconditionally enforceable this way.                                                                                                                                             |

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

| Table           | Key columns                                                                                                                                                                                                                    | Notes                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post_insights` | `post_id`, `checkpoint` (`t24`\|`t48`\|`t7d`\|`latest`), `captured_at`, `reach`, `views`, `saved`, `shares`, `likes`, `comments`, `total_interactions`, `unavailable` jsonb — unique on (`post_id`, `checkpoint`)              | Meta serves cumulative lifetime totals with no historical curve, so **a curve only exists if it was sampled**. This table is the sampling record. `unavailable` names _why_ a metric is missing, so a blank can explain itself. |
| `account_daily` | `account_id`, `day` (text `YYYY-MM-DD`, Riyadh), `followers_count`, `reach`, `views`, `profile_views`, `accounts_engaged`, `total_interactions`, `follows`, `unfollows`, `unavailable` jsonb — unique on (`account_id`, `day`) | `follows`/`unfollows` nullable pending **Q2**. `day` as text, not date, so the Riyadh boundary is decided once at write time.                                                                                                   |

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
**Blockers.** `account_daily`'s `follows`/`unfollows` shape depends on **Q2**; `post_insights` depth depends on **Q1**. Both resolve in Stage 2, before this schema is written.

## A2 — Sync layer

`lib/graph/` (client), `lib/sync/` (orchestration), `app/api/sync/route.ts`.

**Four sync units**, each independently resumable and independently failable:

| Unit            | Fetches                                                                                                                              | Cadence                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `account`       | Account fields + account insights (`reach`, `views`, `profile_views`, `accounts_engaged`, `total_interactions`) into `account_daily` | Daily                                  |
| `media`         | Media edge, paginated, cursor in `sync_runs.cursor`                                                                                  | Daily; full walk on first run          |
| `post_insights` | Per-post insights at whichever checkpoints are now due                                                                               | Daily, and this is what creates curves |
| `comments`      | Comments for the most recent N posts                                                                                                 | Daily                                  |

**Partial failure is the design centre, not an edge case:**

- A metric Meta declines is written `null` with a reason in `unavailable`. **Never `0`.**
- A failing post does not fail the page. A failing page records its cursor and returns `{done: false}` so the runner calls again.
- The endpoint returns `{done, cursor, stats}`. It never blocks longer than the function's ceiling; it returns and expects to be called back.
- Every unit is idempotent. Re-running never double-counts.

**Checkpoint policy.** On each run, for each post, write the checkpoints now due: `t24` if 24–36h old, `t48` if 48–60h, `t7d` if 7–8d, and `latest` always. A post older than a checkpoint's window at first sync **does not get that checkpoint, ever** — it renders as _not measured_, which is a different statement from zero and must be labelled as such.

### Rate limiting — designed for, not discovered

**The first sync is the largest burst this app will ever make**, and it happens before anything else works. 228 posts means a full media walk plus a per-post insights request each; if **Q1** comes back deep, a backfill lands on top of that. Meta enforces hourly traffic caps, so first run is precisely where one gets hit. This is a first-contact bug of exactly the class Stage 1 exists to catch, and no unit test will find it.

Required in the client and the runner, not bolted on later:

- **429 and Meta's error-code handling as a first-class path.** A rate-limit response is a normal outcome, not an exception — it returns `{done: false}` with the cursor intact.
- **Exponential backoff with jitter**, honouring `Retry-After` when present.
- **A cursor that survives being rate-limited mid-walk.** `sync_runs.cursor` is written _before_ each page is processed, not after, so an interruption resumes from the right place rather than restarting the walk.
- **A per-run request budget.** The run stops itself well short of the cap and returns; the Actions loop calls again. Spreading the first sync across several runs is correct behaviour, not a failure.
- **Meta's own usage headers recorded** into `sync_runs.stats` and surfaced on the settings page, so throttling is visible before it becomes a stall.
- **A deliberately throttled first sync.** The initial full walk runs slower than steady-state syncing on purpose.

**Resources.** `docs/graph-api.md` (written from probe output, not from Meta's docs). Pinned API version from a single env-driven constant, surfaced on the settings page.
**Blockers.** Q1, Q2, Q3.

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

Posts, comments and per-post insights can be re-fetched from Meta at any time. **`account_daily` cannot.** It is built one row per day by a cron, and Meta does not serve it retroactively (pending **Q3**, which may soften this by ~30 days but not by months). If the database is lost after six months, six months of follower history is gone permanently — and Supabase Free has no automated backups.

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

**Acceptance test: set in Stage 2, met in Stage 4.** It must be a question a general-purpose chatbot could not answer. Deferred by decision 4 because the probes determine what data exists to ask about. **Stage 4 cannot close without it.**

### Design

**Tool surface** — every tool returns `{ data, sampleSize, coverage, asOf }`, so thin data and staleness travel with the answer rather than being available on request:

| Tool                                     | Returns                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAccountOverview()`                   | Followers, post count, sync freshness, insight coverage                                                                                              |
| `getFollowerSeries({days})`              | Daily series with explicit gaps — a missing day is missing, not zero                                                                                 |
| `getPosts({limit, format, since, sort})` | Content: caption, format, date, permalink                                                                                                            |
| `getPostPerformance({postId})`           | Per-post insights incl. available checkpoints                                                                                                        |
| `getPostsRanked({metric, since, limit})` | Ranked, with the count actually measured                                                                                                             |
| `getTrailingMedian({metric, days})`      | The account's own baseline                                                                                                                           |
| `getFormatBreakdown({minSample})`        | **Returns a refusal object when floors are unmet** — 9 carousels and 1 reel is this account's real pattern, so this is the default case, not an edge |
| `getComments({postId?, top?})`           | Commenters and what they commented on                                                                                                                |
| `getCalendarEntries({from, to, status})` | So "what's due this week" is answerable. **Ships in Stage 4 returning an honest empty result**, not in Stage 6 — see note below                      |
| `getInsightCard({id})`                   | The card→chat contract — see **B2**                                                                                                                  |

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

**Task 0.2 — Create the new repository**

- Steps: create a **new, private** repository under a new name (`trellis-v2` or similar); it is empty and unrelated to the old one.
- **Blocker:** must be done by the account owner through the GitHub UI. This session's GitHub access is scoped to the contents of one repository and carries no account-level permissions — repository creation, renaming and visibility changes all return `403 Resource not accessible by integration`.
- Notes: a session working in the new repository has to be started against it. This one cannot reach it.

## Stage 1 — Walking skeleton, in production

Deploy to real infrastructure before any feature exists. Every genuine infrastructure bug in the last build surfaced within hours of first contact and **none were reachable from local tests or CI**.

**Task 1.1 — Repository and CI**

- Steps: new **private** repo; Next app; ESLint/Prettier; CI running typecheck, lint, format, migrations and tests **against a real Postgres service container**.
- Notes: real Postgres in CI caught driver-level bugs last time that no mock would have. Private is the deliberate choice (decision 2) — 2,000 free Actions minutes covers four light workflows several times over, so there is nothing to buy by publishing the source.

**Task 1.2 — Supabase**

- Steps: create project; take the **connection pooler** string (transaction mode); disable prepared statements; write the migration **script**; one `accounts` table; migrate.
- Notes: pooler, not direct — serverless functions are short-lived and numerous. The direct hostname is IPv6-only on new projects and unreachable from some networks; a connection that hangs with no error is this.
- Blocker: migrations run through the script, never pasted into the SQL editor — the editor autocommits per statement, so a guard aborting a destructive step raises _after_ the destruction committed.

**Task 1.3 — Deploy to Vercel**

- Steps: import; set env vars **with all three environments ticked** and **not marked Sensitive**; deploy; **turn Deployment Protection off**; redeploy.
- Notes: Sensitive makes a variable write-only, so a failed save is indistinguishable from a successful one — the previous build is still stuck with unreadable values. Environment changes need a redeploy. Deployment Protection is on by default and 401s every webhook and scheduler; it can return if the project is recreated.

**Task 1.4 — Scheduler, end to end**

- Steps: `CRON_SECRET`; an authenticated no-op route; `keepalive` on Vercel cron; a GitHub Actions workflow with repo variable `APP_URL` and repo secret `CRON_SECRET`; watch it return 200.
- Notes: `APP_URL` must be the **stable production domain**. Per-deployment URLs change every deploy and the scheduler silently no-ops.

**Task 1.5 — The settings page**

- Steps: render **resolved** env values the running function sees; pinned API version; token scopes with all seven checked; last sync; today's model usage.
- Notes: built first, not last. In the previous build this was more reliable than Vercel's own dashboard for confirming a variable change took effect, and it is the instrument panel for every debugging session after this one.

## Stage 2 — Probes, before the sync layer is written

Standalone scripts in `scripts/`, importing **nothing** from app code — a probe sharing the code under test can only confirm its own assumptions. Each field requested individually so one failure doesn't mask others. Each media type probed separately.

**Task 2.1 — Token and scopes** — _mostly done already; this is re-verify and record_

- Already established and **unaffected by the repository rename** — the Meta app is a separate thing that still exists: the `trellis` app (`4365362137020369`), all seven scopes, the `Skincaring` Page (`223324307523350`), and `IG_USER_ID` `17841402326320043`.
- Steps: confirm the long-lived token is still valid and still carries all seven scopes; record the values in the new repo's `.env.example` and setup doc; **do not re-run the Facebook Login flow unless the token has expired.**
- Notes if it does need regenerating: Facebook Login flow, **not** "Instagram API with Instagram Login" — the latter issues a different token type and the resolution path doesn't exist on it. Resolution is user token → `/me/accounts` → Page id → `/{page-id}?fields=instagram_business_account` → `IG_USER_ID`. And without `business_management`, `/me/accounts` returns `{"data": []}` — empty, not an error, reading as "administers no Pages" rather than "token lacks a permission". Document that failure mode wherever scopes are listed and make the scope check test all seven.

**Task 2.2 — Media insights lookback (Q1)** ★

- Steps: paginate the media edge; request insights at increasing post age, specifically around 6, 9 and 12 months; report the oldest post returning data and the first that doesn't.
- Notes: **highest-value unknown.** Determines whether the chat reasons over most of the account's history or a handful of recent posts. A backfill task is conditional on the answer.

**Task 2.3 — `follows_and_unfollows` (Q2)**

- Steps: re-request over 30 days with explicit `since`/`until`.
- Notes: decides whether the dashboard shows gross follows and unfollows or only net deltas. **Plan for both.**

**Task 2.4 — Account-insight backfill (Q3)**

- Steps: request account insights with explicit `since`/`until` across a 30-day window.
- Notes: the claim that account insights don't backfill is consistent with a _default_ request returning ~2 days, but the endpoint accepts an explicit range. If it serves retroactively, the follower chart is populated on day one instead of blank for a month. One request; materially changes first-run.

**Task 2.5 — Fold findings in**

- Steps: write `docs/graph-api.md` from probe output; set the pinned API version; **set the chat acceptance test** (decision 4).
- Notes: when reality disagrees with documentation, code and fixture change in the same commit. A fixture mirroring a wrong assumption manufactures confidence.
- Blocker: Stage 3 does not start until the acceptance test is written down.

## Stage 3 — Foundation

**Task 3.1** — Data model (**A1**). Blocker: Q1, Q2, Q3.

**Task 3.2 — Backups** ⛔ blocks 3.3

- Steps: `backup.yml`; weekly `pg_dump` against the pooler string; upload as a workflow artifact at maximum retention; **assert a plausible minimum size and fail loudly otherwise**; restore one dump into a scratch database and confirm it reads back.
- Notes: `account_daily` is the only data in this system that cannot be re-fetched from Meta. Everything else is a re-sync away. Supabase Free has no automated backups, so this workflow is the entire disaster-recovery story. **An untested backup is not a backup** — the restore is part of the task, not a follow-up.
- **Blocker: this ships before the sync starts writing.** It sits ahead of 3.3 rather than at the end of the stage for one reason: the daily sync is what begins accumulating the irreplaceable table, and a backup added afterwards protects only the period after it. Backup first, then start collecting.

**Task 3.3** — Sync layer (**A2**) + the Actions loop.

- Steps: rate-limit handling and the resumable cursor **first**, then account → media → insights → comments, each shipped and verified separately.
- Notes: backoff and the 429 path are not a hardening pass at the end. The first full walk of 228 posts is the largest burst the app will make and it happens on day one of this task.
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

| #                                                                                                                                                                                                                                                                                                                                                                   | Question                                             | Resolution method                                      | Owner                           | What changes on the answer                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Q1** ★                                                                                                                                                                                                                                                                                                                                                            | How far back do media insights reach?                | Probe posts at 6, 9, 12 months (Task 2.2)              | Account owner — holds the token | Whether the chat reasons over most of the account's history or a few recent posts. A conditional backfill task.                |
| **Q2**                                                                                                                                                                                                                                                                                                                                                              | Does `follows_and_unfollows` return values?          | Re-request over 30 days (Task 2.3)                     | Account owner                   | Gross follows/unfollows on the dashboard, or net deltas only. `account_daily` column shape.                                    |
| **Q3**                                                                                                                                                                                                                                                                                                                                                              | Do account insights backfill with an explicit range? | Request with `since`/`until` across 30 days (Task 2.4) | Account owner                   | Whether the follower chart is populated on day one or blank for a month.                                                       |
| **Q4**                                                                                                                                                                                                                                                                                                                                                              | What is the chat's acceptance test?                  | Set in Task 2.5, once Q1–Q3 are known                  | Both                            | Whether Stage 4 can close.                                                                                                     |
| **Q5**                                                                                                                                                                                                                                                                                                                                                              | What are the current free-tier quota limits?         | Read live from AI Studio; record with date             | Account owner                   | Rationing caps. **Never hardcode a number from a blog** — limits were cut in late 2025 and are no longer published statically. |
| **Resolved, kept for the record:** _is `shortcode` present on every media type?_ Probe output shows it present on **both** the carousel and the reel — the two types this account actually posts. Images remain unprobed only because none exist to probe. Treat `shortcode` as available; the join key holds. If an image is ever published, confirm it once then. |

---

# PART E — VERIFICATION

How each stage is proven, not assumed.

| Stage | Verified by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | `Hussain2111/Trellis` still loads with all three branches and all four docs — **already verified at `2c97c27`**. The new repository exists separately under a new name. **Nothing was renamed, emptied or deleted.**                                                                                                                                                                                                                                                                                     |
| 1     | Vercel deploy green · Supabase migration applied through the script · **GitHub Actions run returns 200 from the authenticated route** · settings page shows correct resolved values · Deployment Protection confirmed off                                                                                                                                                                                                                                                                                |
| 2     | Each probe prints a reconciliation table. **Findings sent back as the terminal table, never the JSON — it contains real account data.** `docs/graph-api.md` written from output, not from Meta's docs.                                                                                                                                                                                                                                                                                                   |
| 3     | Migrations reversible on a scratch database seeded through the script. Sync run twice → identical row counts (idempotent). A deliberately failed metric writes `null` with a reason, never `0`. **The first full sync watched end to end**, with Meta's usage headers observed and a rate-limited interruption confirmed to resume from its cursor rather than restart. **One backup dump restored into a scratch database and `account_daily` read back from it** — an untested backup is not a backup. |
| 4     | The Stage 2 acceptance test, answered from real rows, checked by hand against the database. Plus three questions designed to make it lie: a format comparison it must decline, a period beyond the insights boundary, and a question about data it doesn't have.                                                                                                                                                                                                                                         |
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
