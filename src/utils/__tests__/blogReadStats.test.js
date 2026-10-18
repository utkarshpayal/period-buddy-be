import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReadReport, readIncrement, readStats, sessionCapSeconds } from '../blogReadStats.js';

test('session cap is 3x the article, between 10 and 60 minutes', () => {
  assert.equal(sessionCapSeconds(1), 600);
  assert.equal(sessionCapSeconds(5), 900);
  assert.equal(sessionCapSeconds(40), 3600);
  assert.equal(sessionCapSeconds(undefined), 600);
});

test('parses a report and rejects bad durations', () => {
  assert.deepEqual(parseReadReport({ durationSeconds: 42.4 }), {
    seconds: 42,
    continued: false,
    completed: false,
  });
  assert.deepEqual(parseReadReport({ durationSeconds: 3, continued: true, completed: true }), {
    seconds: 3,
    continued: true,
    completed: true,
  });
  assert.ok(parseReadReport({ durationSeconds: 'x' }).error);
  assert.ok(parseReadReport({ durationSeconds: -1 }).error);
});

test('a first read counts a view; bounces and empty continuations do not', () => {
  assert.deepEqual(readIncrement({ seconds: 90, continued: false, completed: false }, 4, null), {
    blog: { totalReadSeconds: 90, readSessionCount: 1, viewCount: 1 },
    reader: { totalReadSeconds: 90, sessionCount: 1 },
    completed: false,
  });
  assert.equal(readIncrement({ seconds: 3, continued: false, completed: false }, 4), null);
  assert.equal(readIncrement({ seconds: 0, continued: true, completed: false }, 4), null);
});

test('the same reader again adds time and a visit, not a view', () => {
  assert.deepEqual(
    readIncrement({ seconds: 60, continued: false, completed: false }, 4, { completed: false }),
    {
      blog: { totalReadSeconds: 60, readSessionCount: 1 },
      reader: { totalReadSeconds: 60, sessionCount: 1 },
      completed: false,
    },
  );
  // Completion counts once per reader.
  assert.equal(
    readIncrement({ seconds: 30, continued: true, completed: true }, 4, { completed: false }).blog
      .completedReadCount,
    1,
  );
  assert.equal(
    readIncrement({ seconds: 30, continued: true, completed: true }, 4, { completed: true }).blog
      .completedReadCount,
    undefined,
  );
});

test('long sessions are capped', () => {
  assert.equal(
    readIncrement({ seconds: 5000, continued: false, completed: false }, 2).blog.totalReadSeconds,
    600,
  );
});

test('stats average per visit and give the share of readers who finished', () => {
  assert.deepEqual(readStats({}), {
    averageReadSeconds: null,
    averageReadMinutes: null,
    completionRate: null,
    readSessionCount: 0,
    readerCount: 0,
  });
  assert.deepEqual(
    readStats({ totalReadSeconds: 500, readSessionCount: 4, completedReadCount: 1, viewCount: 2 }),
    {
      averageReadSeconds: 125,
      averageReadMinutes: 2,
      completionRate: 0.5,
      readSessionCount: 4,
      readerCount: 2,
    },
  );
});
