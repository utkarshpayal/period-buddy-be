import test from 'node:test';
import assert from 'node:assert/strict';
import { richTextToPlain, splitForTranslation } from '../richText.js';
import { countWords } from '../blogReadTime.js';

const chart =
  '```chart\n{"type":"bar","labels":["Day one","Day two"],"series":[{"name":"Pain","values":[7,4]}]}\n```';
const post = `## Why it <span data-color="rose">hurts</span>

Cramps are <mark data-color="yellow">common</mark> and <u>usually</u> **mild**.

${chart}

![A hot water bag](https://cdn.example.com/bag.jpg "Warmth helps")

Rest helps.`;

test('richTextToPlain keeps the words and drops markup and chart data', () => {
  const plain = richTextToPlain(post);
  assert.match(plain, /Why it hurts/);
  assert.match(plain, /Cramps are common and usually mild\./);
  assert.doesNotMatch(plain, /data-color|<|\{|chart|bag\.jpg/);
});

test('countWords ignores chart JSON', () => {
  assert.equal(countWords(chart), 0);
  assert.equal(countWords(`Two words\n\n${chart}`), 2);
});

test('splitForTranslation keeps charts and images verbatim and strips styling tags', () => {
  const parts = splitForTranslation(post);
  assert.deepEqual(
    parts.map((p) => p.translate),
    [true, false, false, true],
  );
  assert.equal(parts[0].text, '## Why it hurts\n\nCramps are common and usually **mild**.');
  assert.equal(parts[1].text, chart);
  assert.match(parts[2].text, /^!\[A hot water bag\]/);
  assert.equal(parts[3].text, 'Rest helps.');
});

test('splitForTranslation handles plain Markdown as one part', () => {
  assert.deepEqual(splitForTranslation('One.\n\nTwo.'), [
    { text: 'One.\n\nTwo.', translate: true },
  ]);
  assert.deepEqual(splitForTranslation(''), []);
});
