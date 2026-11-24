// Renders every piece in src/components/art to PNG contact sheets so the artwork can be reviewed without a
// phone. Dev-only; output goes to scripts/art/out/ (git-ignored).
//
//   node scripts/art/render.mjs
//
// Parity with the app: this script imports the very same geometry modules the components draw
// (illustrations.ts, backdrop.ts) and turns them into SVG with scene.ts's toSvgString(), which serialises the
// element list from svgNodes()/defNodes() — the same functions <ArtView> maps onto react-native-svg elements.
// Nothing is redrawn here. Node loads the .ts files directly (type stripping, Node ≥ 22.18).
//
// Needs Playwright with Chromium (not an app dependency). It uses a global install if `playwright` is not
// resolvable from here.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const out = join(here, 'out');
const art = (f) => pathToFileURL(join(root, 'src/components/art', f)).href;

const { ILLUSTRATIONS } = await import(art('illustrations.ts'));
const { BACKDROPS, BACKDROP_VARIANTS, BACKDROP_ASPECT, BACKDROP_H } = await import(art('backdrop.ts'));
const { artPalette, nodeCount, toSvgString } = await import(art('scene.ts'));
const { SAMPLE_ACCENTS, sampleTheme } = await import(art('samples.ts'));

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(join(globalRoot, 'noop.js'))('playwright');
  }
}

