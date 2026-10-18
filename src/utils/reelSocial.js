/**
 * Reels likes, saves and comments: pure helpers (no database), unit-tested in
 * __tests__/reelSocial.test.js. The controller (reelController.js) does the
 * queries; this file decides shapes, limits and paging.
 */

/** Longest comment, in characters (checked on the plain text). */
export const REEL_COMMENT_MAX = 500;
/** Comments per page: default and ceiling. */
export const REEL_COMMENT_PAGE_DEFAULT = 20;
export const REEL_COMMENT_PAGE_MAX = 50;
/** A comment is hidden from everyone once this many different people report it. */
export const REEL_COMMENT_REPORT_HIDE_AT = 5;

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * Body flag for the set-style endpoints (`{ liked }`, `{ saved }`). Only a real
 * boolean (or the strings "true"/"false" from form posts) counts; anything
 * else is null, so a missing flag is a 400 rather than a silent toggle.
 */
export const parseFlag = (value) => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
};

/**
 * Clean a comment before it's stored: trims, turns \r\n into \n, keeps at most
 * one blank line in a row. Returns `{ text }` or `{ error }`.
 */
export const normalizeCommentText = (raw) => {
  if (typeof raw !== 'string') return { error: 'Comment text is required' };
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return { error: 'Comment text is required' };
  if (text.length > REEL_COMMENT_MAX) {
    return { error: `Comments can be at most ${REEL_COMMENT_MAX} characters` };
  }
  return { text };
};

/** `?cursor=` is the id of the last comment already shown; anything else means "from the top". */
export const parseCommentCursor = (value) =>
  typeof value === 'string' && OBJECT_ID.test(value) ? value : null;

export const parseCommentLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return REEL_COMMENT_PAGE_DEFAULT;
  return Math.min(parsed, REEL_COMMENT_PAGE_MAX);
};

/**
 * Rows were fetched newest first with `limit + 1`; the extra row only says
 * there's another page. `nextCursor` is the last shown row's id.
 */
export const buildCommentPage = (rows, limit) => {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore && items.length > 0 ? String(items[items.length - 1]._id) : null,
  };
};

/** Display name that skips an empty last name (lastName is optional everywhere). */
export const displayNameOf = (user) => {
  const name = [user?.firstName, user?.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return name || 'Nura member';
};

/**
 * One comment for a client. Only the author's name and photo leave the
 * server, never their account id. `canDelete` is the author or a moderator;
 * moderators (the admin portal) also get the hidden/report fields.
 */
export const serializeComment = (row, { viewerId, canModerate = false } = {}) => {
  // Populated author (a plain object) vs a bare ObjectId (author gone).
  const populated =
    row.userId != null &&
    typeof row.userId === 'object' &&
    typeof row.userId.toHexString !== 'function';
  const author = populated ? row.userId : null;
  const authorId = populated ? row.userId._id : row.userId;
  const isOwn = viewerId != null && String(authorId) === String(viewerId);
  const comment = {
    id: String(row._id),
    reelId: String(row.reelId),
    text: row.text,
    createdAt: row.createdAt,
    author: {
      name: author ? displayNameOf(author) : 'Nura member',
      avatar: author?.profilePicture || null,
    },
    isOwn,
    canDelete: isOwn || canModerate,
  };
  if (canModerate) {
    comment.isHidden = Boolean(row.isHidden);
    comment.reportCount = row.reportCount || 0;
  }
  return comment;
};

/** Ids (as strings) of the reels in `rows` (`{ reelId }` rows from ReelLike/ReelSave). */
export const reelIdSet = (rows) => new Set((rows || []).map((row) => String(row.reelId)));

/**
 * Add the viewer's own state and the counters to a serialized reel. Missing
 * counters on older documents read as 0.
 */
export const withViewerState = (reel, { likedIds, savedIds }) => {
  const id = String(reel._id ?? reel.id);
  return {
    ...reel,
    isLiked: likedIds.has(id),
    isSaved: savedIds.has(id),
    likeCount: Math.max(0, reel.likeCount || 0),
    saveCount: Math.max(0, reel.saveCount || 0),
    commentCount: Math.max(0, reel.commentCount || 0),
    viewCount: Math.max(0, reel.viewCount || 0),
  };
};

/** Reel tags from the admin form: trimmed, lowercase, de-duplicated, at most 10 of ≤ 40 chars. */
export const normalizeReelTags = (value) => {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const seen = new Set();
  const tags = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const tag = entry.trim().replace(/^#+/, '').toLowerCase().slice(0, 40);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 10) break;
  }
  return tags;
};

/**
 * Keep the saved-list order (newest save first) while dropping reels that
 * are gone or unpublished.
 */
export const orderBySaves = (saveRows, reels) => {
  const byId = new Map(reels.map((reel) => [String(reel._id), reel]));
  return saveRows.map((row) => byId.get(String(row.reelId))).filter(Boolean);
};
