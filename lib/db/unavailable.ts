/**
 * Why a number is missing.
 *
 * A closed set, defined once and shared by the sync layer, the backfill and
 * both surfaces. Free-text reasons written at each call site cannot be rendered
 * differently by the UI, and the distinction this whole product rests on
 * dissolves into prose.
 *
 * The rule is not "blank instead of zero". It is **blank with the correct
 * reason** — these five are different claims about the world and only one of
 * them is true at a time.
 */
export const UNAVAILABLE_REASONS = {
  /** Meta errored, or returned a successful response with the metric omitted. */
  declined_by_meta: "Instagram didn't report this",
  /** Older than the backfill's expensive-metric window. Never requested. */
  not_backfilled: 'Not collected for this period',
  /** Error code 1 or similar — retried with backoff and still failed. */
  transient_after_retries: "Couldn't be fetched — may work later",
  /** The metric does not exist for this media type. */
  not_applicable: "Doesn't apply to this kind of post",
  /**
   * A checkpoint that would have required measuring at an age already passed.
   *
   * The load-bearing one. Every post published before this app existed carries
   * it for `t24`, `t48` and `t7d`, and the chat's acceptance test turns on it.
   * It must never be collapsed into `declined_by_meta` — Meta did not decline
   * anything. Nobody asked at the time, and nobody can now.
   */
  never_sampled: 'Not measured at this point',
} as const;

export type UnavailableReason = keyof typeof UNAVAILABLE_REASONS;

/** `{ reach: 'declined_by_meta', views: 'not_backfilled' }` — per metric. */
export type UnavailableMap = Partial<Record<string, UnavailableReason>>;

export function describeUnavailable(reason: UnavailableReason): string {
  return UNAVAILABLE_REASONS[reason];
}

/** Guard for data read back out of jsonb, which is `unknown` as far as TS knows. */
export function isUnavailableReason(value: unknown): value is UnavailableReason {
  return typeof value === 'string' && value in UNAVAILABLE_REASONS;
}
