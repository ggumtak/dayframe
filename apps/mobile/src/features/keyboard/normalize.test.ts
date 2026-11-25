import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatKeyLabel,
  hasAnyMod,
  isMod,
  isPlainKey,
  matchesCombo,
  moveCursor,
  nextCursorAfterRemoval,
  normalizeWebCode,
  normalizeWebEvent,
} from './normalize.ts';
import type { HardwareKeyEvent } from './types.ts';

function makeEvent(key: string, overrides: Partial<HardwareKeyEvent> = {}): HardwareKeyEvent {
  return {
    key,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    editing: false,
    repeat: false,
    modal: false,
    ...overrides,
  };
}

test('modifier helpers detect ctrl/meta/alt and plain keys', () => {
  const plain = makeEvent('n');
  assert.equal(isMod(plain), false);
  assert.equal(hasAnyMod(plain), false);
  assert.equal(isPlainKey(plain, 'n'), true);
  assert.equal(isPlainKey(plain, 'q'), false);

  const ctrlK = makeEvent('k', { ctrl: true });
  assert.equal(isMod(ctrlK), true);
  assert.equal(hasAnyMod(ctrlK), true);
  assert.equal(isPlainKey(ctrlK, 'k'), false);

  const metaK = makeEvent('k', { meta: true });
  assert.equal(isMod(metaK), true);
  assert.equal(hasAnyMod(metaK), true);

  const altD = makeEvent('d', { alt: true });
  assert.equal(isMod(altD), false);
  assert.equal(hasAnyMod(altD), true);

  const shiftN = makeEvent('n', { shift: true });
  assert.equal(hasAnyMod(shiftN), false);
  assert.equal(isPlainKey(shiftN, 'n'), false);
});

test('matchesCombo handles plain, shifted, question mark, plus, mod, ctrl, and alt combos', () => {
  assert.equal(matchesCombo(makeEvent('n'), 'n'), true);
  assert.equal(matchesCombo(makeEvent('q'), 'q'), true);
  assert.equal(matchesCombo(makeEvent('arrowup'), 'arrowup'), true);
  assert.equal(matchesCombo(makeEvent('f1'), 'f1'), true);
  assert.equal(matchesCombo(makeEvent('n', { shift: true }), 'n'), false);
  assert.equal(matchesCombo(makeEvent('n', { ctrl: true }), 'n'), false);

  // '?' matches Shift+/ without ctrl/alt/meta.
  assert.equal(matchesCombo(makeEvent('/', { shift: true }), '?'), true);
  assert.equal(matchesCombo(makeEvent('/', { shift: false }), '?'), false);
  assert.equal(matchesCombo(makeEvent('/', { shift: true, ctrl: true }), '?'), false);
  assert.equal(matchesCombo(makeEvent('/', { shift: true, alt: true }), '?'), false);

  // '+' matches both Numpad '+' and Shift+'=' when no ctrl/alt/meta.
  assert.equal(matchesCombo(makeEvent('+'), '+'), true);
  assert.equal(matchesCombo(makeEvent('=', { shift: true }), '+'), true);
  assert.equal(matchesCombo(makeEvent('=', { shift: false }), '+'), false);
  assert.equal(matchesCombo(makeEvent('=', { shift: true, ctrl: true }), '+'), false);
  assert.equal(matchesCombo(makeEvent('+', { alt: true }), '+'), false);
  assert.equal(matchesCombo(makeEvent('='), '='), true);
  assert.equal(matchesCombo(makeEvent('=', { shift: true }), '='), false);

  // Shift combos
  assert.equal(matchesCombo(makeEvent('g', { shift: true }), 'shift+g'), true);
  assert.equal(matchesCombo(makeEvent('1', { shift: true }), 'shift+1'), true);
  assert.equal(matchesCombo(makeEvent('[', { shift: true }), 'shift+['), true);
  assert.equal(matchesCombo(makeEvent('enter', { shift: true }), 'shift+enter'), true);
  assert.equal(matchesCombo(makeEvent('tab', { shift: true }), 'shift+tab'), true);

  // mod vs ctrl
  assert.equal(matchesCombo(makeEvent('k', { ctrl: true }), 'mod+k'), true);
  assert.equal(matchesCombo(makeEvent('k', { meta: true }), 'mod+k'), true);
  assert.equal(matchesCombo(makeEvent('k', { ctrl: true, shift: true }), 'mod+k'), false);
  assert.equal(matchesCombo(makeEvent('k', { ctrl: true }), 'ctrl+k'), true);
  assert.equal(matchesCombo(makeEvent('k', { meta: true }), 'ctrl+k'), false);
  assert.equal(matchesCombo(makeEvent('enter', { meta: true }), 'mod+enter'), true);
  assert.equal(matchesCombo(makeEvent('/', { ctrl: true }), 'mod+/'), true);
  assert.equal(matchesCombo(makeEvent('a', { ctrl: true, shift: true }), 'ctrl+shift+a'), true);

  // Alt combos
  assert.equal(matchesCombo(makeEvent('d', { alt: true }), 'alt+d'), true);
  assert.equal(matchesCombo(makeEvent('1', { alt: true }), 'alt+1'), true);
  assert.equal(matchesCombo(makeEvent('arrowup', { alt: true }), 'alt+arrowup'), true);
  assert.equal(matchesCombo(makeEvent('arrowup', { alt: true, shift: true }), 'alt+arrowup'), false);

  // Invalid or empty combos
  assert.equal(matchesCombo(makeEvent('n'), ''), false);
  assert.equal(matchesCombo(makeEvent('n'), 'hyper+n'), false);
});

