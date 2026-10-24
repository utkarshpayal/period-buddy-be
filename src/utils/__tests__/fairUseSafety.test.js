import test from 'node:test';
import assert from 'node:assert/strict';
import { fairUse, isUrgentAiMessage } from '../../middleware/subscriptionMiddleware.js';

test('red-flag AI messages are recognised in every AI endpoint body field', () => {
  assert.equal(
    isUrgentAiMessage({ body: { question: 'I fainted and I am bleeding a lot' } }),
    true,
  );
  assert.equal(isUrgentAiMessage({ body: { message: 'I want to die' } }), true);
  assert.equal(isUrgentAiMessage({ body: { transcript: 'soaking a pad every hour' } }), true);
  assert.equal(isUrgentAiMessage({ body: { question: 'Is brown blood normal?' } }), false);
  assert.equal(isUrgentAiMessage({}), false);
});

test('an urgent AI message passes fair use without touching the database', async () => {
  let called = false;
  await fairUse('ai_message')(
    { userId: '507f1f77bcf86cd799439011', body: { message: 'I passed out' } },
    {},
    () => {
      called = true;
    },
  );
  assert.equal(called, true);
});

test('anonymous requests pass straight through', async () => {
  let called = false;
  await fairUse('ai_message')({ body: { question: 'hi' } }, {}, () => {
    called = true;
  });
  assert.equal(called, true);
});
