import type { HardwareKeyEvent } from './types.ts';

export interface WebKeyEventLike {
  code?: string;
  key?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export interface WebCaptureOptions {
  tab?: boolean;
  arrows?: boolean;
}

const CODE_TO_KEY: Record<string, string> = {
  Slash: '/',
  NumpadDivide: '/',
  Comma: ',',
  Period: '.',
  NumpadDecimal: '.',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  NumpadSubtract: '-',
  Equal: '=',
  NumpadAdd: '+',
  Semicolon: ';',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Space: 'space',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Home: 'home',
  End: 'end',
  F1: 'f1',
};

const FALLBACK_KEY_MAP: Record<string, string> = {
  ' ': 'space',
  enter: 'enter',
  escape: 'escape',
  esc: 'escape',
  tab: 'tab',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  pageup: 'pageup',
  pagedown: 'pagedown',
  home: 'home',
  end: 'end',
  f1: 'f1',
  '/': '/',
  ',': ',',
  '.': '.',
  '[': '[',
  ']': ']',
  '-': '-',
  '=': '=',
  '+': '+',
  ';': ';',
};

const KEY_LABELS: Record<string, string> = {
  mod: 'Ctrl',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  escape: 'Esc',
  esc: 'Esc',
  enter: 'Enter',
  space: 'Space',
  tab: 'Tab',
  backspace: '⌫',
  delete: 'Del',
  del: 'Del',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  home: 'Home',
  end: 'End',
};

export function isMod(event: HardwareKeyEvent): boolean {
  return event.ctrl || event.meta;
}

export function hasAnyMod(event: HardwareKeyEvent): boolean {
  return event.ctrl || event.alt || event.meta;
}

export function isPlainKey(event: HardwareKeyEvent, key: string): boolean {
  return !event.ctrl && !event.alt && !event.meta && !event.shift && event.key === key;
}

function splitComboParts(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed === '+') return ['+'];
  if (trimmed.endsWith('++')) {
    const prefix = trimmed.slice(0, -2);
    const prefixParts = prefix ? prefix.split('+').filter(Boolean) : [];
    return [...prefixParts, '+'];
  }
  return trimmed.split('+');
}

export function matchesCombo(event: HardwareKeyEvent, combo: string): boolean {
  const normalized = combo.trim().toLowerCase();
  if (!normalized) return false;

  if (normalized === '?') {
    return (
      !event.ctrl &&
      !event.alt &&
      !event.meta &&
      (event.key === '?' || (event.key === '/' && event.shift))
    );
  }

  const parts = splitComboParts(normalized);
  if (parts.length === 0) return false;

  const targetKey = parts[parts.length - 1];
  if (!targetKey) return false;

  let wantMod = false;
  let wantCtrl = false;
  let wantAlt = false;
  let wantShift = false;
  let wantMeta = false;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const token = parts[i];
    switch (token) {
      case 'mod':
        wantMod = true;
        break;
      case 'ctrl':
      case 'control':
        wantCtrl = true;
        break;
      case 'alt':
      case 'option':
        wantAlt = true;
        break;
      case 'shift':
        wantShift = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        wantMeta = true;
        break;
      default:
        return false;
    }
  }

  if (wantMod) {
    if (!isMod(event)) return false;
    if (wantCtrl && !event.ctrl) return false;
    if (wantMeta && !event.meta) return false;
  } else {
    if (event.ctrl !== wantCtrl || event.meta !== wantMeta) return false;
  }

  if (event.alt !== wantAlt) return false;

  if (targetKey === '+' && !wantShift) {
    return event.key === '+' || (event.key === '=' && event.shift);
  }

  if (event.shift !== wantShift) return false;

  return event.key === targetKey;
}

