import test from 'node:test';
import assert from 'node:assert/strict';
import { wellbeingDecks } from '../../constants/wellbeingDecks.js';

test('spark cards are unique, non-empty strings (older apps read them as strings)', () => {
  assert.ok(wellbeingDecks.spark.length >= 50);
  for (const card of wellbeingDecks.spark) assert.equal(typeof card, 'string');
  assert.equal(new Set(wellbeingDecks.spark).size, wellbeingDecks.spark.length);
});

test('comfort cards all have a name, focus and tip, with unique names', () => {
  assert.ok(wellbeingDecks.positions.length >= 25);
  for (const card of wellbeingDecks.positions) {
    assert.ok(card.name?.trim() && card.focus?.trim() && card.tip?.trim(), JSON.stringify(card));
  }
  const names = wellbeingDecks.positions.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
});
