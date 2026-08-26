# The Graph API, as it actually behaves

Written from probe output, not from Meta's documentation. Where the two
disagree, this file is right and the documentation is a description of a
different version.

`[VERIFIED-LIVE]` means observed in a real response. `[PENDING]` means a probe
is written for it and has not been run yet.

---

## Auth

Seven scopes. The list and the account-resolution path live in
`lib/graph/scopes.ts`; this is the part worth repeating.

**`business_management` fails silently.** Without it, `GET /me/accounts`
returns `{"data": []}` — empty, and **not** an error — while
`GET /me?fields=id,name` returns the correct profile. It reads as "this user
administers no Pages", not "this token lacks a permission". Nothing anywhere
says a permission is missing. `[VERIFIED-LIVE]`

Use the **Facebook Login** flow, not "Instagram API with Instagram Login" — the
latter issues a different token type and the resolution path does not exist on
it.

## Version

The app pins `GRAPH_API_VERSION` and `/settings` prints it. **Meta silently
upgrades calls to a retired version** — a previous build requested v21.0 and
every response URL came back v26.0. That is exactly how a renamed metric turns
real engagement into nulls with nothing noticing, so the probes read the served
version off the response body rather than trusting the request.

## Media edge

**Terminate pagination by exhaustion, never by `media_count`.**
`[VERIFIED-LIVE]` The account field reported **229** where a full walk found
**243**. A completion check against the count stops 14 posts short — silently,
and in a way that looks like success.

**`thumbnail_url` is type-conditional.** `[VERIFIED-LIVE]` Present on
`VIDEO`/`REELS`, absent on `CAROUSEL_ALBUM` and `IMAGE`, which carry
`media_url`. Store both; select by type. A probe that inspects only the newest
post reports it absent when a reel two rows down carries it.

**`shortcode` is present** across the types this account posts, so it holds as
the join key. `lib/insights/graph.ts` drops a media item entirely when shortcode
resolves to null, so a type that omitted it would lose posts rather than store
them incomplete.

## Media insights

**There is no lookback boundary.** `[VERIFIED-LIVE]` **242 of 243 posts return
insights**; the oldest is **2021-06-04, 1,907 days old**, and no older post
lacked data. Whatever the ceiling is, it is beyond this account's entire
history.

**Metrics are identical across formats.** `reach`, `views`, `saved`, `shares`,
`likes`, `comments`, `total_interactions`, all `period: lifetime`, for reels and
carousels alike. A batched request works for both. There is no format
divergence to design around.

**Meta serves cumulative lifetime totals and no historical curve.** This is the
single most important consequence in the file:

> A curve exists **only if it was sampled at the time**. The backfill can fill
> `checkpoint = 'latest'` for all 243 posts. It can **never** produce `t24`,
> `t48` or `t7d` for a post published before the app existed, because producing
> one would mean inventing a measurement.

So per-post data has two permanent shapes: historical posts hold one `latest`
row — fine for medians, baselines, ranking and format comparison — and posts
published after go-live hold a real curve. Absence of `t48` must read as **not
sampled**, distinct from zero and distinct from **too new**.

**Error code `1` is transient.** `[VERIFIED-LIVE]` One post returned
`[1] An unknown error occurred`. That is Meta's generic transient error, not a
permanent one — retry two or three times with backoff before writing
`unavailable`. Coverage of 242/243 is likely 243/243 after retries.

## Account insights

**`metric_type=total_value` is required** for `views`, `profile_views`,
`accounts_engaged` and `total_interactions`. `[VERIFIED-LIVE]` Without it the
request fails outright:

```
(#100) The following metrics (views) should be specified with parameter metric_type=total_value
```

It fails rather than degrading, which is the good case — but it means a client
that omits it gets nothing at all from four of five metrics. `reach` does not
need it.

**`reach` and `follower_count` backfill.** `[VERIFIED-LIVE]` A 30-day window
with explicit `since`/`until` returned 30 days of values for both. The follower
chart is therefore populated on day one rather than blank for a month.

**`follower_count` (singular) is the insights metric. `followers_count`
(plural) is the account field.** Two names for closely related things. In the
schema: `accounts.followers_count` is the current value, `account_daily`'s
series is `follower_count`.

### Shape and cost `[VERIFIED-LIVE]`

| Metric               | `metric_type=total_value` | Shape        | Requests for N days |
| -------------------- | ------------------------- | ------------ | ------------------- |
| `reach`              | optional                  | **series**   | 1 per 30-day window |
| `follower_count`     | **REJECTED**              | **series**   | 1 per 30-day window |
| `views`              | **required**              | window total | N — one per day     |
| `profile_views`      | **required**              | window total | N                   |
| `accounts_engaged`   | **required**              | window total | N                   |
| `total_interactions` | **required**              | window total | N                   |

