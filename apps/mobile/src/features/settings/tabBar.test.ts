import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_TAB_BAR, hiddenTabs, isDefaultTabBar, moveTab, normalizeTabBar, parseTabBar, setTabHidden, visibleTabs,
} from './tabBar.ts';

test('nothing stored, or something unreadable, gives the default bar', () => {
  for (const raw of [null, undefined, '', 'not json', '42', 'null', '"inbox"', '[]']) {
    assert.deepEqual(parseTabBar(raw), DEFAULT_TAB_BAR, String(raw));
  }
  assert.deepEqual(visibleTabs(DEFAULT_TAB_BAR), ['index', 'inbox', 'upcoming', 'habits', 'focus']);
  assert.equal(isDefaultTabBar(DEFAULT_TAB_BAR), true);
});

test('a stored config round-trips', () => {
  const config = { order: ['focus', 'habits', 'inbox', 'upcoming'], hidden: ['inbox'] };
  assert.deepEqual(parseTabBar(JSON.stringify(config)), config);
});

test('unknown ids and duplicates are dropped, missing tabs are appended in default order', () => {
  const parsed = parseTabBar(JSON.stringify({ order: ['habits', 'calendar', 'habits', 7, 'index'], hidden: ['focus', 'focus', 'calendar', 'index'] }));
  assert.deepEqual(parsed, { order: ['habits', 'inbox', 'upcoming', 'focus'], hidden: ['focus'] });
  // 오늘 can never be hidden or moved.
  assert.deepEqual(visibleTabs(parsed), ['index', 'habits', 'inbox', 'upcoming']);
});

test('fields of the wrong type are ignored', () => {
  assert.deepEqual(normalizeTabBar({ order: 'focus', hidden: { focus: true } }), DEFAULT_TAB_BAR);
  assert.deepEqual(normalizeTabBar({ hidden: ['upcoming'] }), { order: ['inbox', 'upcoming', 'habits', 'focus'], hidden: ['upcoming'] });
});

test('moving a tab swaps it with its neighbour and stops at the ends', () => {
  const moved = moveTab(DEFAULT_TAB_BAR, 'habits', -1);
  assert.deepEqual(moved.order, ['inbox', 'habits', 'upcoming', 'focus']);
  assert.deepEqual(moveTab(moved, 'habits', 1).order, DEFAULT_TAB_BAR.order);
  assert.equal(moveTab(DEFAULT_TAB_BAR, 'inbox', -1), DEFAULT_TAB_BAR);
  assert.equal(moveTab(DEFAULT_TAB_BAR, 'focus', 1), DEFAULT_TAB_BAR);
  assert.equal(isDefaultTabBar(moved), false);
});

test('hiding and showing tabs', () => {
  const hidden = setTabHidden(setTabHidden(DEFAULT_TAB_BAR, 'focus', true), 'inbox', true);
  assert.deepEqual(visibleTabs(hidden), ['index', 'upcoming', 'habits']);
  assert.deepEqual(hiddenTabs(hidden), ['inbox', 'focus']);
  assert.equal(setTabHidden(hidden, 'focus', true), hidden);
  const shown = setTabHidden(hidden, 'inbox', false);
  assert.deepEqual(visibleTabs(shown), ['index', 'inbox', 'upcoming', 'habits']);
  // A hidden tab keeps its place in the order, so showing it again puts it back where it was.
  assert.deepEqual(shown.order, DEFAULT_TAB_BAR.order);
});

test('every movable tab can be hidden, leaving 오늘 alone', () => {
  let config = DEFAULT_TAB_BAR;
  for (const tab of DEFAULT_TAB_BAR.order) config = setTabHidden(config, tab, true);
  assert.deepEqual(visibleTabs(config), ['index']);
});