test('normalizeWebCode maps physical codes independent of Korean IME and rejects system keys', () => {
  assert.equal(normalizeWebCode('KeyQ', 'ㅂ'), 'q');
  assert.equal(normalizeWebCode('KeyN', 'ㅜ'), 'n');
  assert.equal(normalizeWebCode('Digit5', '5'), '5');
  assert.equal(normalizeWebCode('Numpad3', '3'), '3');
  assert.equal(normalizeWebCode('Slash', '?'), '/');
  assert.equal(normalizeWebCode('Comma', ','), ',');
  assert.equal(normalizeWebCode('Period', '.'), '.');
  assert.equal(normalizeWebCode('BracketLeft', '['), '[');
  assert.equal(normalizeWebCode('BracketRight', ']'), ']');
  assert.equal(normalizeWebCode('Minus', '-'), '-');
  assert.equal(normalizeWebCode('NumpadSubtract', '-'), '-');
  assert.equal(normalizeWebCode('Equal', '+'), '=');
  assert.equal(normalizeWebCode('NumpadAdd', '+'), '+');
  assert.equal(normalizeWebCode('Semicolon', ';'), ';');
  assert.equal(normalizeWebCode('Enter', 'Enter'), 'enter');
  assert.equal(normalizeWebCode('NumpadEnter', 'Enter'), 'enter');
  assert.equal(normalizeWebCode('Escape', 'Escape'), 'escape');
  assert.equal(normalizeWebCode('Space', ' '), 'space');
  assert.equal(normalizeWebCode('Tab', 'Tab'), 'tab');
  assert.equal(normalizeWebCode('Backspace', 'Backspace'), 'backspace');
  assert.equal(normalizeWebCode('Delete', 'Delete'), 'delete');
  assert.equal(normalizeWebCode('ArrowUp', 'ArrowUp'), 'arrowup');
  assert.equal(normalizeWebCode('ArrowDown', 'ArrowDown'), 'arrowdown');
  assert.equal(normalizeWebCode('ArrowLeft', 'ArrowLeft'), 'arrowleft');
  assert.equal(normalizeWebCode('ArrowRight', 'ArrowRight'), 'arrowright');
  assert.equal(normalizeWebCode('PageUp', 'PageUp'), 'pageup');
  assert.equal(normalizeWebCode('PageDown', 'PageDown'), 'pagedown');
  assert.equal(normalizeWebCode('Home', 'Home'), 'home');
  assert.equal(normalizeWebCode('End', 'End'), 'end');
  assert.equal(normalizeWebCode('F1', 'F1'), 'f1');

  // Fallback when physical code is absent
  assert.equal(normalizeWebCode('', 'Enter'), 'enter');
  assert.equal(normalizeWebCode('', ' '), 'space');
  assert.equal(normalizeWebCode('', 'K'), 'k');

  // Unrecognized / modifier / system keys
  assert.equal(normalizeWebCode('ShiftLeft', 'Shift'), null);
  assert.equal(normalizeWebCode('ControlLeft', 'Control'), null);
  assert.equal(normalizeWebCode('MetaLeft', 'Meta'), null);
  assert.equal(normalizeWebCode('CapsLock', 'CapsLock'), null);
  assert.equal(normalizeWebCode('Lang1', 'HangulMode'), null);
  assert.equal(normalizeWebCode('F5', 'F5'), null);
  assert.equal(normalizeWebCode('', 'ㅂ'), null);
  assert.equal(normalizeWebCode('', 'Process'), null);
});

