import { deleteThread, selfAccountId } from '@/lib/chat/threads';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const accountId = await selfAccountId();
  if (!accountId) return Response.json({ error: 'no_account' }, { status: 409 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) return Response.json({ error: 'bad request' }, { status: 400 });

  // Scoped to the account, not just the id — the delete is a filter, not a
  // lookup followed by a trusting removal.
  await deleteThread(accountId, id);
  return Response.json({ ok: true });
}
