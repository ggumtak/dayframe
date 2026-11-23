// Draws the pictures Android shows in its widget picker (assets/widgets/*.png), one per widget in
// app.config.ts. They mirror src/features/widget/widgets.tsx with sample data, so redraw them when a
// widget's layout changes:
//
//   node scripts/widget-previews.mjs
//
// Needs Playwright with Chromium, which is not one of the app's dependencies (`npx playwright install chromium`).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets/widgets');
const font = (weight, file) => `@font-face { font-family: Pretendard; font-weight: ${weight}; src: url("${pathToFileURL(join(root, 'assets/fonts', file))}"); }`;

// The light palette of widgets.tsx.
const c = {
  background: '#FFFFFF', text: '#1D2129', muted: '#667085', faint: '#A4ACB9', accent: '#3574F0', accentSoft: '#E8F0FE',
  danger: '#DC4C3E', warning: '#E5870B', success: '#1F9D63', border: '#E6E9EE', track: '#F3F5F8',
};

const css = `
${font(400, 'Pretendard-Regular.otf')} ${font(600, 'Pretendard-SemiBold.otf')} ${font(700, 'Pretendard-Bold.otf')} ${font(800, 'Pretendard-ExtraBold.otf')}
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; font-family: Pretendard, sans-serif; color: ${c.text}; }
.frame { background: ${c.background}; border-radius: 20px; padding: 12px 0 6px; overflow: hidden; display: flex; flex-direction: column;
  border: 1px solid ${c.border}; }
.header { display: flex; align-items: center; padding: 0 16px 8px; }
.header .title { font-size: 17px; font-weight: 800; line-height: 22px; }
.header .sub { font-size: 12px; color: ${c.muted}; margin-top: 1px; line-height: 16px; }
.plus { width: 32px; height: 32px; border-radius: 16px; background: ${c.accent}; margin-left: auto; position: relative; flex: none; }
.plus::before, .plus::after { content: ''; position: absolute; background: #fff; border-radius: 2px; left: 9px; top: 14.8px; width: 14px; height: 2.4px; }
.plus::after { transform: rotate(90deg); }
.row { display: flex; align-items: center; height: 44px; padding: 0 16px 0 8px; }
.row .mark { width: 40px; display: flex; justify-content: center; flex: none; }
.row .body { flex: 1; height: 44px; display: flex; align-items: center; border-bottom: 1px solid ${c.border}; min-width: 0; }
.row .name { flex: 1; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .when { font-size: 12px; color: ${c.muted}; margin-left: 8px; white-space: nowrap; }
.ring { width: 18px; height: 18px; border-radius: 9px; border: 2px solid ${c.faint}; }
.bar { width: 4px; height: 18px; border-radius: 2px; background: ${c.faint}; margin: 0 12px 0 8px; flex: none; }
.day { font-size: 12px; font-weight: 700; color: ${c.accent}; padding: 10px 16px 2px; }
`;

const header = (title, sub, add) => `<div class="header"><div><div class="title">${title}</div><div class="sub">${sub}</div></div>${add ? '<div class="plus"></div>' : ''}</div>`;
const task = (name, when, color = c.faint, late = false) =>
  `<div class="row"><div class="mark"><div class="ring" style="border-color:${color}"></div></div><div class="body"><div class="name">${name}</div>`
  + (when ? `<div class="when" style="${late ? 'color:' + c.danger : ''}">${when}</div>` : '') + '</div></div>';
const planned = (name, when, color = c.faint) =>
  `<div class="row" style="padding-left:8px"><div class="bar" style="background:${color}"></div><div class="body"><div class="name">${name}</div>`
  + (when ? `<div class="when">${when}</div>` : '') + '</div></div>';
