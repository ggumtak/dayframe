// Draws the pictures Android shows in its widget picker (assets/widgets/*.webp), one per widget in
// app.config.ts. They mirror src/features/widget/widgets.tsx with sample data and the calm DESIGN.md budget,
// so redraw them when a widget's layout changes:
//
//   node scripts/widget-previews.mjs
//
// Needs Playwright with Chromium and sharp (`npx playwright install chromium`, `npm i --no-save sharp`).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets/widgets');
const font = (weight, file) => `@font-face { font-family: Pretendard; font-weight: ${weight}; src: url("${pathToFileURL(join(root, 'assets/fonts', file))}"); }`;

// The calm light palette of widgets.tsx (DESIGN.md: <= 2 hues, neutral rings, red only for overdue).
const c = {
  background: '#FFFFFF', text: '#1D2129', muted: '#5C6675', faint: '#858E9C', control: '#868E9C',
  accent: '#2B66E0', onAccent: '#FFFFFF', danger: '#CC3A2E', border: '#E6E9EE', track: '#F3F5F8',
};

const css = `
${font(400, 'Pretendard-Regular.otf')} ${font(600, 'Pretendard-SemiBold.otf')} ${font(700, 'Pretendard-Bold.otf')} ${font(800, 'Pretendard-ExtraBold.otf')}
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; font-family: Pretendard, sans-serif; color: ${c.text}; }
.frame { background: ${c.background}; border-radius: 20px; padding: 12px 0 6px; overflow: hidden; display: flex; flex-direction: column;
  border: 1px solid ${c.border}; }
.header-wrap { padding: 0 16px 6px; }
.header { display: flex; align-items: center; }
.header .title { font-size: 17px; font-weight: 800; line-height: 22px; }
.header .sub { font-size: 12px; color: ${c.muted}; margin-top: 1px; line-height: 16px; }
.bar-track { height: 4px; background: ${c.track}; border-radius: 2px; margin-top: 6px; overflow: hidden; }
.bar-fill { height: 4px; background: ${c.accent}; border-radius: 2px; }
.plus { width: 32px; height: 32px; border-radius: 16px; background: ${c.accent}; margin-left: 6px; position: relative; flex: none; }
.plus::before, .plus::after { content: ''; position: absolute; background: #fff; border-radius: 2px; left: 9px; top: 14.8px; width: 14px; height: 2.4px; }
.plus::after { transform: rotate(90deg); }
.refresh { width: 22px; height: 22px; margin-left: auto; flex: none; display: flex; align-items: center; justify-content: center; }
.row { display: flex; align-items: center; min-height: 44px; padding: 0 16px 0 8px; }
.row .mark { width: 40px; display: flex; justify-content: center; flex: none; }
.row .body { flex: 1; min-height: 44px; padding: 6px 0; display: flex; align-items: center; border-bottom: 1px solid ${c.border}; min-width: 0; }
.row .name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .meta { font-size: 11px; color: ${c.faint}; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .when { font-size: 12px; color: ${c.muted}; margin-left: 8px; white-space: nowrap; }
.ring { width: 18px; height: 18px; border-radius: 9px; border: 2px solid ${c.control}; }
.day { font-size: 11px; font-weight: 700; color: ${c.muted}; padding: 8px 16px 2px; }
`;

const refreshSvg = `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v3.8h-3.8" fill="none" stroke="${c.faint}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const header = (title, sub, add, ratio = null) =>
  `<div class="header-wrap"><div class="header"><div style="flex:1"><div class="title">${title}</div><div class="sub">${sub}</div></div>`
  + `<div class="refresh">${refreshSvg}</div>${add ? '<div class="plus"></div>' : ''}</div>`
  + (ratio !== null ? `<div class="bar-track"><div class="bar-fill" style="width:${Math.round(ratio * 100)}%"></div></div>` : '') + `</div>`;
const task = (name, when, meta = '', late = false) =>
  `<div class="row"><div class="mark"><div class="ring" style="${late ? 'border-color:' + c.danger : ''}"></div></div><div class="body"><div style="flex:1;min-width:0"><div class="name">${name}</div>`
  + (meta ? `<div class="meta">${meta}</div>` : '') + `</div>`
  + (when ? `<div class="when" style="${late ? 'color:' + c.danger + ';font-weight:600' : ''}">${when}</div>` : '') + '</div></div>';
const progress = (ratio) => {
  if (ratio >= 1) {
    return `<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${c.accent}"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  const length = 2 * Math.PI * 9;
  return `<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${c.control}" stroke-width="1.5"/>`
    + (ratio ? `<circle cx="12" cy="12" r="9" fill="none" stroke="${c.accent}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="${length * ratio} ${length}" transform="rotate(-90 12 12)"/>` : '') + '</svg>';
};
const habit = (name, label, ratio) =>
  `<div class="row" style="height:46px"><div class="mark">${progress(ratio)}</div><div class="body" style="height:46px"><div class="name" style="${ratio >= 1 ? 'color:' + c.muted : ''}">${name}</div>`
  + `<div class="when" style="${ratio >= 1 ? 'color:' + c.faint : ''}">${label}</div></div></div>`;

