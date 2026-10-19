import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGE_BANDS,
  AI_SAFETY_BLOCK,
  ageBandInstruction,
  getAgeBand,
  withAiSafety,
} from '../aiSafety.js';

const NOW = new Date('2026-10-18T00:00:00Z').getTime();

test('safety block covers emergencies, helplines and the see-a-doctor-soon cases', () => {
  for (const phrase of ['112', '14416', 'Tele-MANAS', 'after menopause', 'after sex', '"safe"']) {
    assert.ok(AI_SAFETY_BLOCK.includes(phrase), `missing ${phrase}`);
  }
  assert.ok(withAiSafety('Base prompt.').startsWith('Base prompt.'));
  assert.ok(withAiSafety('Base prompt.').endsWith(AI_SAFETY_BLOCK));
});

test('getAgeBand splits minors, adults and unknown', () => {
  assert.equal(getAgeBand('2012-01-01', NOW), AGE_BANDS.MINOR);
  assert.equal(getAgeBand('2008-10-17', NOW), AGE_BANDS.ADULT);
  assert.equal(getAgeBand('2000-01-01', NOW), AGE_BANDS.ADULT);
  assert.equal(getAgeBand(null, NOW), AGE_BANDS.UNKNOWN);
  assert.equal(getAgeBand('not a date', NOW), AGE_BANDS.UNKNOWN);
});

test('age band instructions: minors and unknown stay educational, adults add nothing', () => {
  assert.match(ageBandInstruction(AGE_BANDS.MINOR), /under 18/);
  assert.match(ageBandInstruction(AGE_BANDS.MINOR), /positions/);
  assert.match(ageBandInstruction(AGE_BANDS.UNKNOWN), /positions/);
  assert.equal(ageBandInstruction(AGE_BANDS.ADULT), '');
});
