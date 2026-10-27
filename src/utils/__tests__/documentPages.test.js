import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { countPages, withinPageLimit } from '../documentPages.js';

test('counts PDF pages; an image is one page; an unreadable PDF is unknown', async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  assert.equal(await countPages(bytes, 'application/pdf'), 3);
  assert.equal(await countPages(Buffer.from('x'), 'image/jpeg'), 1);
  assert.equal(await countPages(Buffer.from('not a pdf'), 'application/pdf'), null);
});

test('page limit: no limit or unknown pages pass; over the limit fails', () => {
  assert.equal(withinPageLimit(5, 5), true);
  assert.equal(withinPageLimit(6, 5), false);
  assert.equal(withinPageLimit(60, null), true);
  assert.equal(withinPageLimit(null, 5), true);
});
