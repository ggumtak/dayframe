# Preview harness

Screenshots of the signed-in app with realistic sample data, taken from the web build in a phone-sized
Chromium. No phone, no account and no backend are involved: the session is faked and every API call is
answered from an in-memory fixture store.

## Run

From `apps/mobile`:

```sh
node scripts/preview/run.mjs              # build the web export, then take every shot
npm run preview                           # same thing
node scripts/preview/run.mjs --dark       # dark color scheme (system theme follows it)
node scripts/preview/run.mjs --skip-build --only today,task-detail
node scripts/preview/run.mjs --out /tmp/shots
node scripts/preview/run.mjs --shots my-shots.mjs   # a different shot list (same format as shots.mjs)
```

- PNGs land in `scripts/preview/out/<name>.png` (`scripts/preview/out/dark/` with `--dark`). The folder is git-ignored.
- The web build goes to `node_modules/.cache/dayframe-preview-web` (ignored by git and ESLint). `--skip-build`
  reuses it, so pass it only when the app source has not changed since the last build.
- Needs `node_modules` installed and Playwright with Chromium available to Node (`import('playwright')`).
  Playwright is not an app dependency.
- The run prints a table per shot: result, console errors, page errors, API routes the mock does not know
  (answered 404), mock failures (answered 500), and requests that were blocked. Details follow the table.
  A shot fails when a step fails, the page is blank or it ended on the sign-in screen; the others still run,
  and the exit code is 1 if any failed.

## What it does

1. `npx expo export --platform web` with `EXPO_PUBLIC_SUPABASE_URL=https://preview-backend.invalid`, so the
   build cannot point at the real project even if something slipped past the request filter.
2. Serves the export from `127.0.0.1` (`server.mjs`, `node:http`, SPA fallback to `index.html`).
3. Each shot gets a fresh browser context (412×915, DPR 2, `ko-KR`, `Asia/Seoul`, touch) and a fresh fixture
   store, so taps in one shot never affect the next.
4. Before the app loads, writes a fake far-from-expiry session to `localStorage['dayframe-auth']`, the
   `storageKey` that `src/lib/auth.ts` gives `@supabase/auth-js` (AsyncStorage is `localStorage` on web).
   The value is the session object auth-js stores: `access_token`, `refresh_token`, `expires_at`, `user`, ...
5. Routes every request: the local server passes, `*/functions/v1/api/v1/*` and `*/auth/v1/*` (any host)
   are answered by `mock-api.mjs`, and everything else is aborted and listed under "blocked".
6. Opens the shot's path, waits for network quiet and `document.fonts.ready`, runs its steps, captures.

## Adding a shot

Edit `shots.mjs`. Each entry is `{ name, path, steps? }`:

```js
{ name: 'quick-add', path: '/', steps: [
  { click: { label: '할 일 빠른 추가' } },                      // accessibility label (aria-label on web)
  { fill: { label: '할 일 입력', value: '내일 저녁 7시 운동 #건강 p1' } }, // input by label or placeholder
  { wait: 300 },
] },
{ name: 'today-bottom', path: '/', steps: [{ scroll: 900 }] },  // scrolls the tallest visible scroll view
{ name: 'report', path: '/', steps: [{ click: { text: '분기 보고서 초안 제출' } }] }, // first visible text match
{ name: 'esc', path: '/', steps: [{ press: 'Escape' }] },      // Playwright key names
{ name: 'menu', path: '/inbox', steps: [{ hold: { text: '휴대폰 사진 백업' } }] }, // long press (ms: 900 by default)
{ name: 'small', path: '/', viewport: { width: 360, height: 760 } }, // this shot's viewport instead of 412×915
{ name: 'tablet', path: '/', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 }, // and pixel density (2 by default)
{ name: 'swipe', path: '/inbox', steps: [{ drag: { text: '휴대폰 사진 백업', dx: 150 } }] }, // touch drag; finger stays down
{ name: 'swiped', path: '/inbox', steps: [
  { drag: { text: '휴대폰 사진 백업', dx: 200, release: true }, noSettle: true }, // lift the finger; go on at once
  { wait: 60, noSettle: true }, { snap: 'a' },                 // saves swiped-a.png mid-animation
] },
```

