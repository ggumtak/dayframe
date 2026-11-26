// The copy lock (DESIGN.md rule 14, 화면에 설명 금지): no gesture hints on screen. Screen readers may still hear them
// (accessibilityLabel / accessibilityHint), a toast may say what to do after an error, and the places below that
// draw outside the app's screens keep their own words. Everything else fails `npm test` with file:line.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNED = ['src/app', 'src/features', 'src/components'];

/** "Long-press …", "tap to …", "swipe …", "drag …". */
const HINT = /길게 눌러|눌러서|밀어 |끌어서/;

/** Lines that may say it: read aloud, transient, or not text at all. */
const EXEMPT_LINE = /accessibilityLabel|accessibilityHint|showToast\(|showHabitUndoToast\(|^\s*(\/\/|\*|\/\*)/;

/** Files that may say it, with the reason. */
const ALLOW_LIST: readonly { path: string; why: string }[] = [
  { path: 'src/features/widget/', why: 'home-screen widgets: a tap is the only way in, so they say so' },
  { path: 'src/features/reminders/', why: 'notification texts, read outside the app' },
];

const isAllowed = (path: string): boolean =>
  /\.test\.tsx?$/.test(path) || ALLOW_LIST.some((entry) => path.startsWith(entry.path));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

function findHints(source: string): { line: number; text: string }[] {
  return source.split('\n').flatMap((text, index) => (
    HINT.test(text) && !EXEMPT_LINE.test(text) ? [{ line: index + 1, text: text.trim() }] : []
  ));
}

test('no gesture hint on screen (change the control instead; see DESIGN.md rule 14)', () => {
  const offences: string[] = [];
  for (const dir of SCANNED) {
    for (const file of sources(join(appRoot, dir))) {
      const path = relative(appRoot, file).split('\\').join('/');
      if (isAllowed(path)) continue;
      for (const hint of findHints(readFileSync(file, 'utf8'))) offences.push(`${path}:${hint.line}  ${hint.text}`);
    }
  }
  assert.equal(offences.length, 0, '\nGesture hints on screen:\n' + offences.join('\n'));
});

test('every allow-list entry exists and says why', () => {
  const all = SCANNED.flatMap((dir) => sources(join(appRoot, dir)).map((file) => relative(appRoot, file).split('\\').join('/')));
  for (const entry of ALLOW_LIST) {
    assert.ok(entry.why.length > 10, entry.path);
    assert.ok(all.some((path) => path.startsWith(entry.path)), `${entry.path} no longer exists`);
  }
});

test('the scanner finds visible hints and skips labels, toasts and comments', () => {
  const source = [
    '<Txt variant="caption" tone="faint">길게 눌러 이동</Txt>',
    "placeholder={'눌러서 시간 설정'}",
    "{`${month}월 일정 ${total}개 · 좌우로 밀어 월 이동`}",
    'accessibilityLabel={`${title}, 눌러서 변경`}',
    'accessibilityHint="길게 눌러 기록 조절"',
    "showToast('주소를 길게 눌러 직접 복사해 주세요.');",
    '// 길게 눌러 순서 변경 used to be here',
    '<Txt>오늘 할 일</Txt>',
  ].join('\n');
  assert.deepEqual(findHints(source).map((hint) => hint.line), [1, 2, 3]);
});
