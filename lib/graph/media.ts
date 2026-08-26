import { graphGet, type RateLimitUsage } from './client';

/**
 * The media edge, and the mapping from Meta's shapes to ours.
 *
 * Two findings from the probe are load-bearing here:
 *
 *   `media_count` is NOT a completion check. It reported 229 where a full walk
 *   found 243. Pagination exhaustion is the terminator — a count-based check
 *   stops fourteen posts short, silently, in a way that looks like success.
 *
 *   `thumbnail_url` is media-type conditional: served on VIDEO/REELS, absent on
 *   CAROUSEL_ALBUM and IMAGE, which carry `media_url`. Both are stored and the
 *   choice is made at read time.
 */

export const MEDIA_FIELDS = [
  'id',
  'shortcode',
  'caption',
  'media_type',
  'media_product_type',
  'timestamp',
  'permalink',
  'thumbnail_url',
  'media_url',
  'like_count',
  'comments_count',
].join(',');

export interface RawMedia {
  id: string;
  shortcode?: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  timestamp?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
}

export interface MappedMedia {
  igMediaId: string;
  shortcode: string;
  caption: string | null;
  mediaType: 'image' | 'carousel' | 'reel' | 'video' | 'unknown';
  mediaProductType: string | null;
  publishedAt: Date | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  raw: unknown;
}

export function normaliseMediaType(raw: RawMedia): MappedMedia['mediaType'] {
  const product = (raw.media_product_type ?? '').toUpperCase();
  const type = (raw.media_type ?? '').toUpperCase();
  if (product === 'REELS' || product === 'CLIPS') return 'reel';
  if (type === 'CAROUSEL_ALBUM') return 'carousel';
  if (type === 'IMAGE') return 'image';
  if (type === 'VIDEO') return 'video';
  return 'unknown';
}

/**
 * A media item with no usable shortcode cannot be joined to anything, so it is
 * returned as `null` and counted rather than stored half-formed. The permalink
 * fallback exists because losing a post outright is worse than deriving its key
 * from a URL Meta already gave us.
 */
export function mapMedia(raw: RawMedia): MappedMedia | null {
  const shortcode = raw.shortcode ?? raw.permalink?.match(/\/(?:p|reel|tv)\/([^/?]+)/)?.[1] ?? null;
  if (!shortcode) return null;

  return {
    igMediaId: raw.id,
    shortcode,
    caption: raw.caption ?? null,
    mediaType: normaliseMediaType(raw),
    mediaProductType: raw.media_product_type ?? null,
    publishedAt: raw.timestamp ? new Date(raw.timestamp) : null,
    permalink: raw.permalink ?? null,
    thumbnailUrl: raw.thumbnail_url ?? null,
    mediaUrl: raw.media_url ?? null,
    likeCount: raw.like_count ?? null,
    commentsCount: raw.comments_count ?? null,
    raw,
  };
}

export interface MediaPage {
  media: MappedMedia[];
  /** Items Meta returned that had no usable join key. Reported, never silent. */
  skipped: number;
  /** `null` means the walk is exhausted — the only valid terminator. */
  nextCursor: string | null;
  usage: RateLimitUsage;
}

export async function fetchMediaPage(
  igUserId: string,
  options: { after?: string; limit?: number } = {},
): Promise<MediaPage> {
  const params: Record<string, string> = {
    fields: MEDIA_FIELDS,
    limit: String(options.limit ?? 50),
  };
  if (options.after) params.after = options.after;

  const { body, usage } = await graphGet<{
    data?: RawMedia[];
    paging?: { cursors?: { after?: string }; next?: string };
  }>(`${igUserId}/media`, params);

  const rows = body.data ?? [];
  const media: MappedMedia[] = [];
  let skipped = 0;
  for (const row of rows) {
    const mapped = mapMedia(row);
    if (mapped) media.push(mapped);
    else skipped += 1;
  }

  // Exhaustion means Meta stopped offering a next page — not that we reached
  // some expected count.
  const nextCursor = body.paging?.next ? (body.paging.cursors?.after ?? null) : null;

  return { media, skipped, nextCursor, usage };
}
