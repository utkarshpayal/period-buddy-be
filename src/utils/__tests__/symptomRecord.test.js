import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BODY_REGIONS,
  MAX_RECORDS_PER_USER,
  NOTE_MAX,
  defaultSide,
  parseStatusFilter,
  parseSymptomRecordInput,
  serializeSymptomRecord,
} from '../symptomRecord.js';

const TODAY = '2026-10-26';
const base = {
  symptomKey: 'cramps',
  regionId: 'lower_abdomen',
  severity: 6,
  onsetDate: '2026-10-24',
};
const parse = (body, opts = {}) => parseSymptomRecordInput(body, { todayKey: TODAY, ...opts });

test('a minimal create gets defaults', () => {
  const { value, error } = parse(base);
  assert.equal(error, undefined);
  assert.deepEqual(value, { ...base, side: 'both', status: 'active', resolvedDate: null });
});

test('single-sided regions default to center', () => {
  assert.equal(defaultSide('head'), 'center');
  assert.equal(defaultSide('knee'), 'both');
  assert.equal(parse({ ...base, regionId: 'head' }).value.side, 'center');
});

test('every region allows at least one side, and paired ones never center', () => {
  for (const [id, sides] of Object.entries(BODY_REGIONS)) {
    assert.ok(sides.length > 0, id);
    if (sides.includes('left')) assert.ok(sides.includes('right') && sides.includes('both'), id);
  }
  assert.match(parse({ ...base, regionId: 'knee', side: 'center' }).error, /side/);
});

test('rejects bad keys, regions, severities and dates', () => {
  assert.match(parse({ ...base, symptomKey: 'Cramps!' }).error, /symptomKey/);
  assert.match(parse({ ...base, symptomKey: 'a'.repeat(41) }).error, /symptomKey/);
  assert.match(parse({ ...base, regionId: 'elbow' }).error, /region/);
  assert.match(parse({ ...base, severity: 0 }).error, /severity/);
  assert.match(parse({ ...base, severity: 11 }).error, /severity/);
  assert.match(parse({ ...base, severity: 4.5 }).error, /severity/);
  assert.match(parse({ ...base, onsetDate: '24/10/2026' }).error, /onsetDate/);
  assert.match(parse({ ...base, onsetDate: '2026-10-27' }).error, /future/);
  assert.match(parse({ ...base, frequency: 'hourly' }).error, /frequency/);
  assert.match(parse([]).error, /Invalid/);
});

test('`other` needs a name; text is trimmed and capped', () => {
  assert.match(parse({ ...base, symptomKey: 'other' }).error, /Name/);
  const { value } = parse({
    ...base,
    symptomKey: 'other',
    customName: '  Jaw\npain ',
    note: 'x'.repeat(NOTE_MAX + 5),
  });
  assert.equal(value.customName, 'Jaw pain');
  assert.equal(value.note.length, NOTE_MAX);
});

test('associated symptoms are deduped, exclude the symptom itself, and are capped', () => {
  const { value } = parse({
    ...base,
    associatedSymptoms: ['nausea', 'nausea', 'cramps', 'backache'],
  });
  assert.deepEqual(value.associatedSymptoms, ['nausea', 'backache']);
  assert.match(
    parse({ ...base, associatedSymptoms: Array.from({ length: 11 }, (_, i) => `s${i}`) }).error,
    /Up to/,
  );
});

test('resolving stamps today unless a date is given, and re-opening clears it', () => {
  const current = { ...base, side: 'both', status: 'active', resolvedDate: null };
  assert.deepEqual(parse({ status: 'resolved' }, { partial: true, current }).value, {
    status: 'resolved',
    resolvedDate: TODAY,
  });
  assert.equal(
    parse({ status: 'resolved', resolvedDate: '2026-10-25' }, { partial: true, current }).value
      .resolvedDate,
    '2026-10-25',
  );
  assert.match(
    parse({ status: 'resolved', resolvedDate: '2026-10-01' }, { partial: true, current }).error,
    /before/,
  );
  const resolved = { ...current, status: 'resolved', resolvedDate: '2026-10-25' };
  assert.equal(
    parse({ status: 'active' }, { partial: true, current: resolved }).value.resolvedDate,
    null,
  );
});

test('an update checks the side against the merged region', () => {
  const current = { ...base, regionId: 'head', side: 'center', status: 'active' };
  // Moving to a paired region with no side given picks `both`.
  assert.equal(parse({ regionId: 'knee' }, { partial: true, current }).value.side, 'both');
  assert.match(parse({ side: 'left' }, { partial: true, current }).error, /side/);
  assert.match(parse({}, { partial: true, current }).error, /Nothing/);
});

test('status filter and serializer', () => {
  assert.equal(parseStatusFilter('active'), 'active');
  assert.equal(parseStatusFilter('all'), null);
  assert.equal(parseStatusFilter({ $ne: 1 }), null);
  const out = serializeSymptomRecord({
    _id: 'abc',
    userId: 'u1',
    ...base,
    side: 'left',
    status: 'active',
  });
  assert.equal(out.id, 'abc');
  assert.equal('userId' in out, false);
  assert.deepEqual(out.associatedSymptoms, []);
  assert.ok(MAX_RECORDS_PER_USER >= 100);
});
