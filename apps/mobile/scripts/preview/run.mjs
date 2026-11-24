#!/usr/bin/env node
// Preview harness: screenshots of the signed-in app with sample data, without a phone, an account or the
// backend. See README.md in this folder.
//
//   node scripts/preview/run.mjs [--out <dir>] [--only <name,name>] [--dark] [--skip-build] [--shots <file.mjs>]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fakeSession } from './fixtures.mjs';
import { handleAnthropic, isAnthropicMessages } from './mock-anthropic.mjs';
import { createMockApi, isApiPath, isAuthPath } from './mock-api.mjs';
import { serve } from './server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../..');
// Kept under node_modules/.cache: ignored by git and ESLint, and not cleared by a plain `expo export` into dist/.
const buildDir = join(appRoot, 'node_modules/.cache/dayframe-preview-web');
// Baked into the preview build instead of the real project, so nothing the page does can reach it.
const FAKE_SUPABASE_URL = 'https://preview-backend.invalid';
const AUTH_STORAGE_KEY = 'dayframe-auth'; // src/lib/auth.ts
const VIEWPORT = { width: 412, height: 915 };

function parseArgs(argv) {
  const args = { out: null, only: null, dark: false, skipBuild: false, shots: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--shots') args.shots = argv[++i];
    else if (arg === '--dark') args.dark = true;
    else if (arg === '--skip-build') args.skipBuild = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('node scripts/preview/run.mjs [--out <dir>] [--only <name,name>] [--dark] [--skip-build] [--shots <file.mjs>]');
      process.exit(0);
    } else {
      console.error('Unknown argument: ' + arg);
      process.exit(2);
    }
  }
  return args;
}

function build() {
  console.log('Building the web export into ' + relative(appRoot, buildDir) + ' ...');
  const started = Date.now();
  const result = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', buildDir], {
    cwd: appRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: FAKE_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_KEY: 'preview-anon-key', CI: '1' },
  });
  if (result.status !== 0) {
    console.error((result.stdout ?? '') + (result.stderr ?? ''));
    throw new Error('expo export failed (exit ' + result.status + ')');
  }
  console.log(`Built in ${Math.round((Date.now() - started) / 1000)}s.`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    // A global install is not on the ESM resolution path; fall back to require, which honours NODE_PATH.
    return createRequire(import.meta.url)('playwright');
  }
}

/** Waits until no request has been in flight for `quietMs`, or `timeoutMs` passes. */
async function networkQuiet(inflight, quietMs = 500, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  let quietSince = inflight.size === 0 ? Date.now() : null;
  while (Date.now() < end) {
    if (inflight.size === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) return true;
    } else quietSince = null;
    await sleep(50);
  }
  return false;
}

async function settle(page, inflight) {
  await networkQuiet(inflight);
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
  await sleep(400); // entrance animations
  await networkQuiet(inflight, 300);
}

