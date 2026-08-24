import { describe, expect, it } from 'vitest';
import {
  allowedNumbers,
  numbersIn,
  stripUnbackedSentences,
  unbackedNumbers,
  validateClaims,
} from '../lib/validate/numbers';

const payload = {
  posts: [
    { id: 41, reach: 1248, saved: 37 },
    { id: 42, reach: 903, saved: 12 },
  ],
  medianReach: 1075.5,
  saveRate: 0.0296,
  measured: 17,
};

describe('allowedNumbers', () => {
  it('admits figures exactly as stored', () => {
    const allowed = allowedNumbers(payload);
    expect(unbackedNumbers('reach was 1248', allowed)).toEqual([]);
  });

  it('admits a rounded presentation of a stored figure', () => {
    const allowed = allowedNumbers(payload);
    expect(unbackedNumbers('median reach 1076', allowed)).toEqual([]);
    expect(unbackedNumbers('median reach 1075.5', allowed)).toEqual([]);
  });

  it('admits a ratio presented as a percentage', () => {
    const allowed = allowedNumbers(payload);
    expect(unbackedNumbers('a save rate of 3%', allowed)).toEqual([]);
  });

  it('admits a number that arrived from postgres as a string', () => {
    const allowed = allowedNumbers({ total: '4881' });
    expect(unbackedNumbers('4881 followers', allowed)).toEqual([]);
  });

  it('does not let a post id back a statistic', () => {
    // The payload contains a post with id 42. Without excluding identifier
    // keys, "up 42%" validates against it — a hole straight through the
    // guarantee, and one that only shows up when an id collides with a
    // plausible percentage.
    const allowed = allowedNumbers(payload);
    expect(unbackedNumbers('engagement is up 42%', allowed)).toEqual([42]);
    expect(unbackedNumbers('reach grew by 41', allowed)).toEqual([41]);
  });

  it('rejects a plausible figure nothing computed', () => {
    const allowed = allowedNumbers(payload);
    expect(unbackedNumbers('reach was 1300', allowed)).toEqual([1300]);
  });
});

describe('numbersIn', () => {
  it('reads through thousands separators', () => {
    expect(numbersIn('1,248 accounts reached')).toEqual([1248]);
  });

  it('does not treat a small integer as a statistic', () => {
    const allowed = allowedNumbers(payload);
    expect(unbackedNumbers('three of your 4 recent posts', allowed)).toEqual([]);
  });
});

describe('validateClaims', () => {
  it('keeps a claim whose figures and citations are backed', () => {
    const result = validateClaims(
      [{ body: 'Your best post reached 1248.', citedPostIds: [41] }],
      payload,
    );
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('drops a claim with an invented figure rather than caveating it', () => {
    const result = validateClaims([{ body: 'Reach averaged 1500.', citedPostIds: [41] }], payload);
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe('unbacked figures');
    expect(result.dropped[0]?.figures).toEqual([1500]);
  });

  it('drops a claim citing a post the payload never mentioned', () => {
    const result = validateClaims([{ body: 'This one did well.', citedPostIds: [99] }], payload);
    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0]?.reason).toContain('99');
  });

  it('shows fewer cards rather than padding the grid', () => {
    const result = validateClaims(
      [
        { body: 'Reached 1248.', citedPostIds: [41] },
        { body: 'Reached 903.', citedPostIds: [42] },
        { body: 'Reached 5000.', citedPostIds: [41] },
      ],
      payload,
    );
    expect(result.kept).toHaveLength(2);
  });
});

describe('stripUnbackedSentences', () => {
  it('keeps the backed sentence and drops the invented one', () => {
    const { text, dropped } = stripUnbackedSentences(
      'Your best post reached 1248 accounts. Engagement is up 42% year on year.',
      payload,
    );
    expect(text).toBe('Your best post reached 1248 accounts.');
    expect(dropped[0]?.figures).toEqual([42]);
  });

  it('leaves prose without figures alone', () => {
    const { text, dropped } = stripUnbackedSentences('You post mostly carousels.', payload);
    expect(text).toBe('You post mostly carousels.');
    expect(dropped).toHaveLength(0);
  });
});
