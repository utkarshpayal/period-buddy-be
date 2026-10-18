import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlogUpdate, statusForPublished } from '../../models/Blog.js';
import {
  forceDraftVisibility,
  normalizeBlogCategory,
  resolveVisibilityInput,
} from '../contentController.js';
import { normalizeBlogStatus } from '../blogController.js';

test('status verbs and names are both understood', () => {
  for (const status of ['publish', 'published', 'active', 'live']) {
    assert.deepEqual(resolveVisibilityInput({ status }), { provided: true, value: true });
  }
  for (const status of ['unpublish', 'unpublished', 'draft', 'inactive']) {
    assert.deepEqual(resolveVisibilityInput({ status }), { provided: true, value: false });
  }
  assert.deepEqual(resolveVisibilityInput({ status: 'archive' }), {
    provided: true,
    value: false,
    archived: true,
  });
  assert.equal(resolveVisibilityInput({ status: 'bogus' }).invalid, true);
});

test('an unpublish flag is never read as the publish default', () => {
  // PATCH .../publish defaults to "publish" when the body says nothing.
  assert.equal(resolveVisibilityInput({ published: false }, true).value, false);
  assert.equal(resolveVisibilityInput({ active: 'false' }, true).value, false);
  assert.equal(resolveVisibilityInput({ visible: false }, true).value, false);
  assert.equal(resolveVisibilityInput({}, true).value, true);
  assert.equal(resolveVisibilityInput({}).provided, false);
});

test('drafts forced for non-publishers drop every visibility flag', () => {
  const body = forceDraftVisibility({ title: 't', published: true, visible: true, isActive: true });
  assert.deepEqual(body, { title: 't', status: 'draft' });
});

test('blog categories match the enum in any case', () => {
  assert.equal(normalizeBlogCategory('General'), 'general');
  assert.equal(normalizeBlogCategory(' HEALTH '), 'health');
  assert.equal(normalizeBlogCategory(''), undefined);
  assert.equal(normalizeBlogCategory('Education'), null);
});

test('blog API status aliases', () => {
  assert.equal(normalizeBlogStatus('publish'), 'published');
  assert.equal(normalizeBlogStatus('Unpublish'), 'draft');
  assert.equal(normalizeBlogStatus('archive'), 'archived');
  assert.equal(normalizeBlogStatus(undefined), undefined);
  assert.equal(normalizeBlogStatus('nope'), null);
});

test('blog updates keep status and isPublished in step', () => {
  const publish = { isPublished: true };
  assert.equal(normalizeBlogUpdate(publish), true, 'needs a publishedAt');
  assert.equal(publish.status, 'published');

  const archive = { $set: { status: 'archived' } };
  assert.equal(normalizeBlogUpdate(archive), false);
  assert.equal(archive.$set.isPublished, false);

  // Both set and disagreeing: isPublished wins.
  const both = { isPublished: true, status: 'draft' };
  normalizeBlogUpdate(both);
  assert.equal(both.status, 'published');

  const hidden = { isPublished: 'false', status: 'archived' };
  normalizeBlogUpdate(hidden);
  assert.equal(hidden.status, 'archived');

  assert.equal(statusForPublished(false, 'archived'), 'archived');
  assert.equal(statusForPublished(false, 'published'), 'draft');
});

test('publishing keeps a chosen date and ignores a null one', () => {
  const dated = { isPublished: true, publishedAt: new Date('2026-01-01') };
  assert.equal(normalizeBlogUpdate(dated), false);
  const nulled = { isPublished: true, publishedAt: null };
  assert.equal(normalizeBlogUpdate(nulled), true);
  assert.equal('publishedAt' in nulled, false);
});

test('reading time follows content and ignores hand-typed estimates', () => {
  const withContent = { $set: { content: 'word '.repeat(600), readTimeMinutes: 30 } };
  normalizeBlogUpdate(withContent);
  assert.equal(withContent.$set.readTimeMinutes, 3);

  const split = { content: 'word '.repeat(400), $set: { readTimeMinutes: 9 } };
  normalizeBlogUpdate(split);
  assert.equal(split.readTimeMinutes, 2);
  assert.equal('readTimeMinutes' in split.$set, false);

  const estimateOnly = { readTimeMinutes: 12 };
  normalizeBlogUpdate(estimateOnly);
  assert.equal('readTimeMinutes' in estimateOnly, false);

  const seed = {
    $setOnInsert: {
      content: 'a b c',
      readTimeMinutes: 8,
      isPublished: true,
      status: 'published',
      publishedAt: new Date(),
    },
  };
  assert.equal(normalizeBlogUpdate(seed), false);
  assert.equal(seed.$setOnInsert.readTimeMinutes, 1);
});
