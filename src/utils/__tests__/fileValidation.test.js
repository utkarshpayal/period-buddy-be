import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMimeType, assertAllowedUpload } from '../fileValidation.js';

/* Minimal real magic-byte headers for each format. */
const headers = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  gif: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  pdf: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), // %PDF-1
  webp: Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
  ]),
  mp3: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]), // ID3
};

test('detectMimeType identifies real image/pdf headers', () => {
  assert.equal(detectMimeType(headers.jpeg), 'image/jpeg');
  assert.equal(detectMimeType(headers.png), 'image/png');
  assert.equal(detectMimeType(headers.gif), 'image/gif');
  assert.equal(detectMimeType(headers.pdf), 'application/pdf');
  assert.equal(detectMimeType(headers.webp), 'image/webp');
  assert.equal(detectMimeType(headers.mp3), 'audio/mpeg');
});

test('detectMimeType returns null for unknown / text content', () => {
  // An SVG is text — no binary magic — and must not be treated as an image.
  const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="...">', 'utf8');
  assert.equal(detectMimeType(svg), null);
  // An HTML payload disguised with an image extension.
  const html = Buffer.from('<!DOCTYPE html><script>alert(1)</script>', 'utf8');
  assert.equal(detectMimeType(html), null);
  // Too short to be anything.
  assert.equal(detectMimeType(Buffer.from([0x00])), null);
});

test('assertAllowedUpload accepts content matching an allowed category', () => {
  assert.equal(assertAllowedUpload(headers.png, ['image', 'pdf']), 'image/png');
  assert.equal(assertAllowedUpload(headers.pdf, ['image', 'pdf']), 'application/pdf');
  assert.equal(assertAllowedUpload(headers.mp3, ['audio']), 'audio/mpeg');
});

test('assertAllowedUpload rejects a spoofed / disallowed file', () => {
  // A PDF where only image/pdf are... allowed, but caller wants audio only.
  assert.throws(() => assertAllowedUpload(headers.pdf, ['audio']), /does not match an allowed/);
  // SVG masquerading as an image is rejected (no binary magic).
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
  assert.throws(() => assertAllowedUpload(svg, ['image']), /does not match an allowed/);
});
