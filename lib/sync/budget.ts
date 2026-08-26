import type { RateLimitUsage } from '../graph/client';

/**
 * A per-run request budget.
 *
 * The run stops itself well short of any limit and returns `{done: false}`; the
 * Actions loop calls again. Spreading a long operation across several
 * invocations is correct behaviour, not a failure — and it is what makes the
 * whole thing survivable on a serverless host with a wall-clock ceiling.
 *
 * Measured headroom is generous — a 243-post walk registered ~1% of the hourly
 * allowance — but a measurement taken once on one account is not a guarantee
 * about every future run, so the budget stays.
 */
export class RunBudget {
  private spent = 0;
  private readonly maxRequests: number;
  private readonly deadline: number;
  private worstUsage: RateLimitUsage | null = null;

  constructor(options: { maxRequests?: number; maxMs?: number } = {}) {
    this.maxRequests = options.maxRequests ?? 150;
    this.deadline = Date.now() + (options.maxMs ?? 45_000);
  }

  /** Called before each request. False means stop and hand back to the caller. */
  canSpend(): boolean {
    return this.spent < this.maxRequests && Date.now() < this.deadline;
  }

  spend(usage?: RateLimitUsage): void {
    this.spent += 1;
    if (usage && (usage.callCount ?? 0) >= (this.worstUsage?.callCount ?? -1)) {
      this.worstUsage = usage;
    }
  }

  /** Meta's own signal that we are near a limit, independent of our own count. */
  throttleImminent(): boolean {
    const usage = this.worstUsage;
    if (!usage) return false;
    if ((usage.estimatedTimeToRegainAccess ?? 0) > 0) return true;
    return Math.max(usage.callCount ?? 0, usage.totalCputime ?? 0, usage.totalTime ?? 0) >= 80;
  }

  get stats() {
    return {
      requests: this.spent,
      usage: this.worstUsage,
      throttleImminent: this.throttleImminent(),
    };
  }
}
