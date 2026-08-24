import { z } from 'zod';

/**
 * Server-only environment. The runtime guard in `env()` turns an accidental
 * client import into a loud error rather than a leaked secret.
 *
 * Parsing is lazy and memoised so a missing optional key surfaces where it is
 * used rather than crashing the whole app at import time.
 *
 * Everything here is rendered on /settings from the *resolved* values the
 * running function actually sees. On the previous build that page turned out
 * to be a more reliable way to confirm a Vercel environment change had taken
 * effect than the Vercel dashboard itself.
 */

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

export const envSchema = z.object({
  // --- Database (Supabase Postgres) -----------------------------------------
  // The connection *pooler* string, transaction mode, prepared statements off.
  // Serverless functions are short-lived and numerous; a direct connection's
  // limit cannot absorb that. The direct hostname is also IPv6-only on newer
  // Supabase projects and is not reachable everywhere.
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:5432/trellis'),

  // --- Deployment -----------------------------------------------------------
  APP_URL: z.string().optional(),

  // --- Instagram Graph API --------------------------------------------------
  // Pinned deliberately and surfaced on /settings. On the previous build,
  // requests sent to v21.0 came back with v26.0 in every response URL — Meta
  // silently upgrades calls to a retired version, which is exactly how a
  // renamed metric turns real engagement into nulls with nothing noticing.
  GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v21.0'),
  IG_HANDLE: z.string().optional(),
  IG_USER_ID: z.string().optional(),
  IG_ACCESS_TOKEN: z.string().optional(),

  // --- Model provider -------------------------------------------------------
  // No model name appears outside lib/model/provider.ts. These are the only
  // places one is written down.
  MODEL_PRIMARY: z.string().default('google:gemini-3.6-flash'),
  MODEL_FALLBACK: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

  // --- Cron auth ------------------------------------------------------------
  // Sent as `Authorization: Bearer $CRON_SECRET` by Vercel's own cron caller
  // and by the GitHub Actions schedules. Required in production; when unset in
  // local development the guard no-ops.
  CRON_SECRET: z.string().optional(),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (typeof window !== 'undefined') {
    throw new Error('lib/env.ts was imported from the browser. Secrets are server-only.');
  }
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(
      `Invalid environment:\n${detail}\n\nCopy .env.example to .env.local and fill it in.`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Test seam: force a specific env without touching process.env. */
export function __setEnvForTests(value: Partial<Env> | null): void {
  cached = value ? (envSchema.parse({ ...process.env, ...value }) as Env) : null;
}
