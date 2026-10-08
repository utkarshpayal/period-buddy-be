import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHORTCUTS, describeHomeLayout, parseHomeLayout } from '../homeLayout.js';

test('a valid layout is kept, duplicates dropped', () => {
  const { layout, error } = parseHomeLayout({
    order: ['insights', 'statPills', 'insights'],
    hidden: ['weekStrip'],
    shortcuts: ['forest', 'link:abc123'],
  });
  assert.equal(error, undefined);
  assert.deepEqual(layout, {
    order: ['insights', 'statPills'],
    hidden: ['weekStrip'],
    shortcuts: ['forest', 'link:abc123'],
    shortcutStyles: {},
    blocks: {},
  });
});

test('missing or null shortcuts mean the app default, [] means none', () => {
  assert.equal(parseHomeLayout({}).layout.shortcuts, null);
  assert.equal(parseHomeLayout({ shortcuts: null }).layout.shortcuts, null);
  assert.deepEqual(parseHomeLayout({ shortcuts: [] }).layout.shortcuts, []);
});

test('bad shapes are refused', () => {
  for (const body of [
    null,
    [],
    'x',
    { order: 'x' },
    { hidden: [1] },
    { shortcuts: ['$where'] },
    { order: ['a'.repeat(65)] },
  ]) {
    assert.ok(parseHomeLayout(body).error, JSON.stringify(body));
  }
  const tooMany = Array.from({ length: MAX_SHORTCUTS + 1 }, (_, i) => `f${i}`);
  assert.ok(parseHomeLayout({ shortcuts: tooMany }).error);
});

test('describe fills in the default', () => {
  assert.deepEqual(describeHomeLayout({}), {
    order: [],
    hidden: [],
    shortcuts: null,
    shortcutStyles: {},
    blocks: {},
    updatedAt: null,
  });
  const at = new Date();
  assert.deepEqual(
    describeHomeLayout({ homeLayout: { order: ['a'], hidden: [], shortcuts: [], updatedAt: at } }),
    {
      order: ['a'],
      hidden: [],
      shortcuts: [],
      shortcutStyles: {},
      blocks: {},
      updatedAt: at,
    },
  );
});

test('shortcut styles: look and colour checked, colour optional', () => {
  const { layout } = parseHomeLayout({
    shortcutStyles: { forest: { look: 'card', color: 'mint' }, nuraAi: { look: 'tile' } },
  });
  assert.deepEqual(layout.shortcutStyles, {
    forest: { look: 'card', color: 'mint', label: null, icon: null },
    nuraAi: { look: 'tile', color: null, label: null, icon: null },
  });
  for (const shortcutStyles of [
    [],
    'x',
    { forest: { look: 'huge' } },
    { forest: { look: 'icon', color: '#fff' } },
    { 'a.b': { look: 'icon' } },
  ]) {
    assert.ok(parseHomeLayout({ shortcutStyles }).error, JSON.stringify(shortcutStyles));
  }
});

test('shortcut names and icons, block headings and items', () => {
  const { layout } = parseHomeLayout({
    shortcutStyles: { forest: { look: 'icon', label: '  My tree ', icon: 'leaf-outline' } },
    blocks: {
      insights: { title: 'My stats' },
      statPills: { items: ['streak', 'cycleDay', 'streak'] },
    },
  });
  assert.deepEqual(layout.shortcutStyles.forest, {
    look: 'icon',
    color: null,
    label: 'My tree',
    icon: 'leaf-outline',
  });
  assert.deepEqual(layout.blocks, {
    insights: { title: 'My stats', items: null },
    statPills: { title: null, items: ['streak', 'cycleDay'] },
  });
  for (const body of [
    { shortcutStyles: { forest: { look: 'icon', label: 'x'.repeat(25) } } },
    { shortcutStyles: { forest: { look: 'icon', label: 'a\nb' } } },
    { shortcutStyles: { forest: { look: 'icon', icon: '<svg>' } } },
    { blocks: [] },
    { blocks: { insights: { title: 5 } } },
    { blocks: { insights: { items: 'x' } } },
  ]) {
    assert.ok(parseHomeLayout(body).error, JSON.stringify(body));
  }
});
