import type { UnavailableMap } from '../db/unavailable';

/**
 * When a post's insights are worth sampling, and what an absent sample means.
 *
 * Meta serves cumulative lifetime totals with no historical curve, so a curve
 * exists ONLY where it was sampled at the time. Everything here follows from
 * that one fact.
 */

export const CHECKPOINTS = ['t24', 't48', 't7d', 'latest'] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

/** Age windows in hours. Generous enough that a daily sync cannot miss one. */
const WINDOWS: Record<Exclude<Checkpoint, 'latest'>, [number, number]> = {
  t24: [24, 48],
  t48: [48, 72],
  t7d: [168, 192],
};

/**
 * The checkpoints due for a post right now.
 *
 * `latest` is always due — it is a running snapshot, not a moment. The others
 * are due only inside their window, and a post that was already older than a
 * window when the app first saw it never becomes eligible for it.
 */
export function checkpointsDue(publishedAt: Date, now: Date = new Date()): Checkpoint[] {
  const ageHours = (now.getTime() - publishedAt.getTime()) / 3_600_000;
  const due: Checkpoint[] = [];
  for (const [checkpoint, [from, to]] of Object.entries(WINDOWS) as [
    Exclude<Checkpoint, 'latest'>,
    [number, number],
  ][]) {
    if (ageHours >= from && ageHours < to) due.push(checkpoint);
  }
  due.push('latest');
  return due;
}

/**
 * Why a checkpoint is missing, for a post that has already outlived its window.
 *
 * This is the distinction the chat's acceptance test turns on. A 2021 post has
 * no `t48` reading — but Meta did not decline it, and it is not zero. Nobody
 * measured at that age, and nobody can now.
 */
export function missingCheckpointReason(
  checkpoint: Checkpoint,
  publishedAt: Date,
  now: Date = new Date(),
): UnavailableMap[string] | null {
  if (checkpoint === 'latest') return null;
  const ageHours = (now.getTime() - publishedAt.getTime()) / 3_600_000;
  const [, to] = WINDOWS[checkpoint];
  // Still young enough that the window has not passed — this is "too new",
  // which the caller renders differently from a permanent absence.
  if (ageHours < to) return null;
  return 'never_sampled';
}

/** True when a post is younger than a checkpoint's window — "too new", not missing. */
export function tooNewFor(
  checkpoint: Checkpoint,
  publishedAt: Date,
  now: Date = new Date(),
): boolean {
  if (checkpoint === 'latest') return false;
  const ageHours = (now.getTime() - publishedAt.getTime()) / 3_600_000;
  return ageHours < WINDOWS[checkpoint][0];
}
