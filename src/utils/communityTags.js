/**
 * Free-form tags on community posts. The app offers a few preset categories
 * plus user-typed tags, so everything here is untrusted text: it's cleaned
 * the same way the app's composer (period-buddy `lib/communityTags.ts`)
 * cleans it, and the server is the one that enforces the limits.
 */

export const MAX_COMMUNITY_TAGS = 5;
export const MAX_COMMUNITY_TAG_LENGTH = 24;

/**
 * One tag: leading '#'s removed, anything but letters, digits, spaces, '-'
 * and '_' dropped, whitespace collapsed. Returns '' when nothing is left.
 */
export const sanitizeCommunityTag = (value) =>
  String(value ?? '')
    .normalize('NFC')
    .replace(/^[\s#]+/u, '')
    .replace(/[^\p{L}\p{N}\p{M} _-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Normalizes a request's `tags` (array, or a comma-separated string from
 * older clients). Empty tags are dropped and duplicates are removed ignoring
 * case (the first spelling wins).
 *
 * @returns {{ tags: string[], error?: string }}
 */
export const normalizeCommunityTags = (value) => {
  if (value === undefined || value === null || value === '') return { tags: [] };
  const raw = Array.isArray(value) ? value : String(value).split(',');

  const tags = [];
  const seen = new Set();
  for (const item of raw) {
    if (item !== null && typeof item === 'object') return { tags: [], error: 'Invalid tag' };
    const tag = sanitizeCommunityTag(item);
    if (!tag) continue;
    if (tag.length > MAX_COMMUNITY_TAG_LENGTH) {
      return {
        tags: [],
        error: `Tags can be at most ${MAX_COMMUNITY_TAG_LENGTH} characters`,
      };
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  if (tags.length > MAX_COMMUNITY_TAGS) {
    return { tags: [], error: `A post can have at most ${MAX_COMMUNITY_TAGS} tags` };
  }
  return { tags };
};
