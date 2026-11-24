import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveLayout, gridColumns, isTabletSize, PANE_FRAME_MAX, READING_MAX, sameLayout, SHEET_MAX, SHEET_TOP_GAP, twoPaneFrame, widthClassOf,
} from './layout.ts';

test('width classes break at 600 and 840 dp', () => {
  assert.deepEqual([0, 360, 599, 600, 839, 840, 1280].map(widthClassOf), [
    'compact', 'compact', 'compact', 'medium', 'medium', 'expanded', 'expanded',
  ]);
});

test('a tablet is a screen whose shortest side is at least 600 dp, in either orientation', () => {
  assert.equal(isTabletSize(412, 915), false);
  assert.equal(isTabletSize(915, 412), false);
  assert.equal(isTabletSize(800, 1280), true);
  assert.equal(isTabletSize(1280, 800), true);
  assert.equal(isTabletSize(599, 1000), false);
});

test('a phone keeps full-width content, full-width sheets and no second pane', () => {
  const phone = deriveLayout(412, 915, 24);
  assert.equal(phone.widthClass, 'compact');
  assert.deepEqual(phone.column, { width: 412, inset: 0, maxWidth: undefined });
  assert.equal(phone.twoPane, null);
  assert.equal(phone.sheet.maxWidth, undefined);
  assert.equal(phone.sheet.maxHeight, 915 - 24 - SHEET_TOP_GAP);
  assert.equal(phone.short, false);
});

test('a portrait tablet centres a 720 dp reading column and keeps one pane', () => {
  const portrait = deriveLayout(800, 1280);
  assert.equal(portrait.widthClass, 'medium');
  assert.deepEqual(portrait.column, { width: READING_MAX, inset: 40, maxWidth: READING_MAX });
  assert.equal(portrait.twoPane, null);
  assert.equal(portrait.sheet.maxWidth, SHEET_MAX);
  assert.equal(portrait.short, false);
});

test('a landscape tablet gets the two-pane frame and is short', () => {
  const landscape = deriveLayout(1280, 800);
  assert.equal(landscape.widthClass, 'expanded');
  assert.equal(landscape.landscape, true);
  assert.deepEqual(landscape.column, { width: READING_MAX, inset: 280, maxWidth: READING_MAX });
  assert.deepEqual(landscape.twoPane, { inset: 40, listWidth: READING_MAX, sideWidth: PANE_FRAME_MAX - READING_MAX });
  assert.equal(landscape.short, true);
  assert.equal(deriveLayout(1024, 560).short, true);
});

test('an expanded portrait window (a wide foldable) stays one pane', () => {
  assert.equal(deriveLayout(900, 1200).twoPane, null);
});

test('the two-pane frame fills small landscape tablets and gives the list 60 %', () => {
  assert.deepEqual(twoPaneFrame(960), { inset: 0, listWidth: 576, sideWidth: 384 });
  const wide = twoPaneFrame(2000);
  assert.equal(wide.inset * 2 + wide.listWidth + wide.sideWidth, 2000);
  assert.equal(wide.listWidth, READING_MAX);
});

test('grid columns fit the space and stay within bounds', () => {
  assert.equal(gridColumns(380, 160, 2, 6), 2);
  assert.equal(gridColumns(688, 160, 2, 6, 12), 4);
  assert.equal(gridColumns(2000, 160, 2, 6), 6);
  assert.equal(gridColumns(100, 160, 2, 6), 2);
});

test('sameLayout ignores nothing that screens read', () => {
  assert.equal(sameLayout(deriveLayout(1280, 800), deriveLayout(1280, 800)), true);
  assert.equal(sameLayout(deriveLayout(1280, 800), deriveLayout(800, 1280)), false);
  assert.equal(sameLayout(deriveLayout(412, 915), deriveLayout(412, 900)), false);
  assert.equal(sameLayout(deriveLayout(1280, 800), deriveLayout(1300, 800)), false);
  // A width change that moves nothing a screen reads (insets round down) is the same layout.
  assert.equal(sameLayout(deriveLayout(1280, 800), deriveLayout(1281, 800)), true);
});
