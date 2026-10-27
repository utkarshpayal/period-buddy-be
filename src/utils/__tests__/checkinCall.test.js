import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALL_LIMITS,
  buildCheckinBackfill,
  checkManualCallLimit,
  checkinDateKey,
  classifyCallOutcome,
  describeCycleContext,
  describePeriodTiming,
  inFirstCallWindow,
  localClock,
  planRetry,
  planScheduledAttempt,
  resolveCallDay,
  summarizeRecentLog,
  weekdayOf,
} from '../checkinCall.js';

test('call date is IST, not server UTC', () => {
  // 20:00 UTC on the 1st is 01:30 IST on the 2nd.
  assert.equal(checkinDateKey(new Date('2026-09-01T20:00:00Z')), '2026-09-02');
  assert.equal(checkinDateKey(new Date('2026-09-01T10:00:00Z')), '2026-09-01');
});

test('weekday of a date key', () => {
  assert.equal(weekdayOf('2026-09-26'), 'Saturday');
});

test('period timing is spoken relative to the call date', () => {
  assert.equal(describePeriodTiming('2026-09-26', '2026-09-26'), 'expected today');
  assert.equal(describePeriodTiming('2026-09-27', '2026-09-26'), 'expected tomorrow');
  assert.equal(describePeriodTiming('2026-09-30', '2026-09-26'), 'expected in 4 days');
  assert.equal(
    describePeriodTiming('2026-09-25', '2026-09-26'),
    'was expected yesterday, about 1 day late',
  );
  assert.equal(
    describePeriodTiming('2026-09-20', '2026-09-26'),
    'was expected 6 days ago, about 6 days late',
  );
  assert.equal(describePeriodTiming(undefined, '2026-09-26'), '');
});

test('backfill keeps only discussed cycle fields when there is no log yet', () => {
  const payload = buildCheckinBackfill(
    {
      flow: 'light',
      mood: 'not_discussed',
      sleepHours: '7',
      symptoms: 'cramps, bloating',
      medication: 'none',
      stressLevel: '',
      call_summary: 'User has mild cramps',
      user_auth_token: 'secret',
    },
    null,
  );
  assert.deepEqual(payload, { flow: 'light', sleepHours: '7', symptoms: 'cramps, bloating' });
});

test("flow 'none' is a real value, not a placeholder", () => {
  assert.deepEqual(buildCheckinBackfill({ flow: 'none' }, null), { flow: 'none' });
});

test('backfill never overwrites what the agent or app already saved', () => {
  const existing = { flow: 'medium', mood: 'calm', symptoms: ['cramps'], note: '' };
  assert.deepEqual(buildCheckinBackfill({ flow: 'heavy', mood: 'sad' }, existing), {});
  assert.deepEqual(buildCheckinBackfill({ flow: 'heavy', sleepHours: '6' }, existing), {
    sleepHours: '6',
    symptoms: ['cramps'],
  });
});

test('backfill ignores a missing or malformed payload', () => {
  assert.deepEqual(buildCheckinBackfill(undefined, null), {});
  assert.deepEqual(buildCheckinBackfill('oops', null), {});
});

/* ── scheduling ── */

const IST = -330;
// 2026-09-26 20:00 IST
const at = (hhmm, dateKey = '2026-09-26') => new Date(Date.parse(`${dateKey}T${hhmm}:00+05:30`));
const clockAt = (hhmm, dateKey) => localClock(at(hhmm, dateKey), IST);
const predictionsFor = (currentStart, nextStart) => ({
  currentPeriodStartDateISO: `${currentStart}T00:00:00.000Z`,
  nextPeriodDateISO: `${nextStart}T00:00:00.000Z`,
});

test('local clock resolves IST date and minute', () => {
  assert.deepEqual(localClock(at('20:05'), IST), {
    dateKey: '2026-09-26',
    minutes: 20 * 60 + 5,
    tzOffset: IST,
  });
  // Missing offset defaults to IST.
  assert.equal(localClock(at('00:30'), undefined).dateKey, '2026-09-26');
});

test('period_daily calls every day of the period and no other', () => {
  const p = predictionsFor('2026-09-24', '2026-10-22');
  const day = (dateKey) =>
    resolveCallDay({ mode: 'period_daily', periodLength: 5, predictions: p, dateKey });
  assert.deepEqual(day('2026-09-24'), { cycleKey: '2026-09-24', periodDay: 1 });
  assert.deepEqual(day('2026-09-28'), { cycleKey: '2026-09-24', periodDay: 5 });
  assert.equal(day('2026-09-29'), null);
  assert.equal(day('2026-09-23'), null);
});

