// The colour lock (DESIGN.md): colours come from theme tokens, so a hard-coded colour anywhere else is a bug.
// colorBudget.test.ts scans src/ with these rules and fails with file:line, so a stray colour breaks `npm test`.
// Free of React Native and of the file system, so it is easy to test on its own.

/**
 * Where a literal colour may be written, as path prefixes relative to apps/mobile. Everything here either defines the
 * tokens or runs where the theme cannot reach (native widget rendering, notification accent colour).
 */
export const COLOR_ALLOW_LIST: readonly { path: string; why: string }[] = [
  { path: 'src/theme/', why: 'the tokens themselves and the colour maths' },
  { path: 'src/features/settings/palettes.ts', why: 'the four accent palettes (light and dark)' },
  { path: 'src/features/tasks/listColors.ts', why: 'the muted list palette and the stored hexes it maps from' },
  { path: 'src/features/habits/palette.ts', why: 'stored habit colours (kept as data, no longer drawn)' },
  { path: 'src/components/art/', why: 'artwork maths and preview samples; the art reads its colours from the theme' },
  { path: 'src/features/widget/', why: 'home-screen widgets are drawn natively, outside React and the theme' },
  { path: 'src/features/reminders/notify.ts', why: 'the Android notification accent colour is a native setting' },
];

export const isAllowed = (path: string): boolean =>
  /\.test\.tsx?$/.test(path) || COLOR_ALLOW_LIST.some((entry) => path === entry.path || (entry.path.endsWith('/') && path.startsWith(entry.path)));

export interface ColorFinding { line: number; text: string; match: string }

const PATTERNS: RegExp[] = [
  // #RGB, #RGBA, #RRGGBB, #RRGGBBAA
  /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g,
  /\b(?:rgba?|hsla?)\(/g,
  // An alpha suffix glued onto a colour: colors.accent + '2E'
  /\+\s*['"][0-9a-fA-F]{2}['"]/g,
  // A named colour in a colour prop: color: 'white', fill="red"
  /\b(?:color|[a-z]+Color|fill|stroke)\s*[:=]\s*\{?\s*['"](?:white|black|red|blue|green|orange|yellow|purple|pink|gray|grey)['"]/gi,
];

/** Every literal colour in a source file, skipping comments. */
export function findColorLiterals(source: string): ColorFinding[] {
  const findings: ColorFinding[] = [];
  let inBlock = false;
  source.split('\n').forEach((raw, index) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    // Drop block comments that open (and maybe close) on this line, then a trailing line comment.
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open >= 0) {
      line = line.slice(0, open);
      inBlock = true;
    }
    line = line.replace(/(^|[^:'"`])\/\/.*$/, '$1');
    for (const pattern of PATTERNS) {
      for (const match of line.matchAll(pattern)) findings.push({ line: index + 1, text: raw.trim(), match: match[0] });
    }
  });
  return findings;
}
