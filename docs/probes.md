# Probes

Read-only, local, free. They import nothing from `lib/` — a probe that shares
the app's client code can only ever confirm the app's own assumptions, and on
the previous build the caller and every fixture were wrong together while all
246 tests passed.

## Running them

Put a seven-scope token in your local `.env` — not in Vercel. Nothing but these
scripts reads it there.

```bash
npm run probe:graph              # token, scopes, account, media, insights
npm run probe:lookback           # Q1 — how far back insights reach
npm run probe:account-insights   # Q2 and Q3 — follows/unfollows, backfill
```

**Send back the terminal table. Never the JSON** — it contains real account
data, and `probe-*.json` is gitignored for that reason.

## What each one settles

| Probe                    | Question                                                                                                                                                                        | What changes on the answer                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe:graph`            | Is the token right, and what does the media edge actually serve?                                                                                                                | Field mapping, and whether `business_management` is present                                                                                                    |
| `probe:lookback`         | **Q1** — how far back do media insights reach?                                                                                                                                  | Whether the chat reasons over most of the account's history or a handful of posts. A backfill task, conditional on the answer.                                 |
| `probe:account-insights` | **Q3a** — series or window total, and is a one-day window addressable? **Q3b** — how far back does the window reach? **Q2a** — what do `FOLLOWER`/`NON_FOLLOWER` actually mean? | Whether `account_daily` can hold all five metrics per day at all; how much history first sync populates; whether the follows/unfollows figures can be labelled |

`probe:lookback` has been run and is answered: **no boundary, 242/243 posts,
oldest 1,907 days**. It took 4m53s to walk the account, and that pace is roughly
what the backfill should use.

`probe:account-insights` is now the one that matters. Its first version had a
bug that cost most of its answer — it omitted `metric_type=total_value`, so four
of five metrics errored and only `reach` was tested. **The rewritten version does
not assume which metrics need the parameter; it tries both forms for every
metric**, because the point of a probe is to find out rather than to confirm.

Its most important line is `ONE-DAY WINDOW`. That is what decides whether a
per-day backfill is possible at all, and therefore whether four of the five
account metrics can live in a per-day table.

## Reading the output

- **`TYPE-COND`** is an answer, not a failure. `thumbnail_url` is served for
  `VIDEO`/`REELS` and omitted for `CAROUSEL_ALBUM`/`IMAGE`, which carry
  `media_url`. The probe samples one item of each media type before reaching a
  verdict, because inspecting only the newest post reports ABSENT for a field
  that is present two rows down — and a probe that cries wolf gets discounted,
  after which the next real finding is waved through with it.
- **`UNPROBED` is not `clean`.** If no post of a given media type exists in the
  page, that type was not tested. The account currently posts no images, so
  that path stays untested until one is published.
- **A version mismatch line** means Meta served a different API version than was
  requested. It silently upgrades calls to retired versions, and that is exactly
  how a renamed metric turns real engagement into nulls with nothing noticing.
- **Rate-limit headers** are printed at the end. The sync layer records these
  into `sync_runs.stats` and surfaces them on `/settings`; the first full sync
  is the largest burst the app ever makes and is where a cap is first met.

## The one that fails silently

If `/me/accounts` comes back `EMPTY` while `/me` returns your profile, the token
is missing **`business_management`**. It reads as "this user administers no
Pages", not as "this token lacks a permission". Nothing errors.
