import test from 'node:test';
import assert from 'node:assert/strict';
import { countWords, readingMinutes } from '../blogReadTime.js';

test('word count ignores markup, links targets and URLs', () => {
  assert.equal(countWords('<p>Hello <b>world</b></p>'), 2);
  assert.equal(countWords('See [the guide](https://example.com/a-b-c) now'), 4);
  assert.equal(countWords('![cover](https://x.y/z.png)\n\n## Phases — one'), 2);
  assert.equal(countWords(''), 0);
  assert.equal(countWords(undefined), 0);
});

test('reading time is ~200 words a minute, never below one', () => {
  assert.equal(readingMinutes('word '.repeat(200)), 1);
  assert.equal(readingMinutes('word '.repeat(1000)), 5);
  assert.equal(readingMinutes('word '.repeat(1100)), 6);
  assert.equal(readingMinutes('short'), 1);
  assert.equal(readingMinutes('', 7), 7);
  assert.equal(readingMinutes('', 0), 1);
});
