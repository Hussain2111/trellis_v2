import { createThread, listThreads, selfAccountId } from '@/lib/chat/threads';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const accountId = await selfAccountId();
  if (!accountId) return Response.json({ threads: [] });
  return Response.json({ threads: await listThreads(accountId) });
}

export async function POST(): Promise<Response> {
  const accountId = await selfAccountId();
  if (!accountId) return Response.json({ error: 'no_account' }, { status: 409 });
  return Response.json({ thread: await createThread(accountId) });
}
