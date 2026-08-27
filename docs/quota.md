# Model quota — observed, not looked up

Free-tier limits changed substantially in late 2025 and are no longer published
as a static table. Every number here was read off a real response, with the date
it was read. **Do not copy a figure into this file from a blog post or from
memory.** A wrong number here is worse than no number, because the guard built
on it will look like it is working.

## `google:gemini-3.6-flash`, free tier

| Limit               | Value          | How it was established                                                                                                    |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Requests per minute | **5**          | `[VERIFIED-LIVE]` 2026-08-27, from the provider's own error                                                               |
| Requests per day    | _not observed_ | The daily cap has never been reached; `MODEL_CALLS_PER_DAY` defaults to 200 as a self-imposed ceiling, not a measured one |

The response that established it, verbatim:

```
You exceeded your current quota, please check your plan and billing details.
* Quota exceeded for metric:
  generativelanguage.googleapis.com/generate_content_free_tier_requests,
  limit: 5, model: gemini-3.6-flash
Please retry in 12.174274113s.
```

## Why five is smaller than it sounds

**The unit is requests, not messages,** and one chat message is a tool loop. A
question that needs three tool calls costs four requests: the first call, two
follow-ups carrying tool results, and the answer. So **one question can spend
most of a minute's allowance**, and two in quick succession cannot both run.

This is why `stopWhen` is derived rather than fixed. `maxStepsFor()` sets the
step ceiling from `MODEL_CALLS_PER_MINUTE`, holding one request back so a
follow-up question does not have to wait out the whole window. A fixed ceiling
of 8 steps — which is what it was — could exceed a 5-a-minute budget from inside
a single call, where no pre-flight check can reach it.

## What the guards are

| Guard               | Where              | What it does                                                                                                    |
| ------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Per-minute headroom | `checkHeadroom`    | Refuses to start a turn that could not finish inside the limit. Checked **first**, because it clears by waiting |
| Daily headroom      | `checkHeadroom`    | Self-imposed. Card generation reserves its share first, so chat cannot starve the dashboard                     |
| Step ceiling        | `maxStepsFor`      | Caps requests inside one turn                                                                                   |
| No retries          | `maxRetries: 0`    | The SDK's default of three attempts spent three of five requests on a call that could not have succeeded        |
| Ledger in requests  | `model_runs.calls` | Rows are messages; the column is requests. Counting rows undercounted by the length of the tool loop            |

Failures count against the ledger. A rejected call still reached the provider
and still counted there, so recording it as zero would let the ledger drift
below what is actually being enforced — which is how a guard gets quietly
overrun.

## Changing tier

`MODEL_CALLS_PER_MINUTE` and `MODEL_CALLS_PER_DAY` are environment variables, so
moving to a paid tier is a configuration change and a redeploy. Raising the
per-minute value also raises the step ceiling, and the chat gets deeper tool
loops without a code change.

Note the commercial line from the plan: free-tier usage is used to improve the
provider's products and paid-tier usage is not. Acceptable for one owner's own
account; **not acceptable the moment another person's Instagram data flows
through it.**
