import { z } from 'zod';
import { createThread, listThreads, selfAccountId } from '@/lib/chat/threads';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const accountId = await selfAccountId();
  if (!accountId) return Response.json({ threads: [] });
  return Response.json({ threads: await listThreads(accountId) });
}

const bodySchema = z.object({ sourceCardId: z.number().int().optional() });

export async function POST(request: Request): Promise<Response> {
  const accountId = await selfAccountId();
  if (!accountId) return Response.json({ error: 'no_account' }, { status: 409 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const sourceCardId = parsed.success ? parsed.data.sourceCardId : undefined;

  return Response.json({ thread: await createThread(accountId, sourceCardId) });
}
