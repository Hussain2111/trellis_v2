/**
 * Every API field name becomes a human phrase exactly once, here.
 *
 * No `reach`, no `saved`, no `total_interactions` anywhere in the interface.
 * The previous build leaked raw metric names onto the screen and it read like
 * an admin panel.
 */
export const METRIC_LABELS = {
  reach: 'Accounts reached',
  views: 'Views',
  saved: 'Saves',
  shares: 'Shares',
  likes: 'Likes',
  comments: 'Comments',
  totalInteractions: 'Interactions',
  profileViews: 'Profile visits',
  accountsEngaged: 'Accounts engaged',
  followersCount: 'Followers',
  follows: 'Follows',
  unfollows: 'Unfollows',
} as const;

export type MetricKey = keyof typeof METRIC_LABELS;

export function metricLabel(key: MetricKey): string {
  return METRIC_LABELS[key];
}

export const FORMAT_LABELS = {
  image: 'Photo',
  carousel: 'Carousel',
  reel: 'Reel',
  video: 'Video',
  unknown: 'Post',
} as const;
