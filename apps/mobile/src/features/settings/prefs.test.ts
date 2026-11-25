import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_PERSONAL_PREFS,
  DEFAULT_QUICK_ADD_PRESETS,
  mergePersonalPrefs,
  normalizePersonalPrefs,
  parsePersonalPrefs,
  type PersonalPrefs,
} from './prefs.ts';

test('missing or unreadable JSON returns the default preferences', () => {
  for (const raw of [null, undefined, '', 'not json', '123', 'null', '"compact"', '[]']) {
    assert.deepEqual(parsePersonalPrefs(raw), DEFAULT_PERSONAL_PREFS, String(raw));
  }
  assert.equal(DEFAULT_PERSONAL_PREFS.swipeLeft, 'complete');
  assert.equal(DEFAULT_PERSONAL_PREFS.swipeRightPrimary, 'schedule');
  assert.equal(DEFAULT_PERSONAL_PREFS.swipeRightSecondary, 'delete');
  assert.equal(DEFAULT_PERSONAL_PREFS.todayHabitsPosition, 'bottom');
  assert.deepEqual(DEFAULT_PERSONAL_PREFS.quickAddPresets, [...DEFAULT_QUICK_ADD_PRESETS]);
});

test('a valid full PersonalPrefs object round-trips through JSON', () => {
  const custom: PersonalPrefs = {
    dayStartHour: 3,
    startOfWeek: 'sunday',
    timeFormat: '24h',
    density: 'compact',
    showNotePreview: false,
    swipeLeft: 'tomorrow',
    swipeRightPrimary: 'focus',
    swipeRightSecondary: 'none',
    startupTab: 'last',
    todayBadgeMode: 'overdue',
    todayHabitsPosition: 'top',
    showTodayFocusStrip: false,
    showAllDoneArt: false,
    quickAddDefaultProjectId: 'proj-123',
    quickAddKeepOpen: true,
    quickAddPresets: ['오늘', '주말', '15분간'],
    focusDailyGoalMinutes: 120,
    focusKeepAwake: false,
    singleKeyShortcuts: false,
  };
  assert.deepEqual(parsePersonalPrefs(JSON.stringify(custom)), custom);
});

test('numeric preferences are rounded and strictly clamped to valid ranges', () => {
  assert.equal(normalizePersonalPrefs({ dayStartHour: -4 }).dayStartHour, 0);
  assert.equal(normalizePersonalPrefs({ dayStartHour: 12 }).dayStartHour, 5);
  assert.equal(normalizePersonalPrefs({ dayStartHour: 2.6 }).dayStartHour, 3);
  assert.equal(normalizePersonalPrefs({ dayStartHour: Number.NaN }).dayStartHour, 0);
  assert.equal(normalizePersonalPrefs({ dayStartHour: Infinity }).dayStartHour, 0);
  assert.equal(normalizePersonalPrefs({ dayStartHour: '2' }).dayStartHour, 0);

  assert.equal(normalizePersonalPrefs({ focusDailyGoalMinutes: -30 }).focusDailyGoalMinutes, 0);
  assert.equal(normalizePersonalPrefs({ focusDailyGoalMinutes: 9999 }).focusDailyGoalMinutes, 600);
  assert.equal(normalizePersonalPrefs({ focusDailyGoalMinutes: 45.4 }).focusDailyGoalMinutes, 45);
  assert.equal(normalizePersonalPrefs({ focusDailyGoalMinutes: Number.NaN }).focusDailyGoalMinutes, 60);
});

test('invalid enum, boolean, and project id fields fall back safely', () => {
  const parsed = normalizePersonalPrefs({
    startOfWeek: 'friday',
    timeFormat: 'military',
    density: 'tiny',
    showNotePreview: 'yes',
    swipeLeft: 'archive',
    swipeRightPrimary: 'delete',
    swipeRightSecondary: 'complete',
    startupTab: 'settings',
    todayBadgeMode: 'count',
    todayHabitsPosition: 'middle',
    showTodayFocusStrip: 1,
    showAllDoneArt: 0,
    quickAddDefaultProjectId: '   ',
    quickAddKeepOpen: 'true',
    focusKeepAwake: null,
    singleKeyShortcuts: [],
  });
  assert.deepEqual(parsed, DEFAULT_PERSONAL_PREFS);
});

test('quickAddPresets trims, deduplicates, caps length, and allows explicit empty array', () => {
  assert.deepEqual(normalizePersonalPrefs({ quickAddPresets: [] }).quickAddPresets, []);
  assert.deepEqual(
    normalizePersonalPrefs({ quickAddPresets: [' 오늘 ', '내일', '오늘', '', '   ', 42, null] }).quickAddPresets,
    ['오늘', '내일'],
  );
  // Corrupted array with no valid strings falls back to defaults.
  assert.deepEqual(
    normalizePersonalPrefs({ quickAddPresets: [1, null, '   '] }).quickAddPresets,
    [...DEFAULT_QUICK_ADD_PRESETS],
  );
  // Caps at 12 unique entries.
  const many = Array.from({ length: 20 }, (_, i) => `프리셋 ${i + 1}`);
  assert.equal(normalizePersonalPrefs({ quickAddPresets: many }).quickAddPresets.length, 12);
});

test('mergePersonalPrefs applies partial updates and re-validates values', () => {
  const updated = mergePersonalPrefs(DEFAULT_PERSONAL_PREFS, {
    timeFormat: '24h',
    dayStartHour: 9,
    quickAddDefaultProjectId: '  p-1  ',
  });
  assert.equal(updated.timeFormat, '24h');
  assert.equal(updated.dayStartHour, 5);
  assert.equal(updated.quickAddDefaultProjectId, 'p-1');
  assert.equal(updated.density, DEFAULT_PERSONAL_PREFS.density);
});
