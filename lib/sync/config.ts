/**
 * How deep the backfill goes, and why.
 *
 * `reach` and `follower_count` are the STABLE metrics and the CHEAP ones — one
 * request covers a 30-day window — so they are filled as far back as Meta
 * serves them. `reach` is confirmed to at least 365 days.
 *
 * The other four cost one request per day AND are the unstable ones: `views`
 * was renamed and redefined within the last two years, and Meta's own
 * descriptions mark `accounts_engaged` and `total_interactions` as estimated
 * and in development. A 2023 value and a 2026 value may not denote the same
 * thing, so filling five years of them would buy a series the chat must refuse
 * to trend end to end anyway.
 *
 * That the unstable metrics are also the expensive ones is a convenient
 * alignment rather than a coincidence: the metrics Meta kept stable are the
 * ones served as proper daily series.
 *
 * Revisable. Raising it is safe — the backfill checks for an existing non-null
 * value per metric per day, so extending the depth fills only the gap.
 */
export const BACKFILL_EXPENSIVE_DAYS = 90;

/**
 * How many 30-day windows to page backwards before giving up on finding more
 * history. 24 windows is roughly two years, comfortably past the confirmed
 * 365-day floor for `reach`.
 */
export const BACKFILL_MAX_WINDOWS = 24;

/** Comments are pulled for the most recent N posts, not the whole archive. */
export const COMMENT_POST_LIMIT = 25;