const progress = (ratio) => {
  if (ratio >= 1) {
    return `<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${c.success}"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  const length = 2 * Math.PI * 9;
  return `<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${c.track}" stroke-width="2.6"/>`
    + (ratio ? `<circle cx="12" cy="12" r="9" fill="none" stroke="${c.success}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="${length * ratio} ${length}" transform="rotate(-90 12 12)"/>` : '') + '</svg>';
};
const habit = (name, label, ratio) =>
  `<div class="row" style="height:46px"><div class="mark">${progress(ratio)}</div><div class="body" style="height:46px"><div class="name">${name}</div>`
  + `<div class="when" style="${ratio >= 1 ? 'color:' + c.success : ''}">${label}</div></div></div>`;

function calendar() {
  // November 2026 starts on a Sunday; the 23rd is "today".
  const dots = new Set([3, 9, 12, 17, 23, 24, 25, 27, 30]);
  const cells = [...Array(6).fill(0), ...Array.from({ length: 30 }, (_, index) => index + 1)];
  while (cells.length % 7) cells.push(0);
  const names = ['월', '화', '수', '목', '금', '토', '일'];
  const tone = (column) => (column === 6 ? c.danger : column === 5 ? c.accent : null);
  const head = names.map((name, column) => `<div style="flex:1;text-align:center;font-size:11px;padding:2px 0;color:${tone(column) ?? c.faint}">${name}</div>`).join('');
  const rows = [];
  for (let at = 0; at < cells.length; at += 7) {
    rows.push('<div style="display:flex;flex:1">' + cells.slice(at, at + 7).map((day, column) => {
      if (!day) return '<div style="flex:1"></div>';
      const today = day === 23;
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center">`
        + `<div style="width:26px;height:26px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:13px;`
        + `font-weight:${today || dots.has(day) ? 700 : 400};background:${today ? c.accent : 'transparent'};color:${today ? '#fff' : tone(column) ?? c.text}">${day}</div>`
        + `<div style="width:4px;height:4px;border-radius:2px;margin-top:1px;background:${dots.has(day) ? c.accent : 'transparent'}"></div></div>`;
    }).join('') + '</div>');
  }
  const arrow = (path, color) => `<svg width="24" height="24" viewBox="0 0 24 24" style="margin:0 4px"><path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<div class="header" style="padding:0 8px 4px 16px"><div class="title" style="flex:1">2026년 11월</div>${arrow('M14 6l-6 6 6 6', c.text)}`
    + `<div style="width:7px;height:7px;border-radius:4px;background:${c.accent};margin:0 6px"></div>${arrow('M10 6l6 6-6 6', c.text)}</div>`
    + `<div style="flex:1;display:flex;flex-direction:column;padding:0 8px"><div style="display:flex">${head}</div>${rows.join('')}</div>`;
}

const button = (label, primary) =>
  `<div style="flex:1;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;`
  + `background:${primary ? c.accent : c.accentSoft};color:${primary ? '#fff' : c.accent}">${label}</div>`;

const widgets = [
  { name: 'today', width: 340, height: 196, body: header('오늘', '11월 23일 월요일 · 3개', true)
    + task('주간 보고서 제출', '어제', c.danger, true) + task('팀 회의 준비', '오후 2:00', c.warning) + task('장보기', '오후 7:00') },
  { name: 'upcoming', width: 340, height: 196, body: header('예정', '앞으로 7일 · 2개', true)
    + '<div class="day" style="padding-top:2px">내일 · 11월 24일 화</div>' + planned('치과 예약', '오전 10:00')
    + '<div class="day">수요일 · 11월 25일</div>' + planned('분기 계획 초안', '', c.warning) },
  { name: 'habits', width: 340, height: 204, body: header('습관', '오늘 1/3 달성', false)
    + habit('30분 걷기', '완료', 1) + habit('물 2L 마시기', '2/4회', 0.5) + habit('책 20분 읽기', '0/1회', 0) },
  { name: 'calendar', width: 340, height: 340, body: calendar() },
  { name: 'focus', width: 170, height: 170, body: header('집중', '오늘 2회 · 50분', false)
    + `<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:0 14px 8px"><div style="flex:1;display:flex;align-items:center;font-size:20px;font-weight:700">뽀모도로</div>`
    + `<div style="display:flex;gap:8px">${button('25분', true)}${button('50분', false)}</div></div>` },
  { name: 'quickadd', width: 340, height: 60, plain: true, body: `<div style="display:flex;align-items:center;height:100%;padding:0 10px"><div class="plus" style="margin:0"></div>`
    + `<div style="margin-left:10px"><div style="font-size:15px;font-weight:600;line-height:20px">할 일 추가</div><div style="font-size:12px;color:${c.faint};line-height:16px">예: 내일 7시 운동 #건강</div></div></div>` },
];

const { chromium } = createRequire(import.meta.url)('playwright');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 3 });
const sheet = join(out, '.preview.html');
for (const widget of widgets) {
  await page.setViewportSize({ width: widget.width, height: widget.height });
  // Loaded from a file, since a blank page may not read the bundled fonts from disk.
  writeFileSync(sheet, `<meta charset="utf-8"><style>${css}</style><div class="frame" style="width:${widget.width}px;height:${widget.height}px;${widget.plain ? 'padding:0' : ''}">${widget.body}</div>`);
  await page.goto(pathToFileURL(sheet).href);
  await page.evaluate(() => document.fonts.ready);
  if (!(await page.evaluate(() => document.fonts.check('15px Pretendard')))) throw new Error('Pretendard did not load');
  await page.screenshot({ path: join(out, widget.name + '.png'), omitBackground: true });
  console.log('drew', widget.name);
}
rmSync(sheet);
await browser.close();
