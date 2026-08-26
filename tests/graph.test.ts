import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_METRIC_MODE,
  GraphError,
  SERIES_METRICS,
  TOTAL_VALUE_METRICS,
  __setGraphFetchForTests,
  accountMetricParams,
  backwardWindows,
  graphGet,
  parseUsage,
} from '../lib/graph/client';
import { fetchMediaPage, mapMedia, normaliseMediaType } from '../lib/graph/media';
import { fetchPostInsights } from '../lib/graph/insights';
import { __setEnvForTests } from '../lib/env';

__setEnvForTests({ IG_ACCESS_TOKEN: 'test-token', GRAPH_API_VERSION: 'v21.0' });

afterEach(() => {
  __setGraphFetchForTests(null);
});

function reply(body: unknown, init: { status?: number; usage?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.usage ? { 'x-business-use-case-usage': init.usage } : {},
  });
}

function metaError(code: number, message: string, status = 400) {
  return reply({ error: { code, message } }, { status });
}

describe('metric_type is per-metric, in both directions', () => {
  it('sends total_value only for the metrics that require it', () => {
    expect(accountMetricParams('views').metric_type).toBe('total_value');
    expect(accountMetricParams('total_interactions').metric_type).toBe('total_value');
    // follower_count REJECTS the parameter — sending it fails the request.
    expect(accountMetricParams('follower_count').metric_type).toBeUndefined();
    expect(accountMetricParams('reach').metric_type).toBeUndefined();
  });

  it('splits the metrics by cost, since series cover a whole window', () => {
    expect(SERIES_METRICS).toEqual(['reach', 'follower_count']);
    expect(TOTAL_VALUE_METRICS).toHaveLength(4);
    expect(ACCOUNT_METRIC_MODE.profile_views).toBe('total_value');
  });
});

describe('error classification', () => {
  it('treats code 1 as transient, because it is', () => {
    // One post in a 243-post walk returned this. Retrying is the difference
    // between 242/243 coverage and 243/243.
    expect(new GraphError(400, 1, 'An unknown error occurred').isTransient).toBe(true);
  });

  it('treats a range that is too wide as neither transient nor missing data', () => {
    const error = new GraphError(
      400,
      100,
      'There cannot be more than 30 days (2592000 s) between since and until.',
    );
    expect(error.isRangeTooWide).toBe(true);
    expect(error.isTransient).toBe(false);
  });

  it('does not retry a permanent error', () => {
    expect(new GraphError(400, 100, 'incompatible with the metric type').isTransient).toBe(false);
  });
});

