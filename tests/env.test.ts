import { afterEach, describe, expect, it } from 'vitest';
import { __setEnvForTests, env } from '../lib/env';

afterEach(() => __setEnvForTests(null));

/**
 * The bug this covers reached the browser as "Could not reach the server."
 *
 * `MODEL_CALLS_PER_MINUTE=` — a line left blank in a `.env` rather than
 * deleted — is an empty string, not `undefined`. Zod never applies a
 * `.default()` to it, coerces it to 0, and fails the field's own minimum. The
 * whole environment then refuses to parse, `env()` throws on first use, and
 * every route touching it returns a bodiless 500.
 */
describe('a variable set to nothing is a variable that is not set', () => {
  const withEnv = <T>(vars: Record<string, string>, run: () => T): T => {
    const saved = { ...process.env };
    Object.assign(process.env, vars);
    __setEnvForTests(null);
    try {
      return run();
    } finally {
      for (const key of Object.keys(vars)) delete process.env[key];
      Object.assign(process.env, saved);
      __setEnvForTests(null);
    }
  };

  it('falls back to the default for a blank numeric variable', () => {
    withEnv({ MODEL_CALLS_PER_MINUTE: '' }, () => {
      expect(env().MODEL_CALLS_PER_MINUTE).toBe(5);
    });
  });

  it('treats whitespace as blank too', () => {
    withEnv({ MODEL_CALLS_PER_DAY: '   ' }, () => {
      expect(env().MODEL_CALLS_PER_DAY).toBe(200);
    });
  });

  it('leaves a blank optional string undefined rather than empty', () => {
    withEnv({ IG_ACCESS_TOKEN: '' }, () => {
      // /settings reads this as "set" or "not set". An empty string is not set,
      // and reporting it as set is the kind of wrong the page exists to avoid.
      expect(env().IG_ACCESS_TOKEN).toBeUndefined();
    });
  });

  it('still reads a real value', () => {
    withEnv({ MODEL_CALLS_PER_MINUTE: '30' }, () => {
      expect(env().MODEL_CALLS_PER_MINUTE).toBe(30);
    });
  });
});
