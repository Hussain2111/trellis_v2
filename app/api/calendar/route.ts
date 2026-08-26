import { z } from 'zod';
import { selfAccountId } from '@/lib/chat/threads';
import { createEntry, listEntries } from '@/lib/calendar/entries';

export const dynamic = 'force-dynamic';

const entrySchema = z.object({
  scheduledFor: z.string().min(1),
  format: z.enum(['image', 'carousel', 'reel', 'video']).optional(),
  title: z.string().max(200).optional(),
  hook: z.string().max(500).optional(),
  caption: z.string().max(4000).optional(),
  hashtags: z.array(z.string()).optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(): Promise<Response> {
  const accountId = await selfAccountId();
  if (!accountId) return Response.json({ entries: [] });
  return Response.json({ entries: await listEntries(accountId) });
}

export async function POST(request: Request): Promise<Response> {
  const accountId = await selfAccountId();
  if (!accountId) return Response.json({ error: 'no_account' }, { status: 409 });

  const parsed = entrySchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });

  const { scheduledFor, ...rest } = parsed.data;
  const entry = await createEntry(accountId, { ...rest, scheduledFor: new Date(scheduledFor) });
  return Response.json({ entry });
}