test('normalizeWebEvent preserves Korean physical shortcuts and protects IME + OS combos', () => {
  // Korean IME physical key works when not editing
  const koreanQ = normalizeWebEvent({ code: 'KeyQ', key: 'ㅂ' }, false);
  assert.deepEqual(koreanQ, makeEvent('q'));

  // IME language switch combos are always passed through (null)
  assert.equal(normalizeWebEvent({ code: 'Space', key: ' ', shiftKey: true }, false), null);
  assert.equal(normalizeWebEvent({ code: 'Space', key: ' ', ctrlKey: true }, false), null);
  assert.equal(normalizeWebEvent({ code: 'Space', key: ' ', altKey: true }, false), null);
  assert.equal(normalizeWebEvent({ code: 'Space', key: ' ', shiftKey: true }, true), null);

  // Plain space works outside editing, ignored inside editing
  assert.equal(normalizeWebEvent({ code: 'Space', key: ' ' }, false)?.key, 'space');
  assert.equal(normalizeWebEvent({ code: 'Space', key: ' ' }, true), null);

  // isComposing is protected during editing
  assert.equal(normalizeWebEvent({ code: 'Escape', key: 'Escape', isComposing: true }, true), null);
  assert.equal(normalizeWebEvent({ code: 'Enter', key: 'Enter', ctrlKey: true, isComposing: true }, true), null);
  assert.equal(normalizeWebEvent({ code: 'KeyN', key: 'ㅜ', isComposing: true }, false)?.key, 'n');

  // Meta shortcuts: only k, enter, /, f pass through
  assert.equal(normalizeWebEvent({ code: 'KeyK', key: 'k', metaKey: true }, false)?.key, 'k');
  assert.equal(normalizeWebEvent({ code: 'Enter', key: 'Enter', metaKey: true }, true)?.key, 'enter');
  assert.equal(normalizeWebEvent({ code: 'Slash', key: '/', metaKey: true }, true)?.key, '/');
  assert.equal(normalizeWebEvent({ code: 'KeyF', key: 'f', metaKey: true }, true)?.key, 'f');
  assert.equal(normalizeWebEvent({ code: 'KeyC', key: 'c', metaKey: true }, false), null);
  assert.equal(normalizeWebEvent({ code: 'KeyR', key: 'r', metaKey: true }, false), null);
  assert.equal(normalizeWebEvent({ code: 'Tab', key: 'Tab', metaKey: true }, false), null);
});

test('normalizeWebEvent filters editing keys to the Android-safe set and honors capture options', () => {
  // Regular typing and standard clipboard/undo stay untouched while editing
  assert.equal(normalizeWebEvent({ code: 'KeyN', key: 'n' }, true), null);
  assert.equal(normalizeWebEvent({ code: 'Enter', key: 'Enter' }, true), null);
  assert.equal(normalizeWebEvent({ code: 'KeyC', key: 'c', ctrlKey: true }, true), null);
  assert.equal(normalizeWebEvent({ code: 'KeyV', key: 'v', ctrlKey: true }, true), null);
  assert.equal(normalizeWebEvent({ code: 'KeyA', key: 'a', ctrlKey: true }, true), null);
  assert.equal(normalizeWebEvent({ code: 'KeyZ', key: 'z', ctrlKey: true }, true), null);

  // Safe editing shortcuts pass through
  assert.equal(normalizeWebEvent({ code: 'Escape', key: 'Escape' }, true)?.editing, true);
  assert.equal(normalizeWebEvent({ code: 'F1', key: 'F1' }, true)?.key, 'f1');
  assert.equal(normalizeWebEvent({ code: 'Enter', key: 'Enter', ctrlKey: true }, true)?.key, 'enter');
  assert.equal(normalizeWebEvent({ code: 'KeyK', key: 'k', ctrlKey: true }, true)?.key, 'k');
  assert.equal(normalizeWebEvent({ code: 'Slash', key: '/', ctrlKey: true }, true)?.key, '/');
  assert.equal(normalizeWebEvent({ code: 'KeyF', key: 'f', ctrlKey: true }, true)?.key, 'f');
  assert.equal(normalizeWebEvent({ code: 'KeyA', key: 'A', ctrlKey: true, shiftKey: true }, true)?.key, 'a');
  assert.equal(normalizeWebEvent({ code: 'KeyJ', key: 'j', ctrlKey: true }, true)?.key, 'j');
  assert.equal(normalizeWebEvent({ code: 'KeyN', key: 'n', ctrlKey: true }, true)?.key, 'n');
  assert.equal(normalizeWebEvent({ code: 'KeyD', key: 'd', altKey: true }, true)?.key, 'd');
  assert.equal(normalizeWebEvent({ code: 'Digit1', key: '1', altKey: true }, true)?.key, '1');
  assert.equal(normalizeWebEvent({ code: 'ArrowUp', key: 'ArrowUp', altKey: true }, true)?.key, 'arrowup');
  assert.equal(normalizeWebEvent({ code: 'Tab', key: 'Tab', altKey: true }, true), null);

  // Capture options for Tab and ArrowUp/ArrowDown while editing
  assert.equal(normalizeWebEvent({ code: 'Tab', key: 'Tab' }, true), null);
  assert.equal(normalizeWebEvent({ code: 'Tab', key: 'Tab' }, true, { tab: true })?.key, 'tab');
  assert.equal(
    normalizeWebEvent({ code: 'Tab', key: 'Tab', shiftKey: true }, true, { tab: true })?.shift,
    true,
  );

  assert.equal(normalizeWebEvent({ code: 'ArrowDown', key: 'ArrowDown' }, true), null);
  assert.equal(normalizeWebEvent({ code: 'ArrowUp', key: 'ArrowUp' }, true, { arrows: true })?.key, 'arrowup');
  assert.equal(normalizeWebEvent({ code: 'ArrowDown', key: 'ArrowDown' }, true, { arrows: true })?.key, 'arrowdown');
  assert.equal(normalizeWebEvent({ code: 'ArrowUp', key: 'ArrowUp', shiftKey: true }, true, { arrows: true }), null);
  assert.equal(normalizeWebEvent({ code: 'ArrowLeft', key: 'ArrowLeft' }, true, { arrows: true }), null);
});

