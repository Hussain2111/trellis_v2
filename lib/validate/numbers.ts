/**
 * The guarantee, in code rather than in a prompt.
 *
 * Every figure a model states must appear in what a tool actually returned. A
 * figure that does not is dropped — not caveated, not softened. A wrong number
 * with a hedge in front of it is still a wrong number, and the product's whole
 * claim is that it will not invent one.
 *
 * Specified once and used twice: the dashboard's insight cards validate
 * structured objects and drop whole cards; the chat validates buffered text and
 * drops sentences. Neither streams unvalidated figures, because a token already
 * sent to a browser cannot be recalled.
 */

/**
 * Small integers do double duty as prose ("three of your posts", "the second
 * one") and as statistics. Treating them as statistics would drop honest
 * sentences, so 0–10 are exempt. Anything above that has to be backed.
 */
const STRUCTURAL_CEILING = 10;

/** Walk a tool payload and collect every number it could legitimately support. */
export function allowedNumbers(payload: unknown): Set<string> {
  const allowed = new Set<string>();

  const admit = (value: number): void => {
    if (!Number.isFinite(value)) return;
    allowed.add(canonical(value));
    // Legitimate presentations of the same figure. A model saying "37%" from a
    // stored 0.3712 is reporting, not inventing.
    allowed.add(canonical(Math.round(value)));
    allowed.add(canonical(Number(value.toFixed(1))));
    if (value >= 0 && value <= 1) {
      allowed.add(canonical(Math.round(value * 100)));
      allowed.add(canonical(Number((value * 100).toFixed(1))));
    }
  };

  const walk = (node: unknown): void => {
    if (typeof node === 'number') return admit(node);
    if (typeof node === 'string') {
      // Numbers that arrived as strings — postgres aggregates do this, and a
      // count that came back as "17" is still a computed count.
      const parsed = Number(node);
      if (node.trim() !== '' && Number.isFinite(parsed)) return admit(parsed);
      // Dates arrive as strings too. A payload holding a post published
      // 2021-06-04 backs an answer that says "back to 2021" — the year is in
      // the data, it just is not a number the row stored as one.
      const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(node.trim());
      if (date) for (const part of date.slice(1)) admit(Number(part));
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        // Identifiers are not statistics, and admitting them punches a hole
        // straight through the guarantee: with a post whose id is 42 in the
        // payload, "engagement is up 42%" would validate. Caught by a test
        // rather than by review, which is the point of having one.
        if (isIdentifierKey(key)) continue;
        walk(value);
      }
    }
  };

  walk(payload);
  return allowed;
}

/** `id`, `postId`, `ig_user_id`, `threadId` — anything naming a thing, not measuring it. */
function isIdentifierKey(key: string): boolean {
  return /^id$/i.test(key) || /_id$/i.test(key) || /Id$/.test(key);
}

function canonical(value: number): string {
  // -0 and 0 are the same claim.
  return String(value === 0 ? 0 : value);
}

/**
 * Not every digit is a claim, and treating them all as claims cost real answers.
 *
 * A list of posts carries a permalink and a date on every line. Neither is a
 * statistic — one is an address and the other is when something happened — but
 * both are full of digits that no aggregate query returns. So a correct answer
 * listing twenty posts had every one of its lines dropped, leaving the headings
 * standing over nothing. The figures the guarantee is actually about — reach,
 * saves, medians, counts — are untouched by this; they are still checked
 * against what a tool returned, and still dropped when they are not there.
 */
const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

const MONTH =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';

