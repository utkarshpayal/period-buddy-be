import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordStrength } from '../password.js';

test('accepts any symbol, not just @$!%*?&', () => {
  assert.equal(validatePasswordStrength('Hello#123'), true);
  assert.equal(validatePasswordStrength('Hello@123'), true);
  assert.equal(validatePasswordStrength('Hello 123.'), true);
});

test('still needs length, both cases, a number and a symbol', () => {
  assert.equal(validatePasswordStrength('He#1abc'), false);
  assert.equal(validatePasswordStrength('hello#123'), false);
  assert.equal(validatePasswordStrength('HELLO#123'), false);
  assert.equal(validatePasswordStrength('Hello#abc'), false);
  assert.equal(validatePasswordStrength('Hello1234'), false);
  assert.equal(validatePasswordStrength(undefined), false);
});