export function normalizeWebCode(code: string, fallbackKey: string): string | null {
  if (code) {
    if (/^Key[A-Z]$/.test(code)) {
      return code[3].toLowerCase();
    }
    if (/^Digit[0-9]$/.test(code)) {
      return code[5];
    }
    if (/^Numpad[0-9]$/.test(code)) {
      return code[6];
    }
    if (code in CODE_TO_KEY) {
      return CODE_TO_KEY[code];
    }
  }

  if (!fallbackKey) return null;

  const lower = fallbackKey.toLowerCase();
  if (lower.length === 1 && ((lower >= 'a' && lower <= 'z') || (lower >= '0' && lower <= '9'))) {
    return lower;
  }
  if (lower in FALLBACK_KEY_MAP) {
    return FALLBACK_KEY_MAP[lower];
  }
  return null;
}

function isAllowedWhileEditing(
  key: string,
  ctrl: boolean,
  alt: boolean,
  shift: boolean,
  meta: boolean,
  capture?: WebCaptureOptions,
): boolean {
  if (key === 'escape' || key === 'f1') return true;

  const mod = ctrl || meta;
  if (mod && (key === 'enter' || key === 'k' || key === '/' || key === 'f')) return true;
  if (ctrl && shift && !alt && !meta && key === 'a') return true;
  if (ctrl && !alt && !shift && !meta && (key === 'j' || key === 'n')) return true;

  if (alt && !ctrl && !meta && key !== 'space') {
    if (
      (key.length === 1 && ((key >= 'a' && key <= 'z') || (key >= '0' && key <= '9'))) ||
      key === 'arrowup' ||
      key === 'arrowdown' ||
      key === 'enter'
    ) {
      return true;
    }
  }

  if (capture?.tab && key === 'tab' && !ctrl && !alt && !meta) {
    return true;
  }

  if (
    capture?.arrows &&
    (key === 'arrowup' || key === 'arrowdown') &&
    !ctrl &&
    !alt &&
    !meta &&
    !shift
  ) {
    return true;
  }

  return false;
}

export function normalizeWebEvent(
  e: WebKeyEventLike,
  editing: boolean,
  capture?: WebCaptureOptions,
): HardwareKeyEvent | null {
  const ctrl = Boolean(e.ctrlKey);
  const alt = Boolean(e.altKey);
  const shift = Boolean(e.shiftKey);
  const meta = Boolean(e.metaKey);
  const repeat = Boolean(e.repeat);
  const isComposing = Boolean(e.isComposing);

  if (editing && isComposing) {
    return null;
  }

  const key = normalizeWebCode(e.code ?? '', e.key ?? '');
  if (!key) {
    return null;
  }

  // Protect Korean/English IME language switch combos.
  if (key === 'space' && (shift || ctrl || alt)) {
    return null;
  }

  // Protect OS/browser Meta shortcuts other than the explicit app-safe set.
  if (meta && !ctrl && key !== 'k' && key !== 'enter' && key !== '/' && key !== 'f') {
    return null;
  }

  if (editing && !isAllowedWhileEditing(key, ctrl, alt, shift, meta, capture)) {
    return null;
  }

  return {
    key,
    ctrl,
    alt,
    shift,
    meta,
    editing,
    repeat,
    modal: false,
  };
}

export function moveCursor(currentIndex: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (currentIndex < 0) {
    if (delta > 0) return 0;
    if (delta < 0) return count - 1;
    return -1;
  }
  return Math.min(count - 1, Math.max(0, currentIndex + delta));
}

export function nextCursorAfterRemoval(
  ids: readonly string[],
  focusedId: string | null,
  previousIndex: number,
): string | null {
  if (focusedId !== null && ids.includes(focusedId)) return focusedId;
  if (ids.length === 0) return null;
  return ids[Math.min(Math.max(0, previousIndex), ids.length - 1)];
}

export function formatKeyLabel(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  if (lower === '?' || lower === 'shift+/') return '?';
  if (lower === '+') return '+';

  const parts = splitComboParts(trimmed);
  return parts
    .map((part) => {
      const partLower = part.toLowerCase();
      if (partLower in KEY_LABELS) return KEY_LABELS[partLower];
      if (/^[a-z]$/.test(partLower)) return partLower.toUpperCase();
      if (/^f\d{1,2}$/.test(partLower)) return partLower.toUpperCase();
      return part;
    })
    .join('+');
}