function calendar() {
  const dots = new Set([3, 9, 12, 17, 23, 24, 25, 27, 30]);
  const cells = [...Array(6).fill(0), ...Array.from({ length: 30 }, (_, index) => index + 1)];
  while (cells.length % 7) cells.push(0);
  const names = ['월', '화', '수', '목', '금', '토', '일'];
  const head = names.map((name) => `<div style="flex:1;text-align:center;font-size:11px;padding:2px 0;color:${c.faint}">${name}</div>`).join('');
  const rows = [];
  for (let at = 0; at < cells.length; at += 7) {
    rows.push('<div style="display:flex;flex:1">' + cells.slice(at, at + 7).map((day) => {
      if (!day) return '<div style="flex:1"></div>';
      const today = day === 23;
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center">`
        + `<div style="width:26px;height:26px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:13px;`
        + `font-weight:${today || dots.has(day) ? 700 : 400};background:${today ? c.text : 'transparent'};color:${today ? '#fff' : c.text}">${day}</div>`
        + `<div style="width:4px;height:4px;border-radius:2px;margin-top:1px;background:${dots.has(day) ? c.muted : 'transparent'}"></div></div>`;
    }).join('') + '</div>');
  }
  const arrow = (path, color) => `<svg width="24" height="24" viewBox="0 0 24 24" style="margin:0 4px"><path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<div class="header" style="padding:0 8px 4px 16px"><div class="title" style="flex:1">11월</div>${arrow('M14 6l-6 6 6 6', c.text)}`
    + `<div style="width:7px;height:7px;border-radius:4px;background:${c.muted};margin:0 6px"></div>${arrow('M10 6l6 6-6 6', c.text)}</div>`
    + `<div style="flex:1;display:flex;flex-direction:column;padding:0 8px"><div style="display:flex">${head}</div>${rows.join('')}</div>`;
}

const button = (label, primary) =>
  `<div style="flex:1;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;`
  + `background:${primary ? c.accent : c.track};color:${primary ? '#fff' : c.text}">${label}</div>`;

const quickIcon = (body) =>
  `<div style="width:36px;height:36px;border-radius:18px;background:${c.track};display:flex;align-items:center;justify-content:center;margin-left:6px;flex:none">`
  + `<svg width="18" height="18" viewBox="0 0 24 24">${body}</svg></div>`;

const widgets = [
  { name: 'today', width: 340, height: 214, body: header('오늘', '11월 23일 (월) · 오늘 2/4 완료', true, 0.5)
    + task('!!! 분기 보고서 제출', '어제', '#업무 · 2/3', true)
    + task('!! 팀 회의 준비', '오후 2:00', '#업무')
    + task('장보기', '오후 7:00', '#개인') },
  { name: 'upcoming', width: 340, height: 204, body: header('예정', '앞으로 7일 · 2개', true)
    + '<div class="day" style="padding-top:2px">내일 · 11월 24일 · 1</div>' + task('치과 예약', '오전 10:00', '#개인')
    + '<div class="day">수요일 · 11월 25일 · 1</div>' + task('!! 분기 계획 초안', '', '#업무') },
  { name: 'habits', width: 340, height: 214, body: header('습관', '오늘 1/3 달성', true, 1 / 3)
    + habit('물 2L 마시기', '2/4', 0.5) + habit('책 20분 읽기', '0/1', 0) + habit('30분 걷기', '달성 · 1/1', 1) },
  { name: 'calendar', width: 340, height: 340, body: calendar() },
  { name: 'focus', width: 190, height: 170, body: `<div class="header-wrap"><div class="header"><div><div class="title">집중</div><div class="sub">오늘 2회 · 50분</div></div></div></div>`
    + `<div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:0 14px 8px"><div style="flex:1;display:flex;align-items:center;font-size:19px;font-weight:700">뽀모도로</div>`
    + `<div style="display:flex;gap:6px">${button('15분', false)}${button('25분', true)}${button('50분', false)}</div></div>` },
  { name: 'quickadd', width: 340, height: 60, plain: true, body: `<div style="display:flex;align-items:center;height:100%;padding:0 10px"><div class="plus" style="margin:0"></div>`
    + `<div style="margin-left:10px;flex:1;min-width:0"><div style="font-size:14px;font-weight:700;line-height:19px">할 일 빠른 추가</div><div style="font-size:11px;color:${c.faint};line-height:15px">예: 금요일 3시 회의 #업무 !!!</div></div>`
    + quickIcon(`<circle cx="11" cy="11" r="6.5" fill="none" stroke="${c.muted}" stroke-width="2"/><path d="M16 16l4 4" stroke="${c.muted}" stroke-width="2" stroke-linecap="round"/>`)
    + quickIcon(`<circle cx="12" cy="12" r="8" fill="none" stroke="${c.muted}" stroke-width="2"/><path d="M12 8v4l2.8 1.8" fill="none" stroke="${c.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`)
    + `</div>` },
];

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 3 });
const sheet = join(out, '.preview.html');
for (const widget of widgets) {
  await page.setViewportSize({ width: widget.width, height: widget.height });
  writeFileSync(sheet, `<meta charset="utf-8"><style>${css}</style><div class="frame" style="width:${widget.width}px;height:${widget.height}px;${widget.plain ? 'padding:0' : ''}">${widget.body}</div>`);
  await page.goto(pathToFileURL(sheet).href);
  await page.evaluate(() => document.fonts.ready);
  if (!(await page.evaluate(() => document.fonts.check('15px Pretendard')))) throw new Error('Pretendard did not load');
  const png = await page.screenshot({ omitBackground: true });
  await sharp(png).webp({ lossless: true, effort: 6 }).toFile(join(out, widget.name + '.webp'));
  console.log('drew', widget.name);
}
rmSync(sheet);
await browser.close();
