import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POINTS_PER_TREE,
  buildTaskDays,
  computeForestGrowth,
  hasCycleEntry,
  shiftDateKey,
} from '../forestGrowth.js';

const TODAY = '2026-09-28';

const daysBack = (n) => Array.from({ length: n }, (_, i) => shiftDateKey(TODAY, -i));

test('a new user starts as a seed with nothing done', () => {
  const g = computeForestGrowth(buildTaskDays({}), TODAY);
  assert.equal(g.stage, 'seed');
  assert.equal(g.points, 0);
  assert.equal(g.vitality, 'new');
  assert.equal(g.daysSinceActive, null);
  assert.deepEqual(
    g.today.tasks.map((t) => t.done),
    [false, false, false],
  );
  assert.equal(g.week.length, 7);
  assert.equal(g.week[6].dateKey, TODAY);
});

test('each task on each day is one point, capped at three a day', () => {
  const g = computeForestGrowth(
    buildTaskDays({ logDates: [TODAY], habitDates: [TODAY, TODAY], waterDates: [TODAY] }),
    TODAY,
  );
  assert.equal(g.points, 3);
  assert.equal(g.stage, 'sprout');
  assert.equal(g.today.done, 3);
  assert.equal(g.vitality, 'thriving');
  assert.equal(g.vitalityLevel, 100);
});

test('stage progress and points to the next stage', () => {
  const g = computeForestGrowth(buildTaskDays({ waterDates: daysBack(5) }), TODAY);
  assert.equal(g.points, 5);
  assert.equal(g.stage, 'sprout');
  assert.equal(g.nextStage, 'seedling');
  assert.equal(g.pointsToNextStage, 3);
  assert.equal(g.stageProgress, 0.4);
});

test('a full tree joins the forest and a new seed starts', () => {
  const dates = daysBack(21); // 21 days x 3 tasks = 63 points
  const g = computeForestGrowth(
    buildTaskDays({ logDates: dates, habitDates: dates, waterDates: dates }),
    TODAY,
  );
  assert.equal(g.treesGrown, 1);
  assert.equal(g.points, 63 - POINTS_PER_TREE);
  assert.equal(g.stage, 'sprout');
  // 20th day (oldest first) reaches 60 points.
  assert.equal(g.grownTrees[0].grownOn, shiftDateKey(TODAY, -1));
});

test('vitality fades with days since the last task, growth is kept', () => {
  const at = (n) =>
    computeForestGrowth(buildTaskDays({ waterDates: [shiftDateKey(TODAY, -n)] }), TODAY);
  assert.equal(at(1).vitality, 'thirsty');
  assert.equal(at(3).vitality, 'wilting');
  assert.equal(at(6).vitality, 'dry');
  assert.equal(at(6).points, 1);
});

test('future-dated logs never grow the tree early', () => {
  const g = computeForestGrowth(buildTaskDays({ waterDates: [shiftDateKey(TODAY, 1)] }), TODAY);
  assert.equal(g.points, 0);
  assert.equal(g.vitality, 'new');
});

test('hasCycleEntry ignores empty upserts', () => {
  assert.equal(
    hasCycleEntry({ _id: 'x', dateKey: TODAY, flow: 'none', symptoms: [], note: '' }),
    false,
  );
  assert.equal(hasCycleEntry({ dateKey: TODAY, mood: 'happy' }), true);
  assert.equal(hasCycleEntry({ dateKey: TODAY, symptoms: ['cramps'] }), true);
  assert.equal(hasCycleEntry(null), false);
});
