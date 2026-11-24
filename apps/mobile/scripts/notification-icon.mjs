// Draws the Android status-bar notification icon (assets/images/notification-icon.png) from the SVG below.
//
//   node scripts/notification-icon.mjs                     # writes the PNG
//   node scripts/notification-icon.mjs --preview <file>    # also a sheet at 24, 48 and 96 px on dark and light bars
//
// Android draws a notification's small icon as a silhouette of its alpha channel (white on a dark status bar, grey
// on a light one, the plugin's `color` in the shade), so the icon is a white glyph on a transparent background.
// It is the app icon's mark (rounded square + check, android-icon-monochrome.png) on a 24 dp grid: 96 px = 4 px per
// dp, the mark filling 20 dp with 2 dp padding and strokes of about 2.5 dp so it still reads at 24 dp. expo-notifications
// scales it to 24 dp per density (mdpi 24 px ... xxxhdpi 96 px).
// Needs Playwright with Chromium (not an app dependency).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, '../assets/images/notification-icon.png');
const SIZE = 96;

// 96 × 96: the square spans 8..88 (2 dp padding). Stroke 10 (2.5 dp) is centred on the path, so the outer edge
// sits exactly on the padding line. Corner radius and check proportions follow the app icon.
export const NOTIFICATION_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="13" y="13" width="70" height="70" rx="18" fill="none" stroke="#fff" stroke-width="10"/>
  <path d="M32 49.5 L43.5 61 L64.5 36" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(join(globalRoot, 'noop.js'))('playwright');
  }
}

const dataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// A status bar draws the icon's alpha in one colour; a CSS mask does the same here.
function previewHtml(pngUrl) {
  const bars = [
    { name: 'dark status bar', bg: '#15171A', ink: '#E8EAED' },
    { name: 'light status bar', bg: '#F3F5F8', ink: '#1D2129' },
    { name: 'shade (plugin color)', bg: '#FFFFFF', ink: '#2B66E0' },
  ];
  const cell = (ink, px) => `<div style="width:${px}px;height:${px}px;background:${ink};-webkit-mask:url(${pngUrl}) center/contain no-repeat"></div>`;
  const rows = bars.map(({ name, bg, ink }) => `
    <div class="row" style="background:${bg};color:${ink}">
      <span class="label">${name}</span>
      ${[24, 48, 96].map((px) => `<div class="cell">${cell(ink, px)}<span>${px}px</span></div>`).join('')}
      <div class="cell"><div class="bar">12:30 ${cell(ink, 24)}${cell(ink, 24)}</div><span>beside a clock</span></div>
    </div>`).join('');
  return `<!doctype html><html><head><style>
    body { margin: 0; font: 12px system-ui, sans-serif; display: inline-block; }
    .row { display: flex; align-items: center; gap: 28px; padding: 18px 24px; }
    .label { width: 150px; }
    .cell { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .bar { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; }
    .grid { background: repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0/16px 16px; }
  </style></head><body>${rows}
    <div class="row grid"><span class="label">96 px on transparency</span><img src="${pngUrl}" width="96" height="96"></div>
  </body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  const previewAt = args.includes('--preview') ? resolve(args[args.indexOf('--preview') + 1]) : null;
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
      <img src="${dataUrl(NOTIFICATION_ICON_SVG)}" width="${SIZE}" height="${SIZE}" style="display:block"></body></html>`);
    await page.waitForFunction(() => document.images[0]?.complete);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
    writeFileSync(output, png);
    console.log('Wrote ' + output);

    if (previewAt) {
      const sheet = await browser.newPage({ viewport: { width: 900, height: 200 }, deviceScaleFactor: 1 });
      await sheet.setContent(previewHtml('data:image/png;base64,' + png.toString('base64')));
      await sheet.waitForFunction(() => [...document.images].every((img) => img.complete));
      await sheet.locator('body').screenshot({ path: previewAt });
      console.log('Wrote ' + previewAt);
    }
  } finally {
    await browser.close();
  }
}

await main();
