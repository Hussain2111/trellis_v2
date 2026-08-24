import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { env } from '../env';

/**
 * The only module in this codebase that names a model.
 *
 * Free model catalogues change without notice — providers have deleted models
 * that running code depended on. So the model is configuration, the failover
 * lane is configuration, and swapping either is an environment change rather
 * than a deploy. The abstraction costs almost nothing now and is expensive to
 * retrofit.
 */

export type Purpose = 'chat' | 'cards';

/** `provider:model`, e.g. `google:gemini-3.6-flash`. */
export interface ModelRef {
  provider: string;
  modelId: string;
}

export function parseModelRef(value: string): ModelRef {
  const index = value.indexOf(':');
  if (index <= 0 || index === value.length - 1) {
    throw new Error(`Model must be "provider:model", got "${value}".`);
  }
  return { provider: value.slice(0, index), modelId: value.slice(index + 1) };
}

/**
 * Adding a second lane is a registry entry plus its SDK package. Groq, Mistral
 * and OpenRouter are the usual ones; none is installed until it is needed,
 * because an uninstalled fallback is honest and a broken import is not.
 */
const PROVIDERS: Record<string, (ref: ModelRef) => LanguageModel> = {
  google: (ref) => {
    const key = env().GOOGLE_GENERATIVE_AI_API_KEY;
    if (!key) throw new ModelUnavailable('google', 'GOOGLE_GENERATIVE_AI_API_KEY is not set');
    return createGoogleGenerativeAI({ apiKey: key })(ref.modelId);
  },
};

export class ModelUnavailable extends Error {
  readonly provider: string;
  constructor(provider: string, detail: string) {
    super(`${provider}: ${detail}`);
    this.name = 'ModelUnavailable';
    this.provider = provider;
  }
}

export interface ResolvedModel {
  model: LanguageModel;
  provider: string;
  modelId: string;
  /** True when the primary was unavailable and the second lane was used. */
  isFallback: boolean;
}

/**
 * Resolve the model for a purpose, falling back if the primary cannot be
 * built. Failure to resolve is loud — there is no silent degrade to a
 * different capability tier, because a quietly worse model produces quietly
 * worse answers and nothing says so.
 */
export function resolveModel(): ResolvedModel {
  const primary = parseModelRef(env().MODEL_PRIMARY);
  try {
    return { model: build(primary), ...primary, isFallback: false };
  } catch (primaryError) {
    const fallbackRef = env().MODEL_FALLBACK;
    if (!fallbackRef) throw primaryError;
    const fallback = parseModelRef(fallbackRef);
    return { model: build(fallback), ...fallback, isFallback: true };
  }
}

function build(ref: ModelRef): LanguageModel {
  const factory = PROVIDERS[ref.provider];
  if (!factory) {
    throw new ModelUnavailable(ref.provider, 'no adapter registered for this provider');
  }
  return factory(ref);
}

/**
 * Quota rationing.
 *
 * THE UNIT IS CALLS, NOT MESSAGES. One chat message becomes several model calls
 * once the tool loop runs — a request, a tool result, a follow-up, sometimes a
 * repair attempt. A cap expressed in messages per day is silently several times
 * looser than it reads, and the observed ratio has to be measured from real
 * turns rather than assumed.
 *
 * Scheduled card generation reserves its allowance first. Heavy chat use must
 * not be able to starve the dashboard, because the dashboard is the surface
 * that runs while nobody is watching.
 */
export interface QuotaCaps {
  /** Total model CALLS per day across all purposes. Read from the provider
   *  console, never copied from a blog — free-tier limits changed
   *  substantially in late 2025 and are no longer published as a static
   *  table. Recorded in docs/quota.md with the date observed. */
  dailyCalls: number;
  /** Calls held back for scheduled generation, unavailable to chat. */
  reservedForCards: number;
}

export interface QuotaLedger {
  /** Calls already spent today for a purpose. Failures count — a failed call
   *  spent the same quota as a successful one. */
  callsToday(purpose: Purpose): Promise<number>;
}

export interface Headroom {
  allowed: boolean;
  used: number;
  limit: number;
  reason?: string;
}

export async function checkHeadroom(
  purpose: Purpose,
  ledger: QuotaLedger,
  caps: QuotaCaps,
): Promise<Headroom> {
  const [chat, cards] = await Promise.all([ledger.callsToday('chat'), ledger.callsToday('cards')]);
  const used = purpose === 'chat' ? chat : cards;

  if (purpose === 'cards') {
    const limit = caps.dailyCalls;
    return used < limit
      ? { allowed: true, used, limit }
      : { allowed: false, used, limit, reason: "today's model allowance is spent" };
  }

  // Chat may use everything except what is held back for the scheduled run.
  const limit = Math.max(0, caps.dailyCalls - caps.reservedForCards);
  const spentOnCards = Math.min(cards, caps.reservedForCards);
  const availableToChat = limit - Math.max(0, cards - spentOnCards);

  return used < availableToChat
    ? { allowed: true, used, limit: availableToChat }
    : {
        allowed: false,
        used,
        limit: availableToChat,
        reason: 'chat allowance is spent for today; the rest is reserved for insight cards',
      };
}