test('moveCursor handles empty lists, initial focus, and clamping', () => {
  assert.equal(moveCursor(-1, 1, 0), -1);
  assert.equal(moveCursor(0, 1, 0), -1);
  assert.equal(moveCursor(-1, 1, 4), 0);
  assert.equal(moveCursor(-1, -1, 4), 3);
  assert.equal(moveCursor(-1, 0, 4), -1);
  assert.equal(moveCursor(0, -1, 4), 0);
  assert.equal(moveCursor(3, 1, 4), 3);
  assert.equal(moveCursor(1, 1, 4), 2);
  assert.equal(moveCursor(2, -1, 4), 1);
  assert.equal(moveCursor(1, 10, 4), 3);
  assert.equal(moveCursor(2, -10, 4), 0);
});

test('nextCursorAfterRemoval keeps focus or advances to the replacement slot', () => {
  assert.equal(nextCursorAfterRemoval(['a', 'b', 'c'], 'b', 1), 'b');
  assert.equal(nextCursorAfterRemoval(['a', 'c'], 'b', 1), 'c');
  assert.equal(nextCursorAfterRemoval(['a', 'b'], 'c', 2), 'b');
  assert.equal(nextCursorAfterRemoval(['b', 'c'], 'a', 0), 'b');
  assert.equal(nextCursorAfterRemoval(['a', 'b'], 'missing', -1), 'a');
  assert.equal(nextCursorAfterRemoval([], 'a', 0), null);
});

test('formatKeyLabel formats canonical combos into crisp keycaps', () => {
  assert.equal(formatKeyLabel('mod+k'), 'Ctrl+K');
  assert.equal(formatKeyLabel('mod+enter'), 'Ctrl+Enter');
  assert.equal(formatKeyLabel('shift+/'), '?');
  assert.equal(formatKeyLabel('?'), '?');
  assert.equal(formatKeyLabel('arrowup'), '↑');
  assert.equal(formatKeyLabel('arrowdown'), '↓');
  assert.equal(formatKeyLabel('arrowleft'), '←');
  assert.equal(formatKeyLabel('arrowright'), '→');
  assert.equal(formatKeyLabel('escape'), 'Esc');
  assert.equal(formatKeyLabel('space'), 'Space');
  assert.equal(formatKeyLabel('enter'), 'Enter');
  assert.equal(formatKeyLabel('delete'), 'Del');
  assert.equal(formatKeyLabel('backspace'), '⌫');
  assert.equal(formatKeyLabel('alt+arrowup'), 'Alt+↑');
  assert.equal(formatKeyLabel('ctrl+shift+a'), 'Ctrl+Shift+A');
  assert.equal(formatKeyLabel('f1'), 'F1');
  assert.equal(formatKeyLabel('+'), '+');
  assert.equal(formatKeyLabel('tab'), 'Tab');
});