test('once mode fires on period day and after, not only before (regression)', () => {
  // On the predicted start day, computeCyclePredictions reports it as the
  // current start and the next start a full cycle away.
  const onDay = predictionsFor('2026-09-26', '2026-10-24');
  assert.ok(
    resolveCallDay({ mode: 'once', dayOffset: 0, predictions: onDay, dateKey: '2026-09-26' }),
  );
  const twoAfter = predictionsFor('2026-09-24', '2026-10-22');
  assert.ok(
    resolveCallDay({ mode: 'once', dayOffset: 2, predictions: twoAfter, dateKey: '2026-09-26' }),
  );
  const twoBefore = predictionsFor('2026-08-30', '2026-09-28');
  assert.ok(
    resolveCallDay({ mode: 'once', dayOffset: -2, predictions: twoBefore, dateKey: '2026-09-26' }),
  );
  assert.equal(
    resolveCallDay({ mode: 'once', dayOffset: 1, predictions: twoBefore, dateKey: '2026-09-26' }),
    null,
  );
});

test('first call goes out at the chosen time, with a catch-up window', () => {
  const scheduledMinutes = 20 * 60;
  const plan = (hhmm) =>
    planScheduledAttempt({ calls: [], scheduledMinutes, now: at(hhmm), clock: clockAt(hhmm) });
  assert.equal(plan('19:59').reason, 'not_yet');
  assert.deepEqual(plan('20:00'), { due: true, attemptNumber: 1, source: 'scheduled' });
  // Missed the exact minute (restart): still placed.
  assert.equal(plan('21:30').due, true);
  assert.equal(plan('22:00').reason, 'window_passed');
});

test('a day with an answered call is done, even a manual one', () => {
  const calls = [{ source: 'manual', outcome: 'completed', status: 'connected' }];
  const plan = planScheduledAttempt({
    calls,
    scheduledMinutes: 20 * 60,
    now: at('20:00'),
    clock: clockAt('20:00'),
  });
  assert.equal(plan.reason, 'done_today');
});

test('retries only at retryAt, and never past the daily cap', () => {
  const first = {
    attemptNumber: 1,
    status: 'no_answer',
    outcome: 'no_answer',
    createdAt: at('20:00'),
    retryAt: at('20:31'),
  };
  const plan = (hhmm, calls) =>
    planScheduledAttempt({ calls, scheduledMinutes: 20 * 60, now: at(hhmm), clock: clockAt(hhmm) });
  assert.equal(plan('20:20', [first]).reason, 'retry_pending');
  assert.deepEqual(plan('20:31', [first]), { due: true, attemptNumber: 2, source: 'retry' });

  const three = [1, 2, 3].map((n) => ({ ...first, attemptNumber: n }));
  assert.equal(plan('21:00', three).reason, 'max_attempts');
});

test('a call still ringing blocks another; a lost webhook becomes a retry', () => {
  const ringing = { attemptNumber: 1, status: 'requested', createdAt: at('20:00') };
  const plan = (hhmm) =>
    planScheduledAttempt({
      calls: [ringing],
      scheduledMinutes: 20 * 60,
      now: at(hhmm),
      clock: clockAt(hhmm),
    });
  assert.equal(plan('20:05').reason, 'in_flight');
  assert.equal(plan('20:30').reason, 'retry_pending');
  assert.equal(plan('20:45').due, true);
});

test('outcome classification decides what is retried', () => {
  assert.equal(classifyCallOutcome({ status: 'no_answer' }), 'no_answer');
  assert.equal(classifyCallOutcome({ status: 'busy' }), 'no_answer');
  assert.equal(classifyCallOutcome({ status: 'failed' }), 'failed');
  const connected = (disposition, durationSeconds = 120, logStatus) =>
    classifyCallOutcome({ status: 'connected', disposition, durationSeconds, logStatus });
  assert.equal(connected('completed'), 'completed');
  assert.equal(connected('partial'), 'completed');
  assert.equal(connected('callback_requested'), 'callback');
  assert.equal(connected('opted_out'), 'opted_out');
  assert.equal(connected('dropped_off', 8), 'no_answer');
  assert.equal(connected('dropped_off', 90, 'logged'), 'completed');
  assert.equal(connected('dropped_off', 90, 'not_logged'), 'dropped');
});

