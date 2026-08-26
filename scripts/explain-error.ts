/**
 * Drizzle wraps a query failure in its own error and puts Postgres's actual
 * complaint — the part naming the missing column or relation — on `cause`.
 * Printing only the top-level message shows the SQL and hides the reason.
 *
 * This lived inline in one script and was promptly forgotten in the next, which
 * is the argument for it being importable rather than remembered.
 */
export function explainError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join('\n  ↳ ');
}

/** The overwhelmingly likely cause of a query failure on a fresh database. */
export function schemaHint(detail: string): string | null {
  return /column .* does not exist|relation .* does not exist/i.test(detail)
    ? 'That looks like the database is behind the schema this code expects.\n  Run `npm run db:migrate` against it, then try again.'
    : null;
}
