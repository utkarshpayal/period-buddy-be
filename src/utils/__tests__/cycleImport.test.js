import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeImportedLog, prepareImport, sanitizeImportedLog } from '../cycleImport.js';

const TODAY = '2026-10-29';

test('sanitizeImportedLog keeps known fields and values only', () => {
  const log = sanitizeImportedLog(
    {
      dateKey: '2026-10-01',
      flow: 'heavy',
      moods: ['happy', 'ecstatic', 'moodSwings'],
      symptoms: ['cramps', '', 42, 'x'.repeat(61), 'cramps'],
      digestions: ['bloated'],
      temperature: 99,
      weight: 60,
      note: 'Felt fine',
      rewardPoints: 999,
      userId: 'someone-else',
    },
    TODAY,
  );
  assert.deepEqual(log, {
    dateKey: '2026-10-01',
    flow: 'heavy',
    mood: 'happy',
    moods: ['happy', 'moodSwings'],
    symptoms: ['cramps'],
    weight: 60,
    digestion: 'bloated',
    digestions: ['bloated'],
    note: 'Felt fine',
  });
});

test('sanitizeImportedLog drops bad dates, future days and empty days', () => {
  assert.equal(sanitizeImportedLog({ dateKey: '2026-13-40', flow: 'light' }, TODAY), null);
  assert.equal(sanitizeImportedLog({ dateKey: '2026/10/01', flow: 'light' }, TODAY), null);
  assert.equal(sanitizeImportedLog({ dateKey: '2026-10-30', flow: 'light' }, TODAY), null);
  assert.equal(sanitizeImportedLog({ dateKey: '2026-10-01', flow: 'none' }, TODAY), null);
  assert.equal(sanitizeImportedLog({ dateKey: '2026-10-01', mood: 'ecstatic' }, TODAY), null);
  assert.ok(sanitizeImportedLog({ dateKey: TODAY, flow: 'light' }, TODAY));
});

test('mergeImportedLog never overwrites what was logged in Nura', () => {
  const existing = {
    flow: 'heavy',
    mood: 'sad',
    moods: ['sad'],
    symptoms: ['headache'],
    weight: 55,
  };
  const set = mergeImportedLog(existing, {
    dateKey: '2026-10-01',
    flow: 'light',
    mood: 'happy',
    moods: ['happy'],
    symptoms: ['headache', 'cramps'],
    weight: 60,
    energy: 'low',
    isIntimate: true,
  });
  assert.deepEqual(set, {
    energy: 'low',
    moods: ['sad', 'happy'],
    symptoms: ['headache', 'cramps'],
    isIntimate: true,
  });
});

test('mergeImportedLog fills a "none" flow and returns null when nothing is new', () => {
  assert.deepEqual(mergeImportedLog({ flow: 'none' }, { dateKey: 'd', flow: 'medium' }), {
    flow: 'medium',
  });
  assert.equal(
    mergeImportedLog(
      { flow: 'light', symptoms: ['cramps'] },
      { dateKey: 'd', flow: 'heavy', symptoms: ['cramps'] },
    ),
    null,
  );
});

test('prepareImport folds repeated dates, sorts, and counts what it dropped', () => {
  const { logs, invalid } = prepareImport(
    [
      { dateKey: '2026-10-02', symptoms: ['cramps'] },
      { dateKey: '2026-10-01', flow: 'light' },
      { dateKey: '2026-10-02', flow: 'medium', symptoms: ['headache'] },
      { dateKey: '2027-01-01', flow: 'light' },
      null,
    ],
    TODAY,
  );
  assert.equal(invalid, 2);
  assert.deepEqual(logs, [
    { dateKey: '2026-10-01', flow: 'light' },
    { dateKey: '2026-10-02', symptoms: ['cramps', 'headache'], flow: 'medium' },
  ]);
});

test('notes and water come across, and a note never replaces one logged in Nura', () => {
  const log = sanitizeImportedLog(
    { dateKey: '2026-10-01', waterIntake: 2000, note: `  ${'a'.repeat(1200)}` },
    TODAY,
  );
  assert.equal(log.waterIntake, 2000);
  assert.equal(log.note.length, 1000);
  assert.equal(sanitizeImportedLog({ dateKey: '2026-10-01', waterIntake: 50000 }, TODAY), null);

  const incoming = { dateKey: '2026-10-01', note: 'From Clue: PMS: Yes' };
  assert.deepEqual(mergeImportedLog({ note: '' }, incoming), { note: 'From Clue: PMS: Yes' });
  assert.deepEqual(mergeImportedLog({ note: 'Felt fine' }, incoming), {
    note: 'Felt fine\nFrom Clue: PMS: Yes',
  });
  assert.equal(mergeImportedLog({ note: 'Felt fine\nFrom Clue: PMS: Yes' }, incoming), null);
});
