import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_NOTIFICATION_KEYS,
  MAX_PER_DAY,
  planNotifications,
  prefsUpdate,
  resolvePrefs,
  usualPeriodSymptom,
} from '../autoNotifications.js';
import { computeCyclePredictions } from '../cycle.js';
import { dateFromDateKey } from '../apiHelpers.js';

const allOn = Object.fromEntries(AUTO_NOTIFICATION_KEYS.map((k) => [k, true]));

// A 28-day cycle with a 5-day period that started on 1 Oct.
const settings = { lastPeriodStartDate: new Date('2026-10-01'), cycleLength: 28, periodLength: 5 };
const predict = (todayKey, logs = []) =>
  computeCyclePredictions(settings, logs, { today: dateFromDateKey(todayKey) });
const plan = (todayKey, extra = {}) =>
  planNotifications({
    predictions: predict(todayKey, extra.logs),
    todayKey,
    prefs: allOn,
    ...extra,
  });
const keys = (items) => items.map((i) => i.key);

test('resolvePrefs reads the old fields and the defaults', () => {
  assert.equal(resolvePrefs({}).period_upcoming, true);
  assert.equal(resolvePrefs({}).fertile_window, false);
  assert.equal(resolvePrefs({ fertilityReminder: true }).fertile_window, true);
  // The daily reminder used to follow remindersEnabled.
  assert.equal(resolvePrefs({ remindersEnabled: false }).daily_log, false);
  assert.equal(
    resolvePrefs({ remindersEnabled: false, notificationPrefs: { daily_log: true } }).daily_log,
    true,
  );
  assert.equal(resolvePrefs({ notificationPrefs: { phase_tips: false } }).phase_tips, false);
});

test('prefsUpdate writes the two old categories to their old fields', () => {
  assert.deepEqual(
    prefsUpdate({ period_upcoming: false, fertile_window: true, phase_tips: false, nope: true }),
    {
      remindersEnabled: false,
      ovulationReminder: true,
      fertilityReminder: true,
      'notificationPrefs.phase_tips': false,
    },
  );
});

test('period coming up, due today and phase tips land on their days', () => {
  assert.deepEqual(keys(plan('2026-10-27')), ['period_upcoming']); // 2 days before 29 Oct
  assert.deepEqual(keys(plan('2026-10-29')), ['period_start']);
  // Day 6: the period is over, a new phase starts.
  const day6 = plan('2026-10-06');
  assert.deepEqual(keys(day6), ['phase_tips']);
  assert.equal(day6[0].data.route, '/(app)/era');
});

test('fertile window covers the ovulation phase tip', () => {
  // Ovulation 15 Oct, window opens 10 Oct.
  assert.deepEqual(keys(plan('2026-10-10')), ['fertile_window']);
  assert.deepEqual(keys(plan('2026-10-15')), ['fertile_window']);
  const tipOnly = plan('2026-10-10', { prefs: { ...allOn, fertile_window: false } });
  assert.deepEqual(keys(tipOnly), ['phase_tips']);
});

test('late period at 3 and 7 days, and pregnancy mode pauses it', () => {
  const logs = [{ dateKey: '2026-10-28' }]; // still logging, so it's held as late
  assert.deepEqual(keys(plan('2026-11-01', { logs })), ['period_late']);
  assert.deepEqual(keys(plan('2026-11-05', { logs })), ['period_late']);
  assert.deepEqual(keys(plan('2026-11-02', { logs })), ['daily_log']);
  assert.deepEqual(keys(plan('2026-11-01', { logs, pregnancyMode: true })), ['daily_log']);
});

test('guards, admin switches and the daily cap', () => {
  assert.deepEqual(keys(plan('2026-10-27', { guards: { period_upcoming: '2026-10-29' } })), [
    'daily_log',
  ]);
  assert.deepEqual(keys(plan('2026-10-27', { disabled: new Set(['period_upcoming']) })), [
    'daily_log',
  ]);
  assert.deepEqual(keys(plan('2026-10-27', { sentToday: MAX_PER_DAY })), []);
  // Nothing due and already logged today: nothing at all.
  assert.deepEqual(keys(plan('2026-10-20', { logs: [{ dateKey: '2026-10-20' }] })), []);
});

test('symptom heads-up only from the person’s own history', () => {
  const logs = [];
  for (const start of ['2026-08-06', '2026-09-03', '2026-10-01']) {
    const d = dateFromDateKey(start);
    for (let i = 0; i < 4; i++) {
      const k = new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10);
      logs.push({ dateKey: k, flow: 'medium', symptoms: i === 0 ? ['cramps'] : [] });
    }
  }
  assert.deepEqual(usualPeriodSymptom(logs), { key: 'cramps', label: 'Cramps', cycles: 3, of: 3 });
  assert.equal(usualPeriodSymptom(logs.slice(0, 4)), null);
  const day = plan('2026-10-28', { logs });
  assert.ok(keys(day).includes('symptom_heads_up'));
  assert.match(day.find((i) => i.key === 'symptom_heads_up').title, /^Cramps/);
});
