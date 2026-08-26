import { formatBreakdown, postsRanked, trailingMedian, accountOverview } from '../chat/queries';
import { followerChart } from './metrics';

/**
 * The evidence an insight card is generated from.
 *
 * SQL computes, the model interprets, code validates, the result is cached.
 * Nothing the model sees here is anything but a query result, which is what
 * makes the validator able to check its output afterwards — a figure that is
 * not in this payload cannot have come from the data.
 */

export const MIN_MEASURED_POSTS = 10;
export const MIN_FORMAT_SAMPLE = 5;

export interface CardPayload {
  account: Awaited<ReturnType<typeof accountOverview>>;
  formats: Awaited<ReturnType<typeof formatBreakdown>>;
  topByReach: Awaited<ReturnType<typeof postsRanked>>;
  topBySaves: Awaited<ReturnType<typeof postsRanked>>;
  medianReach: Awaited<ReturnType<typeof trailingMedian>>;
  medianSaves: Awaited<ReturnType<typeof trailingMedian>>;
  followers: Awaited<ReturnType<typeof followerChart>>;
}

export interface PayloadResult {
  ok: boolean;
  reason?: string;
  payload?: CardPayload;
}

/**
 * Sample floors are applied HERE, before the model is called.
 *
 * If the model is handed thin data and asked to be careful, it will hedge and
 * produce something that reads like a finding. Refusing to call it at all is
 * the only version of that instruction which actually holds.
 */
export async function buildCardPayload(accountId: number): Promise<PayloadResult> {
  const account = await accountOverview(accountId);

  if (account.coverage.postsWithInsights < MIN_MEASURED_POSTS) {
    return {
      ok: false,
      reason: `Only ${account.coverage.postsWithInsights} posts have performance data. Below ${MIN_MEASURED_POSTS} there is nothing worth saying.`,
    };
  }

  const [formats, topByReach, topBySaves, medianReach, medianSaves, followers] = await Promise.all([
    formatBreakdown(accountId, 'reach', { minSample: MIN_FORMAT_SAMPLE }),
    postsRanked(accountId, 'reach', { limit: 5 }),
    postsRanked(accountId, 'saves', { limit: 5 }),
    trailingMedian(accountId, 'reach'),
    trailingMedian(accountId, 'saves'),
    followerChart(accountId, 30),
  ]);

  return {
    ok: true,
    payload: { account, formats, topByReach, topBySaves, medianReach, medianSaves, followers },
  };
}
