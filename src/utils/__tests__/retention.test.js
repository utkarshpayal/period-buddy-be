import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoffFor, dayKeyOf, retentionDays } from '../retentionRunner.js';

test('cutoffFor: N days back, or null (keep) for 0', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  assert.equal(cutoffFor(90, now).toISOString(), '2026-07-03T00:00:00.000Z');
  assert.equal(cutoffFor(0, now), null);
  assert.equal(dayKeyOf(new Date('2026-07-03T05:00:00Z')), '2026-07-03');
});

test('retentionDays: defaults, overrides, 0 allowed, junk ignored', () => {
  const saved = { ...process.env };
  delete process.env.NOTIFICATION_RETENTION_DAYS;
  process.env.AUDIT_LOG_RETENTION_DAYS = '0';
  process.env.USAGE_RETENTION_DAYS = 'abc';
  assert.deepEqual(retentionDays(), { notifications: 90, auditLogs: 0, usage: 400 });
  process.env = saved;
});
