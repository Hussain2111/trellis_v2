import { z } from 'zod';
import { respond } from '@/lib/api/respond';
import { selfAccountId } from '@/lib/chat/threads';
import { deleteEntry, markPublished, updateEntry } from '@/lib/calendar/entries';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  action: z.enum(['publish', 'update']).default('update'),
  scheduledFor: z.string().optional(),
  format: z.enum(['image', 'carousel', 'reel', 'video']).optional(),
  title: z.string().max(200).optional(),
  hook: z.string().max(500).optional(),
  caption: z.string().max(4000).optional(),
  hashtags: z.array(z.string()).optional(),
  notes: z.string().max(2000).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond(async () => {
    const accountId = await selfAccountId();
    if (!accountId) return Response.json({ error: 'no_account' }, { status: 409 });

    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });

    const { action, scheduledFor, ...rest } = parsed.data;

    const entry =
      action === 'publish'
        ? await markPublished(accountId, Number(id))
        : await updateEntry(accountId, Number(id), {
            ...rest,
            ...(scheduledFor ? { scheduledFor: new Date(scheduledFor) } : {}),
          });

    if (!entry) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ entry });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return respond(async () => {
    const accountId = await selfAccountId();
    if (!accountId) return Response.json({ error: 'no_account' }, { status: 409 });
    const { id } = await context.params;
    await deleteEntry(accountId, Number(id));
    return Response.json({ ok: true });
  });
}
