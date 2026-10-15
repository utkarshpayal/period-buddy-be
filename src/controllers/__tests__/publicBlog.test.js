import test from 'node:test';
import assert from 'node:assert/strict';
import { readingMinutes, toPublicBlog } from '../blogController.js';

const blog = {
  _id: '64b000000000000000000001',
  title: 'Understanding your cycle',
  slug: 'understanding-your-cycle',
  excerpt: 'The four phases, explained.',
  content: '## Phases\n\nBody',
  category: 'health',
  tags: ['cycle'],
  author: 'Nura Team',
  authorId: '64b000000000000000000002',
  readTimeMinutes: 4,
  totalReadSeconds: 600,
  readSessionCount: 2,
  viewCount: 10,
  seoTitle: 'Cycle phases',
  publishedAt: new Date('2026-10-01'),
};

test('public list shape drops internal analytics, author id and content', () => {
  const out = toPublicBlog(blog);
  assert.equal(out.id, blog._id);
  assert.equal(out.readTimeMinutes, 1); // from the 4-word content, not the dwell-time analytics
  for (const field of ['content', 'authorId', 'totalReadSeconds', 'readSessionCount', 'seoTitle']) {
    assert.equal(field in out, false, `${field} should not be public`);
  }
});

test('detail shape includes content and SEO fields', () => {
  const out = toPublicBlog(blog, { includeContent: true });
  assert.equal(out.content, blog.content);
  assert.equal(out.seoTitle, 'Cycle phases');
  assert.equal(out.seoDescription, null);
});

test('reading time is words / 200, at least a minute, falling back to the estimate', () => {
  assert.equal(readingMinutes('word '.repeat(1000)), 5);
  assert.equal(readingMinutes('short'), 1);
  assert.equal(readingMinutes('', 7), 7);
  assert.equal(readingMinutes(undefined), 1);
});
