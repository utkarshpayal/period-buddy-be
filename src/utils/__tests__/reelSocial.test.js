import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  REEL_COMMENT_MAX,
  REEL_COMMENT_PAGE_DEFAULT,
  REEL_COMMENT_PAGE_MAX,
  buildCommentPage,
  displayNameOf,
  normalizeCommentText,
  normalizeReelTags,
  orderBySaves,
  parseCommentCursor,
  parseCommentLimit,
  parseFlag,
  reelIdSet,
  serializeComment,
  withViewerState,
} from '../reelSocial.js';

const id = () => new mongoose.Types.ObjectId();

test('like/save flags are set values, never toggles: only true/false count', () => {
  assert.equal(parseFlag(true), true);
  assert.equal(parseFlag('true'), true);
  assert.equal(parseFlag(false), false);
  assert.equal(parseFlag('false'), false);
  for (const value of [undefined, null, 1, 0, 'yes', '', {}]) {
    assert.equal(parseFlag(value), null);
  }
});

test('comment text is trimmed, newline-normalized and capped at 500', () => {
  assert.deepEqual(normalizeCommentText('  hello  '), { text: 'hello' });
  assert.deepEqual(normalizeCommentText('a\r\n\r\n\r\n\r\nb'), { text: 'a\n\nb' });
  assert.ok(normalizeCommentText('   ').error);
  assert.ok(normalizeCommentText(undefined).error);
  assert.ok(normalizeCommentText(42).error);
  assert.deepEqual(normalizeCommentText('x'.repeat(REEL_COMMENT_MAX)), {
    text: 'x'.repeat(REEL_COMMENT_MAX),
  });
  assert.match(normalizeCommentText('x'.repeat(REEL_COMMENT_MAX + 1)).error, /500/);
});

test('cursor must be an ObjectId; limit is clamped', () => {
  const valid = String(id());
  assert.equal(parseCommentCursor(valid), valid);
  assert.equal(parseCommentCursor('nope'), null);
  assert.equal(parseCommentCursor(undefined), null);
  assert.equal(parseCommentCursor({ $gt: '' }), null);
  assert.equal(parseCommentLimit(undefined), REEL_COMMENT_PAGE_DEFAULT);
  assert.equal(parseCommentLimit('0'), REEL_COMMENT_PAGE_DEFAULT);
  assert.equal(parseCommentLimit('5'), 5);
  assert.equal(parseCommentLimit('1000'), REEL_COMMENT_PAGE_MAX);
});

test('a page uses limit + 1 rows to know whether another page exists', () => {
  const rows = [{ _id: 'c5' }, { _id: 'c4' }, { _id: 'c3' }];
  assert.deepEqual(buildCommentPage(rows, 2), {
    items: [{ _id: 'c5' }, { _id: 'c4' }],
    nextCursor: 'c4',
  });
  assert.deepEqual(buildCommentPage(rows, 3), { items: rows, nextCursor: null });
  assert.deepEqual(buildCommentPage([], 20), { items: [], nextCursor: null });
});

test('display names skip an empty last name', () => {
  assert.equal(displayNameOf({ firstName: 'Asha', lastName: '' }), 'Asha');
  assert.equal(displayNameOf({ firstName: 'Asha', lastName: 'Rao' }), 'Asha Rao');
  assert.equal(displayNameOf({}), 'Nura member');
  assert.equal(displayNameOf(null), 'Nura member');
});

test('a comment shows the author name/avatar but never their account id', () => {
  const viewer = id();
  const other = id();
  const row = {
    _id: id(),
    reelId: id(),
    text: 'Helpful, thanks',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    userId: { _id: viewer, firstName: 'Asha', lastName: '', profilePicture: 'https://x/a.jpg' },
    isHidden: true,
    reportCount: 3,
  };
  const own = serializeComment(row, { viewerId: viewer });
  assert.equal(own.isOwn, true);
  assert.equal(own.canDelete, true);
  assert.deepEqual(own.author, { name: 'Asha', avatar: 'https://x/a.jpg' });
  assert.equal(JSON.stringify(own).includes(String(viewer)), false);
  assert.equal('isHidden' in own, false);
  assert.equal('reportCount' in own, false);

  const seenByOther = serializeComment(row, { viewerId: other });
  assert.equal(seenByOther.isOwn, false);
  assert.equal(seenByOther.canDelete, false);

  const moderated = serializeComment(row, { viewerId: other, canModerate: true });
  assert.equal(moderated.canDelete, true);
  assert.equal(moderated.isHidden, true);
  assert.equal(moderated.reportCount, 3);
});

test('a comment whose author is gone (unpopulated id) still serializes', () => {
  const author = id();
  const comment = serializeComment(
    { _id: id(), reelId: id(), text: 'hi', userId: author },
    { viewerId: author },
  );
  assert.equal(comment.author.name, 'Nura member');
  assert.equal(comment.author.avatar, null);
  assert.equal(comment.isOwn, true);
});

test('viewer state comes from the page-wide $in results; counters default to 0', () => {
  const a = id();
  const b = id();
  const likedIds = reelIdSet([{ reelId: a }]);
  const savedIds = reelIdSet([{ reelId: b }]);
  const first = withViewerState({ _id: a, likeCount: 4, viewCount: 9 }, { likedIds, savedIds });
  assert.equal(first.isLiked, true);
  assert.equal(first.isSaved, false);
  assert.equal(first.likeCount, 4);
  assert.equal(first.commentCount, 0);
  assert.equal(first.saveCount, 0);
  assert.equal(first.viewCount, 9);
  const second = withViewerState({ id: String(b), likeCount: -2 }, { likedIds, savedIds });
  assert.equal(second.isLiked, false);
  assert.equal(second.isSaved, true);
  assert.equal(second.likeCount, 0);
});

test('reel tags are cleaned, de-duplicated and capped', () => {
  assert.deepEqual(normalizeReelTags(['#PCOS', ' pcos ', 'Yoga', '', 3]), ['pcos', 'yoga']);
  assert.deepEqual(normalizeReelTags('cramps, sleep'), ['cramps', 'sleep']);
  assert.deepEqual(normalizeReelTags(undefined), []);
  assert.equal(normalizeReelTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 10);
});

test('saved reels keep save order and drop unpublished reels', () => {
  const [a, b, c] = [id(), id(), id()];
  const saves = [{ reelId: c }, { reelId: a }, { reelId: b }];
  const reels = [{ _id: a }, { _id: c }];
  assert.deepEqual(
    orderBySaves(saves, reels).map((reel) => String(reel._id)),
    [String(c), String(a)],
  );
});
