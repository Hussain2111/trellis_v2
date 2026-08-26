import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A guard for a failure that produced no error anywhere.
 *
 * Every colour in this app was written the bracket shorthand. In Tailwind 4.0
 * that bracket form was shorthand for the variable; 4.1 removed it. It does not
 * warn, it does not fail the build — it emits `background-color: --color-card`,
 * which is not valid CSS, so the browser drops the declaration and the rule
 * silently does nothing.
 *
 * The result was an app with no design system applied at all: no card
 * backgrounds, no rules, no ink scale, and an overlay you could read straight
 * through. It rendered, it type-checked, it deployed, and it was wrong on every
 * screen. Tokens declared in `@theme` generate real utilities — `bg-card`,
 * `text-ink-faint`, `rounded-note` — so those are what get used.
 */
const SOURCE_DIRS = ['app', 'components'];
const BRACKET_TOKEN = /-\[--(?:color|radius|shadow|font)-[a-z0-9-]+\]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe('design tokens reach the browser', () => {
  it('never uses the bracket shorthand Tailwind stopped resolving', () => {
    const offenders = SOURCE_DIRS.flatMap(sourceFiles)
      .map((file) => ({ file, lines: readFileSync(file, 'utf8').split('\n') }))
      .flatMap(({ file, lines }) =>
        lines
          .map((line, i) => ({ file, line: i + 1, text: line.trim() }))
          .filter((entry) => BRACKET_TOKEN.test(entry.text)),
      )
      .map((entry) => `${entry.file}:${entry.line}`);

    expect(offenders).toEqual([]);
  });
});
