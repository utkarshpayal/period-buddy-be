import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSessionStarted } from '../consultationLifecycle.js';

const now = new Date('2026-10-04T10:00:00Z');

test('a booking whose slot is still ahead has not started, whatever its status', () => {
  for (const status of ['paid', 'active']) {
    assert.equal(hasSessionStarted({ status, scheduledFor: '2026-10-09T10:00:00Z' }, now), false);
  }
});

test('a booking has started once its slot begins', () => {
  assert.equal(hasSessionStarted({ scheduledFor: '2026-10-04T10:00:00Z' }, now), true);
  assert.equal(hasSessionStarted({ scheduledFor: '2026-10-04T09:00:00Z' }, now), true);
});

test('a booking from before slots existed counts as started', () => {
  assert.equal(hasSessionStarted({ status: 'paid', scheduledFor: null }, now), true);
});