async function runStep(page, step) {
  const visible = (locator) => locator.filter({ visible: true }).first();
  if (step.click?.text !== undefined) return visible(page.getByText(step.click.text)).click({ timeout: 5000 });
  if (step.click?.label !== undefined) {
    return visible(page.locator(`[aria-label="${step.click.label.replaceAll('"', '\\"')}"]`)).click({ timeout: 5000 });
  }
  if (step.press !== undefined) return page.keyboard.press(step.press);
  if (step.hold?.text !== undefined) {
    // Long press: hold the pointer on the first visible text match (for long-press menus).
    const box = await visible(page.getByText(step.hold.text)).boundingBox({ timeout: 5000 });
    if (!box) throw new Error('hold target has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await sleep(step.hold.ms ?? 900);
    return page.mouse.up();
  }
  if (step.fill) {
    const { label, value } = step.fill;
    const byLabel = page.locator(`[aria-label="${label.replaceAll('"', '\\"')}"]`).filter({ visible: true });
    const target = (await byLabel.count()) ? byLabel.first() : visible(page.getByPlaceholder(label));
    return target.fill(value, { timeout: 5000 });
  }
  if (step.drag) {
    // Horizontal drag from the first visible match (text or accessibility label), e.g. a task row's swipe actions.
    // The finger stays down unless `release` is set, so the shot shows the row mid-swipe.
    const { text, label, dx, dy = 0, steps = 12, release = false } = step.drag;
    const target = label !== undefined ? page.locator(`[aria-label="${label.replaceAll('"', '\\"')}"]`) : page.getByText(text);
    const box = await visible(target).boundingBox({ timeout: 5000 });
    if (!box) throw new Error('drag target has no box');
    const width = page.viewportSize()?.width ?? VIEWPORT.width;
    const x = Math.min(Math.max(box.x + box.width / 2, 40), width - 40);
    const y = box.y + box.height / 2;
    // A touch drag (CDP), as on a phone: a mouse release would also count as a tap on the row on web.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, px, py) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await touch('touchStart', x, y);
    for (let i = 1; i <= steps; i += 1) {
      await touch('touchMove', x + (dx * i) / steps, y + (dy * i) / steps);
      await sleep(16);
    }
    if (release) await touch('touchEnd');
    return;
  }
  if (step.wait !== undefined) return sleep(step.wait);
  if (step.scroll !== undefined) {
    const scrolled = await page.evaluate((px) => {
      // The tallest visible scrollable element is the screen's main list.
      const candidates = [...document.querySelectorAll('*')].filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight && rect.width > 0 && rect.height > 0
          && rect.bottom > 0 && rect.top < innerHeight;
      });
      candidates.sort((a, b) => b.clientHeight - a.clientHeight);
      if (!candidates[0]) return false;
      candidates[0].scrollBy(0, px);
      return true;
    }, step.scroll);
    if (!scrolled) await page.mouse.wheel(0, step.scroll);
    return;
  }
  throw new Error('Unknown step: ' + JSON.stringify(step));
}

