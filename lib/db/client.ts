import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

/**
 * One connection, created lazily and reused across invocations within a warm
 * function. `prepare: false` is required by Supabase's transaction-mode pooler
 * — prepared statements cannot survive a connection being handed to another
 * transaction between statements.
 */

let sql: ReturnType<typeof postgres> | null = null;
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!database) {
    sql = postgres(env().DATABASE_URL, { prepare: false, max: 1 });
    database = drizzle(sql, { schema });
  }
  return database;
}

/** Only for scripts and tests — a serverless function should never call this. */
export async function closeDb(): Promise<void> {
  await sql?.end({ timeout: 5 });
  sql = null;
  database = null;
}
