import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RX_LIMITS,
  cleanRx,
  medicineLine,
  parseDoseSchedule,
  rxToText,
} from '../prescriptionRx.js';

test('trims everything and drops empty medicine rows', () => {
  const { rx, error } = cleanRx({
    complaints: '  Cramps  ',
    medicines: [
      {
        name: ' Tab. Mefenamic acid 500 mg ',
        dose: '1 tablet',
        frequency: '1-0-1',
        timing: 'After food',
        duration: '3 days',
      },
      { name: '', dose: '', frequency: '' },
    ],
  });
  assert.equal(error, undefined);
  assert.equal(rx.complaints, 'Cramps');
  assert.equal(rx.medicines.length, 1);
  assert.equal(rx.medicines[0].name, 'Tab. Mefenamic acid 500 mg');
  assert.equal(rx.medicines[0].notes, '');
});

test('refuses a blank prescription, a nameless medicine and overlong fields', () => {
  assert.match(cleanRx({ complaints: 'x', medicines: [] }).error, /at least one medicine/);
  assert.match(
    cleanRx({ medicines: [{ name: '', dose: '1 tab' }] }).error,
    /Medicine 1 needs a name/,
  );
  assert.match(cleanRx({ advice: 'a'.repeat(RX_LIMITS.advice + 1) }).error, /Advice must be/);
  assert.match(cleanRx({ advice: 'ok', medicines: 'nope' }).error, /must be a list/);
  assert.match(cleanRx(null).error, /missing/);
  const many = Array.from({ length: RX_LIMITS.medicines + 1 }, (_, i) => ({ name: `Med ${i}` }));
  assert.match(cleanRx({ medicines: many }).error, /up to 20/);
});

test('advice or investigations alone are enough', () => {
  assert.ok(cleanRx({ advice: 'Rest and fluids' }).rx);
  assert.ok(cleanRx({ investigations: 'CBC' }).rx);
});

test('text form lists every section in order', () => {
  const { rx } = cleanRx({
    complaints: 'Cramps',
    diagnosis: 'Dysmenorrhoea',
    medicines: [
      {
        name: 'Tab. Mefenamic acid 500 mg',
        dose: '1 tablet',
        frequency: '1-0-1',
        timing: 'After food',
        duration: '3 days',
        notes: 'Only when in pain',
      },
    ],
    advice: 'Warm compress',
    followUp: 'If not better in a week',
  });
  assert.equal(
    rxToText(rx),
    [
      'Complaints: Cramps',
      'Diagnosis: Dysmenorrhoea',
      'Medicines:\n1. TAB. MEFENAMIC ACID 500 MG — 1 tablet · 1-0-1 · After food · 3 days (Only when in pain)',
      'Advice: Warm compress',
      'Follow-up: If not better in a week',
    ].join('\n\n'),
  );
  assert.equal(medicineLine({ name: 'Syp. X' }), 'SYP. X');
});

test('reads 1-0-1 style schedules, nothing else', () => {
  assert.deepEqual(parseDoseSchedule('1-0-1'), ['1', '0', '1']);
  assert.deepEqual(parseDoseSchedule(' 1 - 1 - 1 '), ['1', '1', '1']);
  assert.deepEqual(parseDoseSchedule('½-0-½'), ['½', '0', '½']);
  assert.equal(parseDoseSchedule('Once a week'), null);
  assert.equal(parseDoseSchedule(''), null);
});
