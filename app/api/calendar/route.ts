import { z } from 'zod';
import { selfAccountId } from '@/lib/chat/threads';
import { createEntry, listEntries, overdueCount } from '@/lib/calendar/entries';
import { riyadhInstant } from '@/lib/time';

export const dynamic = 'force-dynamic';

const entrySchema = z.object({
  // A Riyadh day and a Riyadh wall-clock time, converted on the server.
  // `new Date('2026-09-01T18:00')` in a browser means 18:00 wherever that
  // browser is, which is not what the form says and not what anything else in
  // this app assumes. `scheduledFor` stays accepted for a caller that already
  // holds a real instant.
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timeOfDay: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  scheduledFor: z.string().min(1).optional(),
  format: z.enum(['image', 'carousel', 'reel', 'video']).optional(),
  title: z.string().max(200).optional(),
  hook: z.string().max(500).optional(),
  caption: z.string().max(4000).optional(),
  hashtags: z.array(z.string()).optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(request: Request): Promise<Response> {
  // The nav badge asks for a count, not a list. Serving it the full set of
  // entries so it can throw all but one number away is the kind of waste that
  // is invisible until it is on every page in the app.
  const countOnly = new URL(request.url).searchParams.get('view') === 'overdue';

  const accountId = await selfAccountId();
  if (!accountId) return Response.json(countOnly ? { overdue: 0 } : { entries: [] });

  if (countOnly) return Response.json({ overdue: await overdueCount(accountId) });
  return Response.json({ entries: await listEntries(accountId) });
}

export async function POST(request: Request): Promise<Response> {
  const accountId = await selfAccountId();
  if (!accountId) return Response.json({ error: 'no_account' }, { status: 409 });

  const parsed = entrySchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });

  const { scheduledFor, day, timeOfDay, ...rest } = parsed.data;
  const when = day ? riyadhInstant(day, timeOfDay) : scheduledFor ? new Date(scheduledFor) : null;
  if (!when) return Response.json({ error: 'no date given' }, { status: 400 });

  const entry = await createEntry(accountId, { ...rest, scheduledFor: when });
  return Response.json({ entry });
}
