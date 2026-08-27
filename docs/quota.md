# Model quota — observed, not looked up

Free-tier limits changed substantially in late 2025 and are no longer published
as a static table. Every number here was read off a real response or the
provider's own console, with the date it was read. **Do not copy a figure into
this file from a blog post or from memory.** A wrong number here is worse than
no number, because the guard built on it will look like it is working — which is
exactly what happened, see below.

## `google:gemini-3.6-flash`, free tier

| Limit                     | Value       | How it was established                                                                                          |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| Requests per minute (RPM) | **5**       | `[VERIFIED-LIVE]` 2026-08-27 — the provider's own error, and AI Studio, which showed a 28-day peak of **8 / 5** |
| Requests per day (RPD)    | **20**      | `[VERIFIED-LIVE]` 2026-08-27 — AI Studio, against a 28-day peak of **44 / 20**                                  |
| Tokens per minute (TPM)   | **250,000** | `[VERIFIED-LIVE]` 2026-08-27 — AI Studio, peak use 2.78K, about 1%                                              |

The response that first established RPM, verbatim:

```
You exceeded your current quota, please check your plan and billing details.
* Quota exceeded for metric:
  generativelanguage.googleapis.com/generate_content_free_tier_requests,
  limit: 5, model: gemini-3.6-flash
Please retry in 12.174274113s.
```

## Twenty a day is the constraint the product has to be designed around

It is not a safety margin. It is roughly **four questions a day**:

|                                                     |                                     |
| --------------------------------------------------- | ----------------------------------- |
| Requests a day                                      | 20                                  |
| Held back for the dashboard's daily note generation | 4                                   |
| Left for chat                                       | 16                                  |
| Requests one question can cost                      | up to 4 — a tool loop, not one call |
| **Questions a day**                                 | **about 4**                         |

The default in this repo was 200 a day, invented before the number was known. It
would not have stopped anything: the console shows a 28-day peak of **44**
against a limit of 20, so the day had been blown through twice over while the
app believed it had 156 requests in hand.

**This is why `/settings` shows "Questions left today" rather than a request
count.** Requests are the unit the provider counts; questions are the unit the
person using it thinks in, and on this tier the difference between the two is
the difference between "plenty" and "four".

## Why five a minute is smaller than it sounds

**The unit is requests, not messages,** and one chat message is a tool loop. A
question that needs three tool calls costs four requests: the first call, two
follow-ups carrying tool results, and the answer. So **one question can spend
most of a minute's allowance**, and two in quick succession cannot both run.

This is why `stopWhen` is derived rather than fixed. `maxStepsFor()` sets the
step ceiling from `MODEL_CALLS_PER_MINUTE`, holding one request back so a
follow-up does not have to wait out the whole window. A fixed ceiling of 8 steps
— which is what it was — could exceed a 5-a-minute budget from inside a single
call, where no pre-flight check can reach it.

**Raising `MODEL_CALLS_PER_MINUTE` therefore makes each question cost more.** On
a 20-a-day budget that trades depth of reasoning for number of questions. A real
trade, not a free win.

## What the guards are

| Guard               | Where              | What it does                                                                                                    |
| ------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Per-minute headroom | `checkHeadroom`    | Refuses to start a turn that could not finish inside the limit. Checked **first**, because it clears by waiting |
| Daily headroom      | `checkHeadroom`    | Card generation reserves its share first, so chat cannot starve the dashboard                                   |
| Step ceiling        | `maxStepsFor`      | Caps requests inside one turn                                                                                   |
| Questions left      | `questionsLeft`    | The budget in the unit a person thinks in, on `/settings`, before it bites                                      |
| No retries          | `maxRetries: 0`    | The SDK's default of three attempts spent three of five requests on a call that could not have succeeded        |
| Ledger in requests  | `model_runs.calls` | Rows are messages; the column is requests. Counting rows undercounted by the length of the tool loop            |

Failures count against the ledger. A rejected call still reached the provider
and still counted there, so recording it as zero would let the ledger drift
below what is actually being enforced — which is how a guard gets quietly
overrun.

**The daily cap here is a rolling 24-hour window**, not a calendar day, so it
frees gradually. A refusal says when the next slot returns rather than "come
back tomorrow", which would be wrong by up to a day in either direction. The
provider's own RPD counter resets on its own schedule; that is a different
thing, and it is not guessed at anywhere in this code.

Tokens per minute is not guarded. At about 1% of the allowance with a payload of
a few hundred rows it is nowhere near binding, and a guard nobody needs is a
guard nobody maintains. If the payloads grow, revisit — from the outside the
failure would look identical to the RPM one.

## Changing provider

Every lane except Google speaks the OpenAI wire format, so they share one
adapter. Switching is an environment change:

```
MODEL_PRIMARY=groq:llama-3.3-70b-versatile
GROQ_API_KEY=...
MODEL_CALLS_PER_MINUTE=<read it from Groq's console>
MODEL_CALLS_PER_DAY=<read it from Groq's console>
```

Registered: `google`, `groq`, `deepseek`, `openrouter`, `together`, `cerebras`,
`mistral`. `/settings` lists which lanes actually **built** — the difference
between configured and built is a missing API key, and finding that out when the
primary runs dry is finding out too late.

**No limits for these are written down here, deliberately.** Every provider
publishes its own, they change, and a number in a file nobody re-reads is how
the 200-a-day default came to exist while the real limit was 20. Read them from
the console you are actually billed against.

**`MODEL_FALLBACK` now catches a spent limit**, not just a missing key. That was
the gap: the fallback was reached only when the primary could not be _built_,
which is the rarest way a model becomes unavailable. A quota refusal now moves
to the next lane and answers the question.

It must be a **different provider**. A limit belongs to a project, not to a
model, so a second Gemini model is out of requests for exactly the same reason
the first one is — same-provider fallbacks are dropped rather than tried and
refused twice. The ledger is scoped per provider too, so a fresh provider starts
with a fresh allowance instead of inheriting the exhausted one's counter.

## Changing tier

`MODEL_CALLS_PER_MINUTE` and `MODEL_CALLS_PER_DAY` are environment variables, so
moving to a paid tier is a configuration change and a redeploy.

**Billing is the answer if this is used seriously**, and it is already a line
item for a second reason: free-tier usage is used to improve the provider's
products and paid-tier usage is not. Acceptable for one owner's own account;
**not acceptable the moment another person's Instagram data flows through it.**