Every metric yields a usable value from a one-day window, so `account_daily`
holds all six keyed by day. But the cost is not uniform and neither is the
parameter — `follower_count` errors:

```
(#100) The following metric (follower_count) is incompatible with the metric type (total_value)
```

Applying `total_value` uniformly therefore breaks four metrics or one,
depending which way you guess. It is a per-metric lookup, not a flag.

### 30 days is a per-request CAP, not a horizon `[VERIFIED-LIVE]`

```
(#100) There cannot be more than 30 days (2592000 s) between since and until.
```

A window placed **entirely in the past** returns data: `reach` served a 29-day
series for **365 → 336 days ago**. So history is walked by **paging backwards
in 30-day windows** until values stop, and that stopping point is the real
horizon.

Every window that ends at `now` is useless for answering this — a range cap and
a history boundary produce identical output — which is how an earlier probe run
reached the wrong conclusion.

**`follower_count`'s own depth is still unknown.** A probe fallback retried
with `total_value` on _any_ error and returned the retry's message, so every
past-window attempt reported the incompatibility above instead of whatever the
plain request actually said. Fixed; needs one more run.

### `reach` is not additive

It counts **unique accounts**, so an account reached on Monday and Wednesday is
one reach for the window and two in a sum of days. **Never sum daily reach into
a period figure** — request the window total instead. Summing is a live route to
a confidently wrong number on a page whose whole claim is that it does not
produce those.

## `follows_and_unfollows`

**It returns values, with both parameters.** `[VERIFIED-LIVE]`
`metric_type=total_value` **and** `breakdown=follow_type`, over 30 days:

```
[{"dimension_values":["FOLLOWER"],"value":37},
 {"dimension_values":["NON_FOLLOWER"],"value":61}]
```

### `[PENDING]` — what the dimensions mean

**The keys are `FOLLOWER` and `NON_FOLLOWER`, not `FOLLOW` and `UNFOLLOW`.**
Reading the first as follows and the second as unfollows is plausible. So is a
reading where the breakdown describes the actor's relationship at the time of
the event. **Getting it backwards puts a confidently inverted number on the
dashboard under the word "unfollows"** — precisely the failure the
blank-not-zero discipline exists to prevent.

**The check**, run by `probe:account-insights`: net follower change over the
same window should equal follows − unfollows, so compare it against
`FOLLOWER − NON_FOLLOWER` (here, `37 − 61 = −24`) and **judge on sign**.

Three caveats, all of which the probe handles:

- **Magnitude will drift.** Window edges do not align perfectly. The sign is the
  signal; a few units either way mean nothing.
- **A near-zero net change is inconclusive, not confirming.** Both mappings
  predict roughly nothing, so agreement proves nothing. Widen the window and
  re-run.
- **`follower_count` may be a daily delta or a running total** depending on the
  account. The probe reports both readings so the comparison cannot be made
  against the wrong one.

**Outcome:** _pending_.

**If it cannot be confirmed, the dashboard shows this metric unlabelled or not
at all.** It does not guess.

## A trap that is not Meta's fault

`lib/env.ts` reads `process.env` and nothing else. Vitest does not load `.env`,
so before `vitest.config.ts` gained `setupFiles: ['dotenv/config']` the
DB-backed tests fell through to the schema default in `lib/env.ts` and ran
against **whatever database happened to be at that address** — on a machine
that has ever run another project, a real database with a real schema that is
not this one.

It surfaced as a schema test reporting fourteen columns "missing from the
schema entirely" while `psql` showed them present and correct. The tell was a
row coming back from a table this project does not have.

dotenv does not override variables already set, so CI keeps the `DATABASE_URL`
it exports and only local runs read the file.

## Rate limits

After walking 243 posts and requesting insights for each: `[VERIFIED-LIVE]`

```
x-business-use-case-usage: call_count: 1, total_cputime: 1, total_time: 1,
                           estimated_time_to_regain_access: 0
```

Read as percentages of the hourly allowance — roughly **one percent for the
largest operation the app will ever perform**. The backfill is comfortably
affordable, and a per-day backfill of 365 requests would be too.

**None of the guards come out on the strength of this.** Backoff, the resumable
cursor and the per-run budget cost nothing when unused, and they are the
difference between a throttled sync that resumes and one that silently
restarts. A headroom measurement taken once on one account is not a guarantee
about every future run. The usage headers go into `sync_runs.stats` and onto
`/settings`.