const DATE_PATTERNS: RegExp[] = [
  // 2024-03-15, 2024/03/15 — how a date arrives from the database.
  /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  // 15 March 2024, 15th Mar
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH})\\b(?:,?\\s+\\d{4})?`, 'gi'),
  // March 15, 2024
  new RegExp(`\\b(?:${MONTH})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?`, 'gi'),
  // March 2024
  new RegExp(`\\b(?:${MONTH})\\s+\\d{4}\\b`, 'gi'),
];

/**
 * A bare four-digit year is deliberately NOT exempt here. "2,050 accounts
 * reached" and "2050" are the same digits, and exempting every year-shaped
 * number would open a hole wide enough to drive an invented reach figure
 * through. A year only passes when the payload actually contains a date in that
 * year — see `allowedNumbers`.
 */
function withoutAddressesAndDates(text: string): string {
  let out = text.replace(URL_PATTERN, ' ');
  for (const pattern of DATE_PATTERNS) out = out.replace(pattern, ' ');
  return out;
}

/** Every number appearing in a piece of model output that could be a claim. */
export function numbersIn(text: string): number[] {
  const found: number[] = [];
  // Thousands separators are presentation. "1,248" and 1248 are one number.
  const normalised = withoutAddressesAndDates(text).replace(/(\d),(?=\d{3}\b)/g, '$1');
  for (const match of normalised.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const value = Number(match[0]);
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
}

/** The figures in `text` that nothing in the payload supports. */
export function unbackedNumbers(text: string, allowed: Set<string>): number[] {
  return numbersIn(text).filter((value) => {
    if (Number.isInteger(value) && Math.abs(value) <= STRUCTURAL_CEILING) return false;
    return !allowed.has(canonical(value));
  });
}

export interface ValidationResult<T> {
  kept: T[];
  dropped: { item: T; reason: string; figures?: number[] }[];
}

export interface Citable {
  /** The text whose figures must be backed. */
  body: string;
  /** Posts this claim says it derives from. */
  citedPostIds?: number[];
}

/**
 * Validate structured claims — the insight-card path.
 *
 * A claim is dropped when it states a figure the payload cannot support, or
 * cites a post the payload never mentioned. Both are the same failure: the
 * claim is about something other than the evidence it was handed.
 */
export function validateClaims<T extends Citable>(
  claims: T[],
  payload: unknown,
): ValidationResult<T> {
  const allowed = allowedNumbers(payload);
  const knownPostIds = new Set(postIdsIn(payload));
  const result: ValidationResult<T> = { kept: [], dropped: [] };

  for (const claim of claims) {
    const figures = unbackedNumbers(claim.body, allowed);
    if (figures.length > 0) {
      result.dropped.push({ item: claim, reason: 'unbacked figures', figures });
      continue;
    }
    const uncited = (claim.citedPostIds ?? []).filter((id) => !knownPostIds.has(id));
    if (uncited.length > 0) {
      result.dropped.push({ item: claim, reason: `cites unknown post(s): ${uncited.join(', ')}` });
      continue;
    }
    result.kept.push(claim);
  }

  return result;
}

/** Post ids anywhere in a payload, so a citation can be checked against it. */
export function postIdsIn(payload: unknown): number[] {
  const ids: number[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if ((key === 'id' || key === 'postId') && typeof value === 'number') ids.push(value);
        else walk(value);
      }
    }
  };
  walk(payload);
  return ids;
}

/**
 * Validate free-form text — the chat path.
 *
 * The unit of removal is a LINE, not a sentence, and that is the whole design.
 * An earlier version split on `.`, `!` and `?`, which destroyed anything
 * structured: a markdown list numbered `1.`, `2.`, `3.` looks exactly like
 * sentence punctuation, so a perfectly good answer listing twenty posts came
 * back as "1.2.3.4.5.6." with the content stripped out between the numbers.
 * Decimals fared no better — "3.5" split into "3." and "5".
 *
 * So: lines are preserved as lines. A list item is a unit. Within a line of
 * prose, sentences are split only at a boundary followed by whitespace and a
 * capital, which cannot occur inside a number, and a leading list marker is
 * lifted off before splitting so it is never mistaken for the end of a
 * sentence.
 *
 * Sentence-level rather than message-level, because dropping a whole answer
 * over one bad figure loses correct information the user asked for. If
 * everything with substance is dropped, the caller says it cannot back the
 * answer rather than rendering the remains.
 */
const LIST_MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+)/;

/** Split a line into sentences without mistaking list markers or decimals for boundaries. */
export function splitSentences(line: string): string[] {
  const marker = LIST_MARKER.exec(line)?.[1] ?? '';
  const body = line.slice(marker.length);

  // A real boundary is punctuation followed by whitespace and something that
  // starts a sentence. "3.5" has no whitespace; "1. Item" had its marker
  // removed above.
  const parts = body.split(/(?<=[.!?])(?=\s+[A-Z"'“(])/g);
  if (parts.length <= 1) return [line];
  return parts.map((part, index) => (index === 0 ? marker + part : part));
}

export function stripUnbackedSentences(
  text: string,
  payload: unknown,
): { text: string; dropped: { sentence: string; figures: number[] }[] } {
  const allowed = allowedNumbers(payload);
  const dropped: { sentence: string; figures: number[] }[] = [];

  const keptLines = text.split('\n').map((line): string | null => {
    // Blank lines and lines with no figures at all pass through untouched, so
    // paragraph breaks, headings and bullets keep their shape.
    if (line.trim() === '') return line;
    if (unbackedNumbers(line, allowed).length === 0) return line;

    const pieces = splitSentences(line);
    const survivors: string[] = [];

    for (const piece of pieces) {
      const figures = unbackedNumbers(piece, allowed);
      if (figures.length > 0) dropped.push({ sentence: piece.trim(), figures });
      else survivors.push(piece);
    }

    // Every part of this line was unbacked. Remove the line outright rather
    // than leaving a bare list marker pointing at nothing, or a blank gap in
    // the middle of a list.
    if (survivors.length === 0) return null;
    return survivors.join('').trimEnd();
  });

  const out = keptLines
    .filter((line): line is string => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: out, dropped };
}