describe('graphGet retries', () => {
  it('retries a transient failure and succeeds', async () => {
    let calls = 0;
    __setGraphFetchForTests(async () => {
      calls += 1;
      return calls === 1 ? metaError(1, 'An unknown error occurred') : reply({ ok: true });
    });
    const res = await graphGet<{ ok: boolean }>('x/insights', {}, { sleep: async () => {} });
    expect(res.body.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('does not retry a permanent failure', async () => {
    let calls = 0;
    __setGraphFetchForTests(async () => {
      calls += 1;
      return metaError(100, 'incompatible with the metric type (total_value)');
    });
    await expect(graphGet('x/insights', {}, { sleep: async () => {} })).rejects.toThrow(
      /incompatible/,
    );
    expect(calls).toBe(1);
  });

  it('gives up after the attempt budget and surfaces the real error', async () => {
    __setGraphFetchForTests(async () => metaError(1, 'An unknown error occurred'));
    await expect(
      graphGet('x/insights', {}, { maxAttempts: 3, sleep: async () => {} }),
    ).rejects.toThrow(/unknown error/);
  });
});

describe('rate-limit usage', () => {
  it('reads the worst entry across business ids', () => {
    const header = JSON.stringify({
      '111': [
        { call_count: 1, total_cputime: 1, total_time: 1, estimated_time_to_regain_access: 0 },
      ],
      '222': [
        { call_count: 9, total_cputime: 3, total_time: 2, estimated_time_to_regain_access: 0 },
      ],
    });
    expect(parseUsage(header).callCount).toBe(9);
  });

  it('degrades to nulls rather than throwing on a header it cannot read', () => {
    expect(parseUsage('not json').callCount).toBeNull();
    expect(parseUsage(null).raw).toBeNull();
  });
});

describe('media mapping', () => {
  it('classifies reels by product type, not media type', () => {
    expect(normaliseMediaType({ id: '1', media_type: 'VIDEO', media_product_type: 'REELS' })).toBe(
      'reel',
    );
    expect(normaliseMediaType({ id: '1', media_type: 'CAROUSEL_ALBUM' })).toBe('carousel');
    expect(normaliseMediaType({ id: '1', media_type: 'IMAGE' })).toBe('image');
  });

  it('keeps thumbnail_url and media_url separately, because which is served depends on type', () => {
    const reel = mapMedia({
      id: '1',
      shortcode: 'A',
      media_type: 'VIDEO',
      media_product_type: 'REELS',
      thumbnail_url: 't',
    });
    const carousel = mapMedia({
      id: '2',
      shortcode: 'B',
      media_type: 'CAROUSEL_ALBUM',
      media_url: 'm',
    });
    expect(reel?.thumbnailUrl).toBe('t');
    expect(reel?.mediaUrl).toBeNull();
    expect(carousel?.thumbnailUrl).toBeNull();
    expect(carousel?.mediaUrl).toBe('m');
  });

  it('derives a shortcode from the permalink rather than dropping the post', () => {
    const mapped = mapMedia({ id: '3', permalink: 'https://www.instagram.com/p/DcRHHmdiOTD/' });
    expect(mapped?.shortcode).toBe('DcRHHmdiOTD');
  });

  it('returns null when there is no usable join key at all', () => {
    expect(mapMedia({ id: '4' })).toBeNull();
  });
});

describe('media pagination', () => {
  it('terminates on exhaustion, never on a count', async () => {
    // media_count said 229 where the real walk found 243. A completion check
    // against the count stops fourteen posts short and looks like success.
    __setGraphFetchForTests(async () =>
      reply({ data: [{ id: '1', shortcode: 'A' }], paging: { cursors: { after: 'CUR' } } }),
    );
    const page = await fetchMediaPage('IG');
    expect(page.nextCursor).toBeNull();
  });

  it('offers the next cursor only when Meta offers a next page', async () => {
    __setGraphFetchForTests(async () =>
      reply({
        data: [{ id: '1', shortcode: 'A' }],
        paging: { cursors: { after: 'CUR' }, next: 'https://…' },
      }),
    );
    expect((await fetchMediaPage('IG')).nextCursor).toBe('CUR');
  });

  it('counts unmappable items rather than dropping them silently', async () => {
    __setGraphFetchForTests(async () =>
      reply({ data: [{ id: '1', shortcode: 'A' }, { id: '2' }] }),
    );
    const page = await fetchMediaPage('IG');
    expect(page.media).toHaveLength(1);
    expect(page.skipped).toBe(1);
  });
});

describe('post insights', () => {
  it('records a reason for every metric Meta omits, and never a zero', async () => {
    __setGraphFetchForTests(async () =>
      reply({ data: [{ name: 'reach', values: [{ value: 128 }] }] }),
    );
    const result = await fetchPostInsights('MEDIA');
    expect(result.values.reach).toBe(128);
    expect(result.values.saved).toBeUndefined();
    expect(result.unavailable.saved).toBe('declined_by_meta');
  });

  it('falls back to one metric at a time so one bad metric does not take six with it', async () => {
    let call = 0;
    __setGraphFetchForTests(async (input) => {
      call += 1;
      const url = String(input);
      if (call === 1) return metaError(100, 'batch rejected');
      if (url.includes('metric=saved')) return metaError(100, 'unsupported');
      return reply({ data: [{ values: [{ value: 7 }] }] });
    });
    const result = await fetchPostInsights('MEDIA');
    expect(result.values.reach).toBe(7);
    expect(result.unavailable.saved).toBe('declined_by_meta');
  });

  it('distinguishes a transient failure from Meta declining', async () => {
    let call = 0;
    __setGraphFetchForTests(async (input) => {
      call += 1;
      if (call === 1) return metaError(100, 'batch rejected');
      return String(input).includes('metric=shares')
        ? metaError(1, 'An unknown error occurred')
        : reply({ data: [{ values: [{ value: 3 }] }] });
    });
    const result = await fetchPostInsights('MEDIA');
    // Meta did not decline this one — it broke, and it may work later.
    expect(result.unavailable.shares).toBe('transient_after_retries');
  });
});

describe('backwardWindows', () => {
  it('pages backwards inside the 30-day per-request cap', () => {
    const windows = [...backwardWindows(new Date('2026-08-26T00:00:00Z'), 3)];
    expect(windows).toHaveLength(3);
    for (const w of windows) {
      expect((w.until - w.since) / 86_400).toBeLessThanOrEqual(30);
    }
    // Contiguous: each window starts where the previous one ended.
    expect(windows[1]!.until).toBe(windows[0]!.since);
    expect(windows[2]!.until).toBe(windows[1]!.since);
  });
});
