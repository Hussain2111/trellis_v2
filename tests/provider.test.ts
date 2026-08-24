import { describe, expect, it } from 'vitest';
import { checkHeadroom, parseModelRef, type QuotaLedger } from '../lib/model/provider';

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

const ledger = (chat: number, cards: number): QuotaLedger => ({
  callsToday: async (purpose) => (purpose === 'chat' ? chat : cards),
});

const caps = { dailyCalls: 100, reservedForCards: 20 };

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
