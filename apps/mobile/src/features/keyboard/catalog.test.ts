import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SHORTCUT_SECTIONS, sectionsForContext } from './catalog.ts';
import type { ShortcutContextId } from './types.ts';

test('every shortcut section has unique id, title, and valid non-empty items', () => {
  assert.ok(SHORTCUT_SECTIONS.length >= 10);

  const ids = new Set<string>();
  for (const section of SHORTCUT_SECTIONS) {
    assert.ok(section.id.trim().length > 0);
    assert.equal(ids.has(section.id), false, `duplicate section id: ${section.id}`);
    ids.add(section.id);

    assert.ok(section.title.trim().length > 0, `${section.id} title`);
    assert.ok(section.items.length > 0, `${section.id} items`);

    for (const item of section.items) {
      assert.ok(item.label.trim().length > 0, `${section.id} item label`);
      assert.ok(item.keys.length > 0, `${section.id} ${item.label} keys`);
      for (const key of item.keys) {
        assert.ok(key.trim().length > 0, `${section.id} ${item.label} key`);
      }
      if (item.detail !== undefined) {
        assert.ok(item.detail.trim().length > 0, `${section.id} ${item.label} detail`);
      }
    }
  }
});

test('sectionsForContext prioritizes task-list screens with task-list, global, quick-add, and no duplicates', () => {
  for (const context of ['today', 'inbox', 'upcoming', 'search'] as const) {
    const sections = sectionsForContext(context);
    const ids = sections.map((section) => section.id);

    assert.equal(ids[0], context);
    assert.equal(ids[1], 'task-list');
    assert.equal(ids[2], 'global');
    assert.equal(ids[3], 'quick-add');
    assert.equal(new Set(ids).size, SHORTCUT_SECTIONS.length);
    assert.equal(ids.length, SHORTCUT_SECTIONS.length);
  }
});

test('sectionsForContext prioritizes non-task-list dedicated contexts cleanly', () => {
  for (const context of ['habits', 'focus', 'task-detail'] as const) {
    const sections = sectionsForContext(context);
    const ids = sections.map((section) => section.id);

    assert.equal(ids[0], context);
    assert.equal(ids[1], 'global');
    assert.equal(ids[2], 'quick-add');
    assert.equal(new Set(ids).size, SHORTCUT_SECTIONS.length);
    assert.equal(ids.length, SHORTCUT_SECTIONS.length);
  }

  const quickAddIds = sectionsForContext('quick-add').map((section) => section.id);
  assert.equal(quickAddIds[0], 'quick-add');
  assert.equal(quickAddIds[1], 'global');
  assert.equal(new Set(quickAddIds).size, SHORTCUT_SECTIONS.length);

  const globalIds = sectionsForContext('global').map((section) => section.id);
  assert.equal(globalIds[0], 'global');
  assert.equal(globalIds[1], 'quick-add');
  assert.equal(new Set(globalIds).size, SHORTCUT_SECTIONS.length);
});

test('sectionsForContext falls back to global and quick-add for contexts without dedicated sections', () => {
  const contexts: ShortcutContextId[] = ['settings', 'completed', 'routines', 'habit-detail', 'habit-new'];
  for (const context of contexts) {
    const ids = sectionsForContext(context).map((section) => section.id);
    assert.equal(ids[0], 'global');
    assert.equal(ids[1], 'quick-add');
    assert.equal(new Set(ids).size, SHORTCUT_SECTIONS.length);
    assert.equal(ids.length, SHORTCUT_SECTIONS.length);
  }
});
