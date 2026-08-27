import { z } from 'zod';
import { respond } from '@/lib/api/respond';
import { createThread, createThreadFromCard, listThreads, selfAccountId } from '@/lib/chat/threads';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return respond(async () => {
    const accountId = await selfAccountId();
    if (!accountId) return Response.json({ threads: [] });
    return Response.json({ threads: await listThreads(accountId) });
  });
}

const bodySchema = z.object({ sourceCardId: z.number().int().optional() });

export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const accountId = await selfAccountId();
    if (!accountId) return Response.json({ error: 'no_account' }, { status: 409 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    const sourceCardId = parsed.success ? parsed.data.sourceCardId : undefined;

    // A thread opened from a note starts with the note in it. A thread opened
    // from the New chat button starts empty.
    const thread = sourceCardId
      ? await createThreadFromCard(accountId, sourceCardId)
      : await createThread(accountId);

    return Response.json({ thread });
  });
}
