# Model quota

**Do not copy a number from a blog into this file.** Free-tier limits were cut
substantially in late 2025 and are no longer published as a static table —
providers surface live limits per project in their own console. Read the
project's actual limits and record them here with the date observed.

## Observed limits

| Date observed  | Provider | Model | Limit | Where read                            |
| -------------- | -------- | ----- | ----- | ------------------------------------- |
| _not yet read_ | google   | —     | —     | AI Studio → the project's rate limits |

## The unit is calls, not messages

One chat message becomes **several model calls** once the tool loop runs: the
initial request, a tool result fed back, a follow-up, and sometimes a repair
attempt when the numeric validator rejects a figure. A cap expressed in
messages per day is silently several times looser than it reads.

`checkHeadroom` in `lib/model/provider.ts` counts calls. Measure the real
calls-per-message ratio from a handful of live turns and write it here next to
the cap, so a later surprise is diagnosable rather than mysterious.

| Measurement                       | Value              | When |
| --------------------------------- | ------------------ | ---- |
| Calls per chat message (observed) | _not yet measured_ | —    |

## Rationing

Scheduled card generation **reserves its allowance first**. Chat draws from what
remains. Heavy chat use must not be able to starve the dashboard, because the
dashboard is the surface that runs while nobody is watching.

Failures count against the ledger. A failed call spent the same quota as a
successful one, and a ledger that only counts successes will let a retry loop
walk straight through the cap.

## Commercialisation line item, not an optional upgrade

Free-tier usage is used to improve the provider's products. Paid-tier usage is
not.

That is acceptable while this serves one person's own account. **It is not
acceptable the moment another person's Instagram data flows through it.** Moving
to a paid tier is a precondition of the first non-owner user, alongside Meta App
Review — not a later optimisation.
