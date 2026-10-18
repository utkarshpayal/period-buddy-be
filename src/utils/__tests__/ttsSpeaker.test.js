import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTtsSpeaker } from '../sarvamClient.js';

const v3 = { model: 'bulbul:v3', envSpeaker: undefined };

test('defaults to a female bulbul:v3 voice', () => {
  assert.equal(resolveTtsSpeaker(undefined, v3), 'priya');
});

test('defaults to a female bulbul:v2 voice', () => {
  assert.equal(resolveTtsSpeaker(undefined, { model: 'bulbul:v2' }), 'anushka');
});

test('honours a requested female voice for the model', () => {
  assert.equal(resolveTtsSpeaker('Kavya', v3), 'kavya');
});

test('ignores male or wrong-model voices', () => {
  assert.equal(resolveTtsSpeaker('anand', v3), 'priya');
  assert.equal(resolveTtsSpeaker('anushka', v3), 'priya');
  assert.equal(resolveTtsSpeaker('anand', { model: 'bulbul:v2' }), 'anushka');
});

test('uses SARVAM_TTS_SPEAKER only when it is a valid female voice', () => {
  assert.equal(
    resolveTtsSpeaker(undefined, { model: 'bulbul:v3', envSpeaker: 'shreya' }),
    'shreya',
  );
  assert.equal(resolveTtsSpeaker(undefined, { model: 'bulbul:v3', envSpeaker: 'shubh' }), 'priya');
});