test('retry timing: no answer +30 min, callback at the asked time, never at night', () => {
  const plan = (outcome, hhmm, extra = {}) =>
    planRetry({
      outcome,
      source: 'scheduled',
      attemptNumber: 1,
      now: at(hhmm),
      clock: clockAt(hhmm),
      ...extra,
    });
  assert.deepEqual(plan('no_answer', '20:00'), at('20:30'));
  assert.deepEqual(plan('callback', '19:00', { callbackTime: '20:15' }), at('20:15'));
  // Callback asked with no time: +60 min.
  assert.deepEqual(plan('callback', '19:00'), at('20:00'));
  // Default retries stop at 21:30; an asked-for callback may go to 23:00.
  assert.equal(plan('no_answer', '21:10'), null);
  assert.deepEqual(plan('callback', '21:10', { callbackTime: '22:30' }), at('22:30'));
  assert.equal(plan('completed', '20:00'), null);
  assert.equal(plan('no_answer', '20:00', { source: 'manual' }), null);
  assert.equal(
    plan('no_answer', '20:00', { attemptNumber: CALL_LIMITS.maxAutoAttemptsPerDay }),
    null,
  );
});

test('call-now limits: in flight, cooldown and daily cap', () => {
  const now = at('20:00');
  assert.equal(checkManualCallLimit({ calls: [], now }), null);
  assert.equal(
    checkManualCallLimit({ calls: [{ status: 'requested', createdAt: at('19:55') }], now })
      .statusCode,
    409,
  );
  const recent = [{ source: 'manual', status: 'connected', createdAt: at('19:53') }];
  const cooldown = checkManualCallLimit({ calls: recent, now });
  assert.equal(cooldown.statusCode, 429);
  assert.equal(cooldown.retryAfterSeconds, 3 * 60);
  const three = ['10:00', '12:00', '14:00'].map((t) => ({
    source: 'manual',
    status: 'connected',
    createdAt: at(t),
  }));
  assert.match(checkManualCallLimit({ calls: three, now }).message, /all 3/);
});

test('cycle context and recent log lines', () => {
  assert.equal(
    describeCycleContext({
      predictions: { currentCycleDay: 2, currentPhase: 'period' },
      periodDay: 2,
      periodLength: 5,
    }),
    'Day 2 of the period, which usually lasts 5 days, cycle day 2.',
  );
  assert.equal(
    describeCycleContext({ predictions: { currentCycleDay: 14, currentPhase: 'ovulation' } }),
    'cycle day 14, ovulation window.',
  );
  assert.equal(
    summarizeRecentLog(
      { dateKey: '2026-09-25', flow: 'medium', symptoms: ['cramps'], mood: 'tired' },
      '2026-09-26',
    ),
    'Yesterday: medium flow; cramps; mood tired.',
  );
  assert.equal(summarizeRecentLog({ dateKey: '2026-09-01', flow: 'light' }, '2026-09-26'), '');
});

test('inFirstCallWindow matches planScheduledAttempt for a day with no automatic attempt', () => {
  const now = new Date('2026-03-02T12:00:00Z');
  for (const scheduledMinutes of [0, 9 * 60, 22 * 60 + 30, 23 * 60 + 59]) {
    for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
      const clock = { dateKey: '2026-03-02', minutes, tzOffset: -330 };
      const plan = planScheduledAttempt({ calls: [], scheduledMinutes, now, clock });
      assert.equal(inFirstCallWindow({ clock, scheduledMinutes }), plan.due);
    }
  }
  assert.equal(inFirstCallWindow({ clock: { minutes: 10 }, scheduledMinutes: null }), false);
});

test('agent variables are one clean, capped line', async () => {
  const { cleanAgentVariable } = await import('../checkinCall.js');
  assert.equal(cleanAgentVariable('Cramps\n\nand\tbloating  \u0007 ok'), 'Cramps and bloating ok');
  assert.equal(cleanAgentVariable(null), '');
  assert.equal(cleanAgentVariable('a'.repeat(900)).length, 500);
  assert.equal(cleanAgentVariable('word word', 5), 'word');
});

test('a failed call is explained by kind, never by the raw provider text', async () => {
  const { failureKindOf } = await import('../checkinCall.js');
  assert.equal(failureKindOf(null), null);
  assert.equal(failureKindOf('Check-in calling is not configured on the server'), 'not_configured');
  assert.equal(failureKindOf('Add a phone number to your account first'), 'no_phone');
  assert.equal(failureKindOf('(422) Invalid Parameter: [{"loc":["body"]}]'), 'provider');
});
