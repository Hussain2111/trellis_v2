import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { accounts, chatMessages, chatThreads } from '../db/schema';
import { renderChatSystem } from '../prompts/chat-system';
import { accountOverview } from './queries';

export async function selfAccountId(): Promise<number | null> {
  const [row] = await db().select({ id: accounts.id }).from(accounts).limit(1);
  return row?.id ?? null;
}

export async function listThreads(accountId: number) {
  return db()
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.accountId, accountId))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(50);
}

export async function createThread(accountId: number, sourceCardId?: number) {
  const [row] = await db()
    .insert(chatThreads)
    .values({ accountId, sourceCardId: sourceCardId ?? null })
    .returning();
  return row!;
}

export async function threadMessages(threadId: number) {
  return db()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(chatMessages.createdAt);
}

export async function appendMessage(input: {
  threadId: number;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: unknown;
  validation?: unknown;
}) {
  await db()
    .insert(chatMessages)
    .values({
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      toolCalls: (input.toolCalls ?? null) as object,
      validation: (input.validation ?? null) as object,
    });
  await db()
    .update(chatThreads)
    .set({ updatedAt: new Date() })
    .where(eq(chatThreads.id, input.threadId));
}

export async function titleThread(threadId: number, from: string) {
  const title = from.trim().slice(0, 70) + (from.trim().length > 70 ? '…' : '');
  await db().update(chatThreads).set({ title }).where(eq(chatThreads.id, threadId));
}

export async function deleteThread(threadId: number) {
  await db().delete(chatThreads).where(eq(chatThreads.id, threadId));
}

/** Built fresh every turn from real state, so it can never describe a stale account. */
export async function buildSystemPrompt(accountId: number): Promise<string> {
  const overview = await accountOverview(accountId);
  return renderChatSystem({
    handle: overview.handle,
    followers: overview.followers,
    posts: overview.coverage.posts,
    postsWithInsights: overview.coverage.postsWithInsights,
    oldestPost: overview.coverage.oldestPost,
    followerDays: overview.coverage.followerDays,
    today: new Date().toISOString().slice(0, 10),
  });
}

/** Today's model calls, for rationing. Failures count — they spent the same quota. */
export async function callsToday(purpose: 'chat' | 'cards'): Promise<number> {
  const [row] = (await db().execute(sql`
    select count(*)::int as n from model_runs
    where purpose = ${purpose} and created_at > now() - interval '24 hours'
  `)) as unknown as { n: number }[];
  return row?.n ?? 0;
}
