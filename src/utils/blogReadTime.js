/**
 * Blog reading time, computed from the article itself (~200 words a minute,
 * at least one minute). The Blog model stores it on every create/update
 * (models/Blog.js hooks), and readers backfill it for posts saved before
 * that (see blogController#ensureReadTimes).
 */

import { CHART_FENCE } from './richText.js';

export const WORDS_PER_MINUTE = 200;

/** Words a reader actually reads: chart data, HTML tags, markdown image/link
 * targets and bare URLs don't count. */
export const countWords = (content = '') =>
  String(content ?? '')
    .replace(CHART_FENCE, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\]\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;

/**
 * Minutes to read `content`. With no readable words it falls back to
 * `fallback` (an older admin estimate), and is never below 1.
 */
export const readingMinutes = (content = '', fallback = 0) => {
  const words = countWords(content);
  if (!words) return Math.max(1, Math.round(Number(fallback) || 0) || 1);
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
};
