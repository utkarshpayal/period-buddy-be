import test from 'node:test';
import assert from 'node:assert/strict';
import { forestHistoryStart } from '../forestController.js';

const env = { FOREST_FULL_HISTORY_EMAILS: ' Tester@Example.com ,other@x.io' };

test('listed accounts count their whole history (case-insensitive)', () => {
  assert.equal(forestHistoryStart('tester@example.com', '2026-10-05', env), '0000-01-01');
  assert.equal(forestHistoryStart('OTHER@x.io', '2026-10-05', env), '0000-01-01');
});

test('everyone else keeps the one-year window', () => {
  assert.equal(forestHistoryStart('someone@else.com', '2026-10-05', env), '2025-10-05');
  assert.equal(forestHistoryStart(undefined, '2026-10-05', env), '2025-10-05');
  assert.equal(forestHistoryStart('tester@example.com', '2026-10-05', {}), '2025-10-05');
});
