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

| Probe                    | Question                                                                                                           | What changes on the answer                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `probe:graph`            | Is the token right, and what does the media edge actually serve?                                                   | Field mapping, and whether `business_management` is present                                                                                |
| `probe:lookback`         | **Q1** — how far back do media insights reach?                                                                     | Whether the chat reasons over most of the account's history or a handful of posts. A backfill task, conditional on the answer.             |
| `probe:account-insights` | **Q2** — does `follows_and_unfollows` return values? **Q3** — do account insights backfill with an explicit range? | Whether the dashboard shows gross follows/unfollows or net deltas; whether the follower chart is populated on day one or blank for a month |

`probe:lookback` is the one that matters most and the one that takes longest —
it walks every post in the account, paced deliberately, and it is the largest
burst any script here makes.

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