`drag` (`text` or `label`, `dx`, optional `dy`, `steps`, `release`) is a touch drag sent through CDP, so releasing it
does not also count as a tap the way a mouse release does on web. After every step the harness waits for the network
and entrance animations unless the step has `noSettle`; `snap` saves `<name>-<snap>.png` there and then.
`swipe-shots.mjs` uses these for the task-row swipe states and tab changes.

Prefer a `path` (deep link) over clicking through the UI, and accessibility labels over visible text:
screens change often. Use `ids` from `fixtures.mjs` to link to a specific entity, e.g. `'/task/' + ids.detailTask`.
Labels that existed when this was written: `할 일 빠른 추가` (FAB), `<task title> 완료` (task checkbox),
`<habit name> 체크` (habit ring), `<habit name> 자세히 보기`.

## Fixtures

`fixtures.mjs` builds everything relative to the current time in Asia/Seoul, in the shapes of
`packages/shared/types.ts`:

- profile (`/me`, time zone Asia/Seoul), 3 projects (업무 with sections 이번 주/백로그, 개인, 건강), 4 tags
- 21 tasks: overdue (all-day and timed), due today with and without a time, tomorrow, later this week,
  in 5 and 12 days, end of month; undated; repeating (weekdays, daily, weekly, monthly last day,
  completion-based); priorities 1–4; notes; tags; 2 tasks with subtasks; 3 completed (2 today)
- task completions (`/task-completions`), including repeating occurrences checked off today/yesterday
- 6 habits (daily with targets 1 and 8, weekly with targets 3 and 5) and ~70 days of seeded-random logs
  (completed, partial, skipped, frozen)
- focus sessions over the last 7 days (two today), app version (= the installed 1.0.0, so no update
  banner), 2 AI (MCP) connections

`mock-api.mjs` serves them: list routes page with `limit`/`offset`/`nextOffset` the way `src/lib/api.ts`
follows them and honour the filters the app sends (`state`, `from`, ...); habit stats are computed from the
logs; POST/PATCH/PUT/DELETE change the in-memory store (create, edit, complete with a rough next
occurrence for repeats, reopen, reschedule overdue, tags, habit logs, focus start/finish, AI connections).
Routes the mock does not know answer 404 and are listed in the summary: add them there when the app grows.

## AI 비서 shots

`node scripts/preview/run.mjs --shots scripts/preview/ai-shots.mjs` captures the AI 비서 screens. Requests to
`https://api.anthropic.com/v1/messages` are answered by `mock-anthropic.mjs`, never by the real API: it checks the
request against the rules of the models the app uses (no sampling parameters, no forced tool choice, no prefill,
`fallbacks` only with its beta and never on Haiku) and returns canned structured replies built from what the app
sent. A key containing `wrong` gets a 401, `nocredit` the low-balance 400, `busy` a 529, and `nofallback` a 400 for any
request that sends `fallbacks` (the client then retries once without it). The run's details list
each mocked request (model, effort, max_tokens, betas). The web build keeps the key in memory only, so shots save
it through the UI and move on by tapping instead of reloading.

## Web render vs. Android

The web export runs the same screens and data code, but some things differ or are missing:

- Native-only modules do nothing on web: home-screen widgets (`react-native-android-widget`),
  notifications and reminders (`expo-notifications`, background tasks; Settings shows "알림은 Android 앱에서
  설정할 수 있습니다"), haptics, keep-awake.
- The APK updater: the web build never installs; Settings shows the release check only.
- Fonts, text metrics, shadows and ripple effects are the browser's; Android status/navigation bars and
  safe-area insets are absent (insets are 0).
- Gestures are emulated with touch events: swipe actions and long-press menus may behave differently, and
  keyboard behaviour (Enter, Escape, IME) is a desktop browser's, not Android's.
- Times depend on the wall clock of the machine running the harness: e.g. "today" tasks timed earlier than
  now show as past, and the data shifts accordingly from run to run.
