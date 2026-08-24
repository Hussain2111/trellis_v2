/**
 * Seven scopes. Verified against a live token, not read off documentation.
 *
 * `business_management` is the one that costs hours. Without it,
 * `GET /me/accounts` returns `{"data": []}` — empty, and NOT an error — while
 * `GET /me?fields=id,name` returns the correct profile. So the token is valid,
 * belongs to the right person, and simply reports that they administer no
 * Pages. Nothing anywhere says a permission is missing.
 *
 * The account resolves as:
 *   user token → /me/accounts → Page id
 *              → /{page-id}?fields=instagram_business_account → IG_USER_ID
 *
 * Use the **Facebook Login** flow, not "Instagram API with Instagram Login" —
 * the latter issues a different token type and this resolution path does not
 * exist on it.
 */
export const REQUIRED_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_manage_comments',
  'pages_read_engagement',
  'pages_show_list',
  'business_management',
] as const;

/**
 * Publishing is not a feature of this product — posting happens by hand, and
 * the calendar exists to make copy-paste-post frictionless rather than to
 * automate it. The scope is requested anyway because regenerating a token later
 * to add one is worse than holding one you never use.
 */
export const PUBLISHING_SCOPES = ['instagram_content_publish'] as const;

export const ALL_SCOPES = [...REQUIRED_SCOPES, ...PUBLISHING_SCOPES] as const;

export const SCOPE_PURPOSE: Record<string, string> = {
  instagram_basic: 'Everything',
  instagram_manage_insights: 'Reach, saves, shares, views, follower counts',
  instagram_manage_comments: 'Comments and who wrote them',
  pages_read_engagement: 'Reading the Page → Instagram link',
  pages_show_list: 'Finding the linked Page',
  business_management: 'The Page appearing in /me/accounts at all',
  instagram_content_publish: 'Not used — held so a future token need not be regenerated',
};