async function takeShot(browser, baseUrl, shot, options) {
  const { api, outDir, dark } = options;
  const log = { consoleErrors: [], pageErrors: [], aborted: [], unknownRoutes: [], mockErrors: [], anthropic: [] };
  api.reset();
  const context = await browser.newContext({
    viewport: shot.viewport ?? VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    colorScheme: dark ? 'dark' : 'light',
  });
  try {
    const session = JSON.stringify(fakeSession());
    // The shot's `storage` (key → string) seeds what the app keeps on the device, e.g. list colours and habit looks.
    const seed = [[AUTH_STORAGE_KEY, session], ...Object.entries(shot.storage ?? {})];
    await context.addInitScript((entries) => {
      try {
        for (const [key, value] of entries) window.localStorage.setItem(key, value);
      } catch {
        // storage unavailable: the app will show sign-in and the shot reports it
      }
    }, seed);

    const cors = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*',
    };
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.startsWith(baseUrl + '/') || url === baseUrl) return route.continue();
      let pathname = '';
      try {
        pathname = new URL(url).pathname;
      } catch {
        // not a URL we can parse: abort below
      }
      // The AI 비서 screens call the Claude API directly; answer from mock-anthropic.mjs, never the real host.
      if (isAnthropicMessages(url)) {
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        let body;
        try {
          body = request.postDataJSON() ?? undefined;
        } catch {
          body = undefined;
        }
        const result = handleAnthropic(request.method(), await request.allHeaders(), body, log.anthropic);
        return route.fulfill({ status: result.status, headers: cors, contentType: 'application/json', body: JSON.stringify(result.json) });
      }
      if (isApiPath(pathname) || isAuthPath(pathname)) {
        const method = request.method();
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        let body;
        try {
          body = request.postDataJSON() ?? undefined;
        } catch {
          body = undefined;
        }
        let result;
        try {
          result = api.handle(method, url, body);
        } catch (error) {
          // A bug in the mock must not stop the run: answer 500 and report it.
          log.mockErrors.push(`${method} ${pathname}: ${String(error?.message ?? error)}`);
          return route.fulfill({ status: 500, headers: cors, contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'SERVER', message: 'Preview mock failed' } }) });
        }
        if (!result) {
          log.unknownRoutes.push(`${method} ${pathname}`);
          return route.fulfill({ status: 404, headers: cors, contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found (preview mock)' } }) });
        }
        return route.fulfill({ status: result.status, headers: cors, contentType: 'application/json',
          body: result.json === undefined ? '' : JSON.stringify(result.json) });
      }
      log.aborted.push(`${request.method()} ${url}`);
      return route.abort('blockedbyclient');
    });

    const page = await context.newPage();
    const inflight = new Set();
    page.on('request', (r) => inflight.add(r));
    page.on('requestfinished', (r) => inflight.delete(r));
    page.on('requestfailed', (r) => inflight.delete(r));
    page.on('console', (message) => {
      if (message.type() === 'error') log.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => log.pageErrors.push(String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ')));

    await page.goto(baseUrl + shot.path, { waitUntil: 'load', timeout: 30_000 });
    // The app renders an empty view while the session loads; wait for real content.
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 20_000 }).catch(() => {});
    await settle(page, inflight);
    for (const [index, step] of (shot.steps ?? []).entries()) {
      try {
        // `{ snap: 'a' }` saves `<name>-a.png` mid-shot; a step with `noSettle` is followed at once by the next.
        if (step.snap !== undefined) await page.screenshot({ path: join(outDir, `${shot.name}-${step.snap}.png`) });
        else await runStep(page, step);
      } catch (error) {
        throw new Error(`step ${index + 1} ${JSON.stringify(step)}: ${String(error.message ?? error).split('\n')[0]}`);
      }
      if (!step.noSettle && step.snap === undefined) await settle(page, inflight);
    }

    const file = join(outDir, shot.name + '.png');
    await page.screenshot({ path: file });
    const finalPath = new URL(page.url()).pathname;
    const text = await page.evaluate(() => document.body.innerText.trim());
    const problems = [];
    if (finalPath === '/sign-in' && shot.path !== '/sign-in') problems.push('landed on the sign-in screen');
    if (!text) problems.push('page is blank');
    return { ok: problems.length === 0, error: problems.join('; ') || null, file, finalPath, log };
  } catch (error) {
    return { ok: false, error: String(error.message ?? error).split('\n')[0], file: null, finalPath: null, log };
  } finally {
    await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shotsFile = args.shots ? resolve(process.cwd(), args.shots) : join(here, 'shots.mjs');
  const allShots = (await import(pathToFileURL(shotsFile).href)).default;
  const outDir = resolve(appRoot, args.out ?? join('scripts/preview/out', args.dark ? 'dark' : ''));
  const shots = args.only ? allShots.filter((shot) => args.only.includes(shot.name)) : allShots;
  if (args.only) {
    const missing = args.only.filter((name) => !allShots.some((shot) => shot.name === name));
    if (missing.length) {
      console.error('Unknown shot(s): ' + missing.join(', ') + '. Known: ' + allShots.map((s) => s.name).join(', '));
      process.exit(2);
    }
  }

  if (!args.skipBuild) build();
  if (!existsSync(join(buildDir, 'index.html'))) {
    console.error('No web build at ' + buildDir + '. Run without --skip-build first.');
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });

  const { chromium } = await loadPlaywright();
  const server = await serve(buildDir);
  const browser = await chromium.launch();
  const api = createMockApi();
  const results = [];
  try {
    for (const shot of shots) {
      process.stdout.write(`- ${shot.name} (${shot.path}) ... `);
      const result = await takeShot(browser, server.url, shot, { api, outDir, dark: args.dark });
      console.log(result.ok ? 'ok' : 'FAILED: ' + result.error);
      results.push({ shot, ...result });
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.log('\nScreenshots: ' + outDir + (args.dark ? ' (dark)' : ''));
  const rows = results.map(({ shot, ok, log, error }) => [shot.name, shot.path, ok ? 'ok' : 'FAILED',
    String(log.consoleErrors.length), String(log.pageErrors.length), String(log.unknownRoutes.length), String(log.mockErrors.length), String(log.aborted.length),
    error ?? '']);
  const header = ['shot', 'path', 'result', 'console err', 'page err', 'unknown api', 'mock err', 'blocked', 'note'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));

  for (const { shot, log } of results) {
    const sections = [
      ['page errors', log.pageErrors], ['console errors', log.consoleErrors],
      ['unknown API routes (answered 404)', log.unknownRoutes], ['mock errors (answered 500)', log.mockErrors], ['blocked requests', log.aborted],
      ['mocked Claude API requests', log.anthropic.map((entry) => JSON.stringify(entry))],
    ].filter(([, list]) => list.length);
    if (!sections.length) continue;
    console.log(`\n[${shot.name}]`);
    for (const [title, list] of sections) {
      console.log('  ' + title + ':');
      for (const item of [...new Set(list)]) console.log('    ' + item.slice(0, 400));
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} shots ok.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