const font = (weight, file) => `@font-face { font-family: Pretendard; font-weight: ${weight}; src: url("${pathToFileURL(join(root, 'assets/fonts', file))}"); }`;
const css = `
${font(400, 'Pretendard-Regular.otf')} ${font(700, 'Pretendard-Bold.otf')} ${font(800, 'Pretendard-ExtraBold.otf')}
* { box-sizing: border-box; margin: 0; }
body { font-family: Pretendard, sans-serif; padding: 16px; display: inline-block; }
h1 { font-size: 15px; font-weight: 800; margin: 4px 0 10px; }
.grid { display: grid; gap: 0; }
.label { font-size: 11px; display: flex; align-items: center; }
.colhead { font-size: 10px; text-align: center; padding-bottom: 4px; }
img { display: block; }
.tile { display: flex; flex-direction: column; align-items: center; padding: 4px; border-radius: 10px; }
.header { position: relative; overflow: hidden; }
.header .t { position: absolute; left: 16px; top: 34px; font-size: 26px; font-weight: 800; letter-spacing: -0.3px; }
.header .s { position: absolute; left: 16px; top: 70px; font-size: 13px; }
.empty { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 300px; padding: 20px 0; }
.empty .t { font-size: 16px; font-weight: 700; } .empty .m { font-size: 13px; }
`;
const img = (svg, w, h) => `<img width="${w}" height="${h}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
const names = Object.keys(ILLUSTRATIONS);

function illustrationSheet(dark) {
  const accents = Object.keys(SAMPLE_ACCENTS);
  const page = sampleTheme('blue', dark);
  let html = `<h1>Illustrations · ${dark ? 'dark' : 'light'} · every accent (160×120)</h1>`;
  html += `<div class="grid" style="grid-template-columns: 56px repeat(${names.length}, 168px)">`;
  html += `<div></div>` + names.map((n) => `<div class="colhead" style="color:${page.textMuted}">${n} · ${nodeCount(ILLUSTRATIONS[n])}</div>`).join('');
  for (const a of accents) {
    const theme = sampleTheme(a, dark);
    const p = artPalette(theme);
    html += `<div class="label" style="color:${theme.textMuted}">${a}</div>`;
    html += names.map((n) => `<div class="tile">${img(toSvgString(ILLUSTRATIONS[n], p), 160, 120)}</div>`).join('');
  }
  return { html: html + '</div>', bg: page.background, fg: page.text };
}

const COPY = {
  EmptyToday: ['오늘 할 일을 모두 마쳤어요', '편히 쉬어요'], EmptyList: ['아직 할 일이 없어요', '+ 버튼으로 추가해 보세요'],
  EmptyUpcoming: ['다가오는 일정이 없어요', '여유로운 날들이에요'], EmptyHabits: ['아직 습관이 없어요', '작은 것부터 시작해요'],
  EmptyFocus: ['아직 집중 기록이 없어요', '25분부터 시작해 볼까요'], EmptySearch: ['검색 결과가 없어요', '다른 단어로 찾아보세요'],
  EmptyDone: ['아직 완료한 일이 없어요', '하나씩 끝내 봐요'], OfflineArt: ['불러오지 못했어요', '연결을 확인해 주세요'],
  AllDoneArt: ['오늘 다 끝냈어요!', '수고했어요'],
};

function detailSheet() {
  let html = `<h1>Detail · every piece at 2× (320×240), blue, light then dark</h1>`;
  for (const dark of [false, true]) {
    const t = sampleTheme('blue', dark);
    const p = artPalette(t);
    html += `<div style="display:grid; grid-template-columns: repeat(5, 330px); background:${t.background}; padding:8px">`
      + names.map((n) => `<div class="tile">${img(toSvgString(ILLUSTRATIONS[n], p, { width: 320, height: 240 }), 320, 240)}</div>`).join('')
      + `</div>`;
  }
  return { html, bg: '#888', fg: '#111' };
}

function contextSheet() {
  let html = `<h1>In context · empty states at 1.25× (200px), light + dark, blue / green / pink</h1>`;
  for (const a of ['blue', 'green', 'pink']) {
    html += `<div style="display:flex">`;
    for (const dark of [false, true]) {
      const t = sampleTheme(a, dark);
      const p = artPalette(t);
      html += `<div style="display:grid; grid-template-columns: repeat(5, 300px); background:${t.background}">`;
      for (const n of names.slice(0, 5)) {
        html += `<div class="empty">${img(toSvgString(ILLUSTRATIONS[n], p, { width: 200, height: 150 }), 200, 150)}`
          + `<div class="t" style="color:${t.text}">${COPY[n][0]}</div><div class="m" style="color:${t.textMuted}">${COPY[n][1]}</div></div>`;
      }
      html += `</div>`;
    }
    html += `</div><div style="display:flex">`;
    for (const dark of [false, true]) {
      const t = sampleTheme(a, dark);
      const p = artPalette(t);
      html += `<div style="display:grid; grid-template-columns: repeat(5, 300px); background:${t.background}">`;
      for (const n of names.slice(5)) {
        html += `<div class="empty">${img(toSvgString(ILLUSTRATIONS[n], p, { width: 200, height: 150 }), 200, 150)}`
          + `<div class="t" style="color:${t.text}">${COPY[n][0]}</div><div class="m" style="color:${t.textMuted}">${COPY[n][1]}</div></div>`;
      }
      html += `<div></div></div>`;
    }
    html += `</div>`;
  }
  return { html, bg: '#888', fg: '#111' };
}

function backdropSheet() {
  let html = `<h1>DayBackdrop · 4 variants × light/dark × blue/green/pink, at 360px; last rows at 320 and 480px</h1>`;
  const header = (t, variant, w) => {
    const p = artPalette(t);
    return `<div class="header" style="width:${w}px;height:${BACKDROP_H}px;background:${t.background}">`
      + img(toSvgString(BACKDROPS[variant], p, { width: w, height: BACKDROP_H, preserveAspectRatio: BACKDROP_ASPECT }), w, BACKDROP_H)
      + `<div class="t" style="color:${t.text}">오늘</div><div class="s" style="color:${t.textMuted}">11월 24일 화요일 · ${variant}</div></div>`;
  };
  for (const dark of [false, true]) {
    for (const a of ['blue', 'green', 'pink']) {
      const t = sampleTheme(a, dark);
      html += `<div style="display:flex; gap:8px; margin-bottom:8px">` + BACKDROP_VARIANTS.map((v) => header(t, v, 360)).join('') + `</div>`;
    }
  }
  for (const w of [320, 480]) {
    for (const dark of [false, true]) {
      const t = sampleTheme('blue', dark);
      html += `<div style="display:flex; gap:8px; margin-bottom:8px">` + BACKDROP_VARIANTS.map((v) => header(t, v, w)).join('') + `</div>`;
    }
  }
  return { html, bg: '#888', fg: '#111' };
}

mkdirSync(out, { recursive: true });
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 800, height: 600 } });
const sheets = {
  'illustrations-light.png': illustrationSheet(false),
  'illustrations-dark.png': illustrationSheet(true),
  'illustrations-detail.png': detailSheet(),
  'empty-states-in-context.png': contextSheet(),
  'backdrops.png': backdropSheet(),
};
for (const [file, { html, bg, fg }] of Object.entries(sheets)) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${css} body { background:${bg}; color:${fg}; }</style></head><body>${html}</body></html>`;
  writeFileSync(join(out, file.replace('.png', '.html')), doc);
  await page.setContent(doc, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('body').screenshot({ path: join(out, file) });
  console.log(join(out, file));
}
await browser.close();

console.log('\nnode counts (incl. root <Svg>):');
for (const n of names) console.log(`  ${n.padEnd(14)} ${nodeCount(ILLUSTRATIONS[n])}`);
for (const v of BACKDROP_VARIANTS) console.log(`  DayBackdrop/${v.padEnd(10)} ${nodeCount(BACKDROPS[v])}`);
