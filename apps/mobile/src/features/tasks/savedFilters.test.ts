import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addSavedFilter,
  DEFAULT_SAVED_FILTERS,
  parseSavedFilters,
  pinnedSavedFilters,
  removeSavedFilter,
  renameSavedFilter,
  togglePinSavedFilter,
} from './savedFiltersLogic.ts';

test('missing or invalid storage returns starter presets, while empty array stays empty', () => {
  for (const raw of [null, undefined, '', 'not json', '{}', '42']) {
    assert.deepEqual(parseSavedFilters(raw), DEFAULT_SAVED_FILTERS, String(raw));
  }
  assert.deepEqual(parseSavedFilters('[]'), []);
});

test('parseSavedFilters drops malformed or duplicate entries and normalizes fields', () => {
  const raw = JSON.stringify([
    { id: 'f1', name: '  업무 P1 ', icon: ' ', query: ' #업무 ', quickFilters: ['p1', 'p1', ''], includeCompleted: true, pinned: true },
    { id: 'f1', name: 'duplicate' },
    { id: '', name: 'missing id' },
    { id: 'f2', name: '   ' },
    null,
  ]);
  assert.deepEqual(parseSavedFilters(raw), [
    {
      id: 'f1',
      name: '업무 P1',
      icon: 'filter',
      query: '#업무',
      quickFilters: ['p1'],
      includeCompleted: true,
      pinned: true,
    },
  ]);
});

test('add, togglePin, rename, and remove manage saved filters immutably', () => {
  let list = addSavedFilter([], {
    id: 'custom-1',
    name: '주간 점검',
    icon: 'compass',
    query: '#업무',
    quickFilters: ['week', 'p1'],
    includeCompleted: false,
    pinned: false,
  });
  assert.equal(list.length, 1);
  assert.deepEqual(pinnedSavedFilters(list), []);

  // Blank name is ignored.
  assert.equal(addSavedFilter(list, { name: '   ', icon: 'star', query: '', quickFilters: [], includeCompleted: false }), list);

  list = togglePinSavedFilter(list, 'custom-1');
  assert.equal(list[0].pinned, true);
  assert.equal(pinnedSavedFilters(list).length, 1);

  list = renameSavedFilter(list, 'custom-1', '월간 점검', 'bookmark');
  assert.equal(list[0].name, '월간 점검');
  assert.equal(list[0].icon, 'bookmark');

  // Unknown id leaves reference untouched.
  assert.equal(togglePinSavedFilter(list, 'unknown'), list);
  assert.equal(renameSavedFilter(list, 'unknown', 'nope'), list);
  assert.equal(removeSavedFilter(list, 'unknown'), list);

  list = removeSavedFilter(list, 'custom-1');
  assert.deepEqual(list, []);
});
