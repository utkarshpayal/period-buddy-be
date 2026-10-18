import test from 'node:test';
import assert from 'node:assert/strict';
import { URGENT_COMPANION_REPLY, findFallbackAnswer, hasUrgentPattern } from '../companionChat.js';

test('urgent patterns catch red-flag questions', () => {
  [
    'I had bleeding after sex',
    'spotting after intercourse yesterday',
    'is post-coital bleeding normal',
    'bleeding 2 years after menopause',
    'postmenopausal spotting',
    'I am pregnant and have cramps',
    'missed period and sharp pain on one side',
    'positive test and some spotting',
    'soaked through a pad every hour',
    'I change my pad every hour',
    'I fainted during my period',
    'I passed out this morning',
    "I don't want to live anymore",
    'thinking about suicide',
  ].forEach((query) => assert.equal(hasUrgentPattern(query), true, query));
});

test('ordinary questions are not flagged urgent', () => {
  [
    'Is brown period blood normal?',
    'can I take painkillers while pregnant',
    'how long does a period last',
    'is sex during periods okay',
  ].forEach((query) => assert.equal(hasUrgentPattern(query), false, query));
});

test('offline fallback never calls brown blood normal for risky contexts', () => {
  [
    'dark blood after we had sex',
    'brown blood and I am pregnant',
    'brown blood years after menopause',
    'blood with large clots',
    'soaking blood',
  ].forEach((query) => assert.equal(findFallbackAnswer(query), URGENT_COMPANION_REPLY, query));
  assert.match(findFallbackAnswer('Is dark brown blood normal?'), /often normal/);
});

test('urgent check: escalates real emergencies but not everyday period symptoms', () => {
  const urgent = [
    'I fainted in the bathroom',
    'bleeding a lot and feeling dizzy',
    'sudden severe pain on my right side',
    'cramps so bad I cannot walk',
    'I have a fever and pelvic pain',
    'soaking a pad every hour',
    'bleeding after sex',
  ];
  const notUrgent = [
    'I feel dizzy today, log that',
    'I have severe cramps on day 1',
    'bad period pain again',
  ];
  urgent.forEach((t) => assert.equal(hasUrgentPattern(t), true, t));
  notUrgent.forEach((t) => assert.equal(hasUrgentPattern(t), false, t));
});
