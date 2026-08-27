import { describe, expect, it } from 'vitest';
import {
  asQuotaError,
  checkHeadroom,
  maxStepsFor,
  parseModelRef,
  type QuotaLedger,
} from '../lib/model/provider';

describe('parseModelRef', () => {
  it('splits provider from model', () => {
    expect(parseModelRef('google:gemini-3.6-flash')).toEqual({
      provider: 'google',
      modelId: 'gemini-3.6-flash',
    });
  });

  it('keeps colons inside a model id', () => {
    expect(parseModelRef('openrouter:meta-llama/llama-3.1:free')).toEqual({
      provider: 'openrouter',
      modelId: 'meta-llama/llama-3.1:free',
    });
  });

  it('refuses a bare model name', () => {
    expect(() => parseModelRef('gemini-3.6-flash')).toThrow(/provider:model/);
  });
});

const ledger = (chat: number, cards: number, lastMinute = 0): QuotaLedger => ({
  callsToday: async (purpose) => (purpose === 'chat' ? chat : cards),
  callsLastMinute: async () => lastMinute,
});

const caps = { dailyCalls: 100, reservedForCards: 20, callsPerMinute: 60 };

describe('quota rationing', () => {
  it('counts calls, not messages', async () => {
    // Six calls is one chat message with a tool loop, not six messages. A cap
    // read as messages-per-day is several times looser than it looks.
    const headroom = await checkHeadroom('chat', ledger(6, 0), caps);
    expect(headroom.used).toBe(6);
  });

  it('holds back the card reservation from chat', async () => {
    expect((await checkHeadroom('chat', ledger(79, 0), caps)).allowed).toBe(true);
    expect((await checkHeadroom('chat', ledger(80, 0), caps)).allowed).toBe(false);
  });

  it('does not let heavy chat use starve scheduled generation', async () => {
    const headroom = await checkHeadroom('cards', ledger(80, 0), caps);
    expect(headroom.allowed).toBe(true);
  });

  it('refuses cards once the whole day is spent', async () => {
    expect((await checkHeadroom('cards', ledger(0, 100), caps)).allowed).toBe(false);
  });

  it('explains a refusal rather than degrading silently', async () => {
    const headroom = await checkHeadroom('chat', ledger(80, 0), caps);
    expect(headroom.reason).toMatch(/reserved for insight cards/);
  });
});

/**
 * The limit that actually fired, in production, on the free tier.
 *
 * `Quota exceeded ... limit: 5, model: gemini-3.6-flash` — five requests a
 * MINUTE, against a daily cap of two hundred that was nowhere near spent. A
 * guard that only knows about the day never sees this coming, and the tool loop
 * inside one chat message can spend it without the loop ever returning.
 */
describe('the per-minute limit', () => {
  const free = { dailyCalls: 200, reservedForCards: 40, callsPerMinute: 5 };

  it('keeps one message’s tool loop under the per-minute ceiling', () => {
    // Four steps is four requests, against five a minute, leaving one so a
    // follow-up question does not have to wait out the whole window.
    expect(maxStepsFor(free)).toBe(4);
  });

  it('never drops below a usable loop, however tight the plan', () => {
    expect(maxStepsFor({ ...free, callsPerMinute: 1 })).toBe(2);
  });

  it('does not start a turn it cannot finish inside the limit', async () => {
    const headroom = await checkHeadroom('chat', ledger(0, 0, 2), free);
    expect(headroom.allowed).toBe(false);
    expect(headroom.retryAfterSeconds).toBe(60);
    expect(headroom.reason).toMatch(/5 requests a minute/);
  });

  it('allows a turn that fits', async () => {
    expect((await checkHeadroom('chat', ledger(0, 0, 1), free)).allowed).toBe(true);
  });

  it('is checked before the daily cap, because it clears on its own', async () => {
    // Both are exceeded. The per-minute one is the actionable message: wait a
    // minute, rather than come back tomorrow.
    const headroom = await checkHeadroom('chat', ledger(500, 0, 5), free);
    expect(headroom.retryAfterSeconds).toBe(60);
  });
});

describe('telling a quota error from a broken provider', () => {
  it('reads the wait out of the provider’s own message', () => {
    const quota = asQuotaError(
      new Error(
        'You exceeded your current quota. Quota exceeded for metric: ' +
          'generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
          'limit: 5, model: gemini-3.6-flash Please retry in 12.174274113s.',
      ),
    );
    expect(quota?.retryAfterSeconds).toBe(13);
  });

  it('falls back to a minute when the provider does not say', () => {
    expect(
      asQuotaError(Object.assign(new Error('Too Many Requests'), { statusCode: 429 }))
        ?.retryAfterSeconds,
    ).toBe(60);
  });

  it('does not treat a real failure as a quota error', () => {
    // These clear differently — one by waiting, one not at all — so they must
    // not produce the same response.
    expect(asQuotaError(new Error('fetch failed'))).toBeNull();
    expect(asQuotaError(new Error('model not found'))).toBeNull();
  });
});
