import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COLOR_ALLOW_LIST, findColorLiterals, isAllowed } from './colorBudget.ts';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test('no hard-coded colour outside the allow-list (use a theme token; see DESIGN.md)', () => {
  const offences: string[] = [];
  for (const file of sources(join(appRoot, 'src'))) {
    const path = relative(appRoot, file).split('\\').join('/');
    if (isAllowed(path)) continue;
    for (const finding of findColorLiterals(readFileSync(file, 'utf8'))) {
      offences.push(`${path}:${finding.line}  ${finding.match}  —  ${finding.text}`);
    }
  }
  assert.equal(offences.length, 0, '\nHard-coded colours (move them to src/theme/tokens.ts or use colors.*):\n' + offences.join('\n'));
});

test('every allow-list entry exists and says why', () => {
  const all = sources(join(appRoot, 'src')).map((file) => relative(appRoot, file).split('\\').join('/'));
  for (const entry of COLOR_ALLOW_LIST) {
    assert.ok(entry.why.length > 10, entry.path);
    assert.ok(all.some((path) => path === entry.path || path.startsWith(entry.path)), `${entry.path} no longer exists`);
  }
});

test('the scanner finds hex, rgb(), hsl(), alpha suffixes and named colours, and skips comments', () => {
  const source = [
    "const a = '#FFFFFF';",
    "const b = { color: '#abc' };",
    "const c = 'rgba(0, 0, 0, 0.5)';",
    "const d = colors.accent + '2E';",
    "const e = { backgroundColor: 'white' };",
    '// a comment with #123456 is fine',
    '/* and #FFFFFF here',
    '   and rgb( here */',
    "const f = '#' + name; const g = `#${tag}`; const h = '#집중';",
    "<Path fill=\"red\" />",
  ].join('\n');
  const found = findColorLiterals(source).map((finding) => `${finding.line}:${finding.match}`);
  assert.deepEqual(found, ["1:#FFFFFF", "2:#abc", "3:rgba(", "4:+ '2E'", "5:backgroundColor: 'white'", '10:fill="red"']);
});

test('test files and the allow-listed modules are exempt', () => {
  assert.equal(isAllowed('src/theme/tokens.ts'), true);
  assert.equal(isAllowed('src/features/widget/widgets.tsx'), true);
  assert.equal(isAllowed('src/features/tasks/listColors.test.ts'), true);
  assert.equal(isAllowed('src/components/TaskRow.tsx'), false);
  assert.equal(isAllowed('src/features/settings/palettes.test.ts'), true);
  assert.equal(isAllowed('src/features/settings/palettesX.ts'), false);
});
