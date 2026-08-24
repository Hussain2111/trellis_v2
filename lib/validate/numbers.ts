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
      if (node.trim() !== '' && Number.isFinite(parsed)) admit(parsed);
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

/** Every number appearing in a piece of model output. */
export function numbersIn(text: string): number[] {
  const found: number[] = [];
  // Thousands separators are presentation. "1,248" and 1248 are one number.
  const normalised = text.replace(/(\d),(?=\d{3}\b)/g, '$1');
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
 * Sentence-level rather than message-level, because dropping a whole answer
 * over one bad figure loses correct information the user asked for. If every
 * sentence carrying substance is dropped, the caller is expected to say it
 * cannot back the answer rather than render the remains.
 */
export function stripUnbackedSentences(
  text: string,
  payload: unknown,
): { text: string; dropped: { sentence: string; figures: number[] }[] } {
  const allowed = allowedNumbers(payload);
  const sentences = text.match(/[^.!?\n]+[.!?]?\n*/g) ?? [text];
  const kept: string[] = [];
  const dropped: { sentence: string; figures: number[] }[] = [];

  for (const sentence of sentences) {
    const figures = unbackedNumbers(sentence, allowed);
    if (figures.length > 0) dropped.push({ sentence: sentence.trim(), figures });
    else kept.push(sentence);
  }

  return { text: kept.join('').trim(), dropped };
}
