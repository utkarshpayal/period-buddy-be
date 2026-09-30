import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../logger.js';

test('redact drops secrets and health text, masks contact details', () => {
  const out = redact({
    userId: 'u1',
    email: 'priya@example.com',
    phone: '+91 98765 43210',
    token: 'eyJ…',
    text: 'I had heavy bleeding',
    nested: { otp: '1234', rows: [{ note: 'cramps' }] },
    count: 3,
  });
  assert.deepEqual(out, {
    userId: 'u1',
    email: 'p***@example.com',
    phone: '•••10',
    token: '[redacted]',
    text: '[20 chars]',
    nested: { otp: '[redacted]', rows: [{ note: '[6 chars]' }] },
    count: 3,
  });
});
