import { describe, expect, it } from 'vitest';
import {
  allowedNumbers,
  numbersIn,
  splitSentences,
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

  // The regression this function was rewritten for. Splitting on `.` treated
  // the `1.` and `2.` of a markdown list as sentence endings, shredded the
  // list into fragments, and rendered a correct answer as "1.2.3.4.5.6."
  it('leaves a numbered list intact when every figure is backed', () => {
    const answer = [
      '## Your best-reaching posts',
      '',
      '1. The serum routine — 1248 accounts reached',
      '2. The cleanser comparison — 903 accounts reached',
      '',
      'Median across 17 measured posts is 1075.5 accounts.',
    ].join('\n');

    const { text, dropped } = stripUnbackedSentences(answer, payload);
    expect(text).toBe(answer);
    expect(dropped).toHaveLength(0);
  });

  it('drops one list item and leaves its siblings, markers and all', () => {
    const answer = [
      '1. The serum routine — 1248 accounts reached',
      '2. A post nobody measured — 5000 accounts reached',
      '3. The cleanser comparison — 903 accounts reached',
    ].join('\n');

    const { text, dropped } = stripUnbackedSentences(answer, payload);
    expect(text).toBe(
      [
        '1. The serum routine — 1248 accounts reached',
        '3. The cleanser comparison — 903 accounts reached',
      ].join('\n'),
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.figures).toEqual([5000]);
  });

  it('drops a bulleted item without leaving a bare marker behind', () => {
    const { text } = stripUnbackedSentences(
      ['- Reach: 1248', '- Saves: 4200', '- Comments: 12'].join('\n'),
      payload,
    );
    expect(text).toBe(['- Reach: 1248', '- Comments: 12'].join('\n'));
    expect(text).not.toContain('- \n');
  });

  it('does not mistake a decimal point for the end of a sentence', () => {
    const { text, dropped } = stripUnbackedSentences(
      'Your median reach is 1075.5 accounts across 17 posts.',
      payload,
    );
    expect(text).toBe('Your median reach is 1075.5 accounts across 17 posts.');
    expect(dropped).toHaveLength(0);
  });

  it('keeps blank lines and headings around a line it removes', () => {
    const answer = [
      '## Reach',
      '',
      'Your best post reached 1248 accounts.',
      'Engagement is up 42% year on year.',
      '',
      'Saves sit at 37 on your top post.',
    ].join('\n');

    const { text } = stripUnbackedSentences(answer, payload);
    expect(text).toBe(
      [
        '## Reach',
        '',
        'Your best post reached 1248 accounts.',
        '',
        'Saves sit at 37 on your top post.',
      ].join('\n'),
    );
  });
});

describe('splitSentences', () => {
  it('does not split on a list marker', () => {
    expect(splitSentences('1. The serum routine reached 1248 accounts.')).toEqual([
      '1. The serum routine reached 1248 accounts.',
    ]);
    expect(splitSentences('- A bullet. ')).toEqual(['- A bullet. ']);
  });

  it('does not split inside a decimal', () => {
    expect(splitSentences('Median reach is 1075.5 accounts.')).toEqual([
      'Median reach is 1075.5 accounts.',
    ]);
  });

  it('splits two sentences sharing a line, keeping the marker on the first', () => {
    expect(splitSentences('1. Reach was strong. Saves were not.')).toEqual([
      '1. Reach was strong.',
      ' Saves were not.',
    ]);
  });
});
