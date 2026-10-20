import test from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed, parseAllowedOrigins } from '../allowedOrigins.js';

test('parseAllowedOrigins trims and drops empty entries', () => {
  assert.deepEqual(parseAllowedOrigins(' https://a.com, ,https://b.com,'), [
    'https://a.com',
    'https://b.com',
  ]);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
});

test('exact origins match only themselves', () => {
  const allowed = ['https://admin.thenura.care'];
  assert.equal(isOriginAllowed('https://admin.thenura.care', allowed), true);
  assert.equal(isOriginAllowed('https://cms.thenura.care', allowed), false);
  assert.equal(isOriginAllowed(undefined, allowed), false);
});

test('https://*.domain allows any subdomain over https on the default port', () => {
  const allowed = ['https://*.thenura.care'];
  assert.equal(isOriginAllowed('https://staging.admin.thenura.care', allowed), true);
  assert.equal(isOriginAllowed('https://stage.cms.thenura.care', allowed), true);
  assert.equal(isOriginAllowed('https://thenura.care', allowed), false);
  assert.equal(isOriginAllowed('http://staging.admin.thenura.care', allowed), false);
  assert.equal(isOriginAllowed('https://admin.thenura.care:8443', allowed), false);
  assert.equal(isOriginAllowed('https://evilthenura.care', allowed), false);
  assert.equal(isOriginAllowed('https://thenura.care.evil.com', allowed), false);
  assert.equal(isOriginAllowed('not a url', allowed), false);
});

test('a bare * allows everything unless allowAny is off', () => {
  assert.equal(isOriginAllowed('https://evil.example', ['*']), true);
  assert.equal(isOriginAllowed('https://evil.example', ['*'], { allowAny: false }), false);
});
