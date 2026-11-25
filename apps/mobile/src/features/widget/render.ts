import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestWidgetUpdate, type WidgetTaskHandler } from 'react-native-android-widget';

import widgetQuickAdd from '../../../modules/widget-quick-add';
import { periodProgress } from '@/data/habits';
import {
  defaultFocusPrefs, FOCUS_LIMITS, type FocusPrefs, normalizeFocusPrefs, STOPWATCH_MAX_SECONDS,
} from '@/features/focus/model';
import { EMPTY_SESSION_MOD, type FocusSessionMod, setFocusSessionMod } from '@/features/focus/prefs';
import { nextCheckIn } from '@/features/habits/checkIn';
import { cancelHabitAlert, cancelOccurrence } from '@/features/reminders/cancel';
import { completeOccurrence } from '@/features/reminders/complete';
import { type AccentId, accentPalette, DEFAULT_ACCENT, parseAccent } from '@/features/settings/palettes';
import { DEFAULT_PERSONAL_PREFS, parsePersonalPrefs, type StartOfWeek, type TimeFormat } from '@/features/settings/prefs';
import { cancelAlert, scheduleAlert } from '@/lib/alerts';
import { ApiFailure, api } from '@/lib/api';
import { deviceTimeZone, dueBucket, dueMinutes, instantFor, logicalToday, sameInstant, Temporal, today as todayInZone } from '@/lib/dates';
import { uuid } from '@/lib/ids';
import { countByDate } from '@/lib/occurrences';
import { analyzeTask, nextOccurrence, type Priority, type Task } from '@/lib/shared';

import {
  adjustCalendar, CALENDAR_RANGE, type CalendarCell, calendarDateLabel, calendarDateRows, calendarGrid,
  focusState, habitToday, snapshotTasks, todayOverview, todayWidgetItems, upcomingRows,
  type WidgetDoneToday, type WidgetFocus, type WidgetHabit, type WidgetSnapshot, type WidgetTask, widgetRows,
} from './items';
import { externalChange } from './events';
import { readSnapshot, withTask, writeSnapshot } from './store';
import { ACTIONS, type WidgetName, WIDGETS } from './names';
import { calendarWidget, focusWidget, habitsWidget, quickAddWidget, todayWidget, upcomingWidget } from './widgets';

const ACCENT_KEY = 'dayframe-accent';
const FOCUS_PREFS_KEY = 'dayframe-focus-prefs';
const FOCUS_MOD_KEY = 'dayframe-focus-session-mod';
const PERSONAL_PREFS_KEY = 'dayframe-personal-prefs-v1';

function syncOverlayAccent(accent: AccentId): void {
  try {
    const chosen = accentPalette(accent);
    widgetQuickAdd?.setAccentColor(chosen.light.accent, chosen.dark.accent);
  } catch {
    // Safe no-op on web or builds made before the native overlay module was added.
  }
}

export interface WidgetRenderPrefs {
  accent: AccentId;
  focusPresets: readonly number[];
  focusPrimaryMinutes: number;
  startOfWeek: StartOfWeek;
  dayStartHour: number;
  timeFormat: TimeFormat;
}

const DEFAULT_WIDGET_PREFS: WidgetRenderPrefs = {
  accent: DEFAULT_ACCENT,
  focusPresets: [15, 25, 50],
  focusPrimaryMinutes: 25,
  startOfWeek: DEFAULT_PERSONAL_PREFS.startOfWeek,
  dayStartHour: DEFAULT_PERSONAL_PREFS.dayStartHour,
  timeFormat: DEFAULT_PERSONAL_PREFS.timeFormat,
};

function deriveFocusPresets(focusPrefs: FocusPrefs): { presets: number[]; primary: number } {
  const primary = focusPrefs.mode === 'timer' ? focusPrefs.timerMinutes : focusPrefs.focusMinutes;
  if (primary === 25 && focusPrefs.timerMinutes === 25) {
    return { presets: [15, 25, 50], primary: 25 };
  }
  const picked = new Set<number>([primary]);
  const short = Math.max(5, Math.round((primary * 0.6) / 5) * 5);
  const long = Math.min(FOCUS_LIMITS.focus.max, Math.round((primary * 2) / 5) * 5);
  if (short !== primary) picked.add(short);
  if (long !== primary) picked.add(long);
  for (const fallback of [15, 25, 50, 10, 5, 30, 60]) {
    if (picked.size >= 3) break;
    picked.add(fallback);
  }
  return { presets: [...picked].slice(0, 3).sort((a, b) => a - b), primary };
}

async function readWidgetPrefs(): Promise<WidgetRenderPrefs> {
  try {
    const entries = await AsyncStorage.multiGet([ACCENT_KEY, FOCUS_PREFS_KEY, PERSONAL_PREFS_KEY]);
    const stored = Object.fromEntries(entries);
    const accent = parseAccent(stored[ACCENT_KEY]);
    const personal = parsePersonalPrefs(stored[PERSONAL_PREFS_KEY]);
    let focusPrefs = defaultFocusPrefs;
    if (stored[FOCUS_PREFS_KEY]) {
      try {
        focusPrefs = normalizeFocusPrefs(JSON.parse(stored[FOCUS_PREFS_KEY]) as Partial<FocusPrefs>);
      } catch {
        // Ignore malformed focus preferences and keep defaults.
      }
    }
    const { presets, primary } = deriveFocusPresets(focusPrefs);
    return {
      accent,
      focusPresets: presets,
      focusPrimaryMinutes: primary,
      startOfWeek: personal.startOfWeek,
      dayStartHour: personal.dayStartHour,
      timeFormat: personal.timeFormat,
    };
  } catch {
    return DEFAULT_WIDGET_PREFS;
  }
}

function formatWidgetClock(text: string, timeFormat: TimeFormat): string {
  if (timeFormat !== '24h') return text;
  const match = /^(오전|오후) (\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return text;
  const [, period, rawHour, minute] = match;
  let hour = Number(rawHour) % 12;
  if (period === '오후') hour += 12;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function calendarGridForWeekStart(
  now: number,
  timeZone: string,
  offset: number,
  counts: Record<string, number>,
  startOfWeek: StartOfWeek,
): { title: string; weeks: (CalendarCell | null)[][] } {
  if (startOfWeek !== 'sunday') {
    return calendarGrid(now, timeZone, offset, counts);
  }
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone).toPlainDate();
  const month = today.toPlainYearMonth().add({ months: offset });
  const first = month.toPlainDate({ day: 1 });
  const cells: (CalendarCell | null)[] = Array.from({ length: first.dayOfWeek % 7 }, () => null);
  for (let day = 1; day <= month.daysInMonth; day++) {
    const date = month.toPlainDate({ day });
    cells.push({ date: date.toString(), day, today: date.equals(today), count: counts[date.toString()] ?? 0, weekend: date.dayOfWeek >= 6 });
  }
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
  return { title: (month.year === today.year ? '' : month.year + '년 ') + month.month + '월', weeks };
}

/** The picture of one widget, drawn from the snapshot at this moment. */
export function drawWidget(name: string, snapshot: WidgetSnapshot, now = Date.now(), prefs: WidgetRenderPrefs = DEFAULT_WIDGET_PREFS) {
  const zone = deviceTimeZone();
  const { signedIn, notice } = snapshot;
  const logicalNow = prefs.dayStartHour > 0 ? now - prefs.dayStartHour * 3_600_000 : now;
  const { accent, timeFormat, startOfWeek } = prefs;

  switch (name) {
    case WIDGETS.upcoming: {
      const rows = upcomingRows(snapshot.tasks, logicalNow, zone, nextOccurrence).map((row) =>
        row.kind === 'task' ? { ...row, when: formatWidgetClock(row.when, timeFormat) } : row);
      return upcomingWidget({ rows, signedIn, stamp: now, notice, accent });
    }
    case WIDGETS.habits:
      return habitsWidget({
        signedIn, notice, accent,
        rows: (snapshot.habits ?? []).map((habit) => {
          const today = habitToday(habit, logicalNow);
          const weekly = habit.cadence === 'weekly';
          const label = (weekly ? '이번 주 ' : '') + today.progress + '/' + habit.target_count;
          return { id: habit.id, name: habit.name, label, ratio: today.progress / habit.target_count, date: today.date };
        }),
      });
    case WIDGETS.focus: {
      const state = focusState(snapshot.focus, now, zone);
      const logicalDay = logicalToday(zone, prefs.dayStartHour, Temporal.Instant.fromEpochMilliseconds(now)).toString();
      const sameLogicalDay = snapshot.focus?.date === logicalDay;
      return focusWidget({
        signedIn, notice, accent,
        running: state.running,
        endsAt: state.endsAt ? formatWidgetClock(state.endsAt, timeFormat) : null,
        count: sameLogicalDay ? snapshot.focus!.count : state.count,
        minutes: sameLogicalDay ? Math.round(snapshot.focus!.seconds / 60) : state.minutes,
        plannedMinutes: state.running ? Math.round(state.running.plannedSeconds / 60) : null,
        presets: prefs.focusPresets,
        primaryMinutes: prefs.focusPrimaryMinutes,
      });
    }
    case WIDGETS.quickAdd:
      return quickAddWidget({ accent, focusMinutes: prefs.focusPrimaryMinutes, notice });
    case WIDGETS.calendar: {
      const offset = snapshot.calendarOffset ?? 0;
      const grid = calendarGridForWeekStart(logicalNow, zone, offset, snapshot.calendar ?? {}, startOfWeek);
      const selectedDate = snapshot.calendarSelectedDate ?? null;
      const selectedRows = selectedDate
        ? calendarDateRows(snapshot.tasks, selectedDate, logicalNow, nextOccurrence, timeFormat)
        : undefined;
      return calendarWidget({
        signedIn, ...grid, stamp: now, canBack: offset > -CALENDAR_RANGE.back, canAhead: offset < CALENDAR_RANGE.ahead,
        startOfWeek, accent,
        selectedDate,
        selectedDateLabel: selectedDate ? calendarDateLabel(selectedDate) : null,
        selectedRows,
      });
    }
    default: {
      const rows = widgetRows(snapshot.tasks, logicalNow).map((row) => ({
        ...row,
        when: formatWidgetClock(row.when, timeFormat),
      }));
      const overview = todayOverview(rows, snapshot.doneToday, logicalNow, zone);
      return todayWidget({
        items: todayWidgetItems(rows),
        subtitle: overview.subtitle,
        progress: overview.ratio,
        doneCount: overview.doneCount,
        signedIn,
        notice,
        accent,
      });
    }
  }
}

/** Redraws every placed widget from a snapshot. Widgets not on the home screen cost nothing. */
export async function redrawWidgets(snapshot?: WidgetSnapshot): Promise<void> {
  const [current, prefs] = await Promise.all([
    snapshot ? Promise.resolve(snapshot) : readSnapshot(),
    readWidgetPrefs(),
  ]);
  syncOverlayAccent(prefs.accent);
  await Promise.all(Object.values(WIDGETS).map((widgetName) =>
    requestWidgetUpdate({ widgetName, renderWidget: () => drawWidget(widgetName, current, Date.now(), prefs) }).catch(() => {})));
}

// Each change reads the newest snapshot only after the one before it is written, so the app's saves and
// the widget's own taps never overwrite each other.
let queue: Promise<unknown> = Promise.resolve();

function update(change: (snapshot: WidgetSnapshot) => WidgetSnapshot): Promise<WidgetSnapshot> {
  const run = queue.then(async () => {
    const next = change(await readSnapshot());
    await writeSnapshot(next);
    await redrawWidgets(next);
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

/** Called by the app whenever its data changes. `null` tasks means signed out. */
export async function saveWidget(
  tasks: Task[] | null,
  extra: {
    habits?: WidgetHabit[];
    focus?: WidgetFocus | null;
    calendar?: Record<string, number>;
    doneToday?: WidgetDoneToday;
    projectName?: (task: { id: string; project_id?: string | null }) => string | undefined;
    subtaskLabel?: (taskId: string) => string | undefined;
  } = {},
): Promise<void> {
  await update((previous) => (tasks ? {
    signedIn: true,
    tasks: snapshotTasks(tasks, Date.now(), {
      projectName: extra.projectName
        ? (widgetTask) => {
          const full = tasks.find((item) => item.id === widgetTask.id);
          return full ? extra.projectName!(full) : widgetTask.projectName;
        }
        : undefined,
      subtaskLabel: extra.subtaskLabel,
    }),
    doneToday: extra.doneToday ?? previous.doneToday,
    habits: extra.habits ?? previous.habits,
    focus: extra.focus !== undefined ? extra.focus : previous.focus,
    calendar: extra.calendar ?? previous.calendar,
    calendarOffset: previous.calendarOffset,
    calendarSelectedDate: previous.calendarSelectedDate,
  } : { signedIn: false, tasks: [] }));
}

/** Applies a completion or reschedule made outside the app to the widgets. */
export async function widgetTaskChanged(taskId: string, task: Task | null, options?: { completed?: boolean }): Promise<void> {
  const prefs = await readWidgetPrefs();
  const completedOnDate = options?.completed ? logicalToday(deviceTimeZone(), prefs.dayStartHour).toString() : undefined;
  await update((snapshot) => withTask(snapshot, taskId, task, { completedOnDate }));
  externalChange();
}

/** Applies a habit check-in made outside the app (the alert's 기록하기) to the habit widget. */
export async function widgetHabitChanged(habitId: string, date: string, todayCount: number, progress: number): Promise<void> {
  await update((snapshot) => ({
    ...snapshot,
    habits: snapshot.habits?.map((habit) => (habit.id === habitId ? { ...habit, date, todayCount, progress } : habit)),
  }));
  externalChange();
}

/** Fresh tasks (and optionally habits) from the server, used on periodic updates or when tapping the widget's refresh icon. */
async function fetched(snapshot: WidgetSnapshot, includeHabits = false): Promise<WidgetSnapshot> {
  if (!snapshot.signedIn) return snapshot;
  try {
    const zone = deviceTimeZone();
    const prefs = await readWidgetPrefs();
    const todayDate = logicalToday(zone, prefs.dayStartHour);
    const timeout = <T,>(promise: Promise<T>) => Promise.race([
      promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    const [tasks, projects, completions] = await timeout(Promise.all([
      api.openTasks(),
      api.projects().catch(() => []),
      api.completionsSince(todayDate.toZonedDateTime(zone).toInstant().toString()).catch(() => []),
    ]));
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const childCounts = new Map<string, number>();
    for (const item of tasks) {
      if (item.parent_task_id) childCounts.set(item.parent_task_id, (childCounts.get(item.parent_task_id) ?? 0) + 1);
    }
    const month = todayDate.toPlainYearMonth();
    const end = month.add({ months: CALENDAR_RANGE.ahead });
    const calendar = countByDate(tasks, month.subtract({ months: CALENDAR_RANGE.back }).toPlainDate({ day: 1 }),
      end.toPlainDate({ day: end.daysInMonth }), nextOccurrence);

    let freshHabits: WidgetHabit[] | undefined;
    if (includeHabits) {
      const activeHabits = (await timeout(api.habits())).filter((h) => !h.archived_at);
      const logsList = await timeout(Promise.all(activeHabits.map((h) => api.habitLogs(h.id).catch(() => []))));
      freshHabits = activeHabits.map((habit, idx) => {
        const d = logicalToday(habit.timezone, prefs.dayStartHour).toString();
        const logs = logsList[idx];
        return {
          id: habit.id, name: habit.name, cadence: habit.cadence, target_count: habit.target_count,
          timezone: habit.timezone, date: d,
          todayCount: logs.find((l) => l.log_date === d)?.count ?? 0,
          progress: periodProgress(habit, logs, d),
        };
      });
    }

    const openById = new Map(tasks.map((task) => [task.id, task]));
    const seen = new Set<string>();
    let doneCount = 0;
    for (const completion of completions) {
      const open = openById.get(completion.task.id);
      const repeats = !!completion.task.recurrence_rule;
      if (repeats ? !open || sameInstant(open.due_at, completion.occurrence_due_at) : !!open) continue;
      if (!repeats && seen.has(completion.task.id)) continue;
      seen.add(completion.task.id);
      doneCount += 1;
    }
    const doneToday: WidgetDoneToday = { date: todayDate.toString(), count: doneCount };

    return await update((current) => ({
      ...current,
      notice: null,
      tasks: snapshotTasks(tasks, Date.now(), {
        projectName: (wt) => {
          const full = tasks.find((t) => t.id === wt.id);
          return full?.project_id ? projectMap.get(full.project_id) : undefined;
        },
        subtaskLabel: (id) => {
          const openCount = childCounts.get(id) ?? 0;
          return openCount > 0 ? `하위 ${openCount}` : undefined;
        },
      }),
      doneToday,
      calendar,
      ...(freshHabits ? { habits: freshHabits } : {}),
    }));
  } catch {
    return snapshot;
  }
}

async function checkInHabit(id: string): Promise<void> {
  const [snapshot, prefs] = await Promise.all([readSnapshot(), readWidgetPrefs()]);
  const habit = snapshot.habits?.find((item) => item.id === id);
  if (!habit) return;
  const logicalNow = prefs.dayStartHour > 0 ? Date.now() - prefs.dayStartHour * 3_600_000 : Date.now();
  const today = habitToday(habit, logicalNow);
  const next = nextCheckIn(habit, today.todayCount, today.progress);
  const delta = next.count - today.todayCount;
  const changed = (item: WidgetHabit): WidgetHabit => (item.id !== id ? item
    : { ...item, date: today.date, todayCount: next.count, progress: Math.max(0, today.progress + delta) });
  await update((current) => ({ ...current, notice: null, habits: current.habits?.map(changed) }));
  try {
    if (next.status === null) await api.deleteHabitLog(id, today.date);
    else await api.setHabitLog(id, today.date, { status: next.status, count: next.count });
    // A goal met here needs no reminder later today.
    if (next.reaches) await cancelHabitAlert(id, today.date);
    externalChange();
  } catch {
    // Put the figures back so the widget never shows a check the server does not have.
    await update((current) => ({ ...current, notice: '연결되지 않아 기록하지 못했습니다', habits: current.habits?.map((item) => (item.id === id ? habit : item)) }));
  }
}

/**
 * Records a session whose time ran out as completed. Only the Focus tab does this on its own, so a session
 * started here would otherwise stay "running" on the server and block the next one.
 */
async function closeStale(running: { id: string; startedAt: string; plannedSeconds: number } | null | undefined): Promise<void> {
  if (!running) return;
  const end = Date.parse(running.startedAt) + running.plannedSeconds * 1000;
  if (end > Date.now()) return;
  await api.finishFocus(running.id, { status: 'completed', ended_at: new Date(end).toISOString() }).catch(() => {});
}

async function startFocus(minutes: number): Promise<void> {
  const startedAt = new Date().toISOString();
  const id = uuid();
  const start = () => api.startFocus({ id, started_at: startedAt, planned_seconds: minutes * 60 });
  try {
    await closeStale((await readSnapshot()).focus?.running);
    try {
      await start();
    } catch (error) {
      if (!(error instanceof ApiFailure && error.status === 409)) throw error;
      // Another session is still open on the server: finish it if its time is up, then try once more.
      const open = (await api.focusSessions()).find((session) => session.status === 'running');
      if (!open) throw error;
      const end = Date.parse(open.started_at) + open.planned_seconds * 1000;
      if (end > Date.now()) {
        await update((current) => ({
          ...current, notice: null,
          focus: { ...(current.focus ?? { date: '', count: 0, seconds: 0 }), running: { id: open.id, startedAt: open.started_at, plannedSeconds: open.planned_seconds } },
        }));
        return;
      }
      await closeStale({ id: open.id, startedAt: open.started_at, plannedSeconds: open.planned_seconds });
      await start();
    }
  } catch (error) {
    await update((current) => ({ ...current, notice: error instanceof ApiFailure ? '시작하지 못했습니다. 앱에서 확인해 주세요' : '연결되지 않아 시작하지 못했습니다' }));
    return;
  }
  await update((current) => ({
    ...current, notice: null,
    focus: { ...(current.focus ?? { date: '', count: 0, seconds: 0 }), running: { id, startedAt, plannedSeconds: minutes * 60 } },
  }));
  setFocusSessionMod(EMPTY_SESSION_MOD);
  await AsyncStorage.removeItem(FOCUS_MOD_KEY).catch(() => {});
  await scheduleAlert('focus', Date.parse(startedAt) + minutes * 60_000, `집중 ${minutes}분 완료`, `${minutes >= 50 ? 10 : 5}분 쉬어 가세요.`);
  externalChange();
}

async function stopFocus(id: string): Promise<void> {
  const running = (await readSnapshot()).focus?.running;
  const end = running && running.id === id ? Date.parse(running.startedAt) + running.plannedSeconds * 1000 : Infinity;
  try {
    // A round whose time already ran out counts as done, not as given up.
    await api.finishFocus(id, end <= Date.now()
      ? { status: 'completed', ended_at: new Date(end).toISOString() }
      : { status: 'cancelled', ended_at: new Date().toISOString() });
  } catch {
    await update((current) => ({ ...current, notice: '연결되지 않아 중단하지 못했습니다' }));
    return;
  }
  await cancelAlert('focus');
  setFocusSessionMod(EMPTY_SESSION_MOD);
  await AsyncStorage.removeItem(FOCUS_MOD_KEY).catch(() => {});
  await update((current) => ({ ...current, notice: null, focus: current.focus ? { ...current.focus, running: null } : null }));
  externalChange();
}

async function extendFocus(id: string, addSeconds: number): Promise<void> {
  const delta = Number.isFinite(addSeconds) && addSeconds > 0 ? Math.round(addSeconds) : 300;
  const snapshot = await readSnapshot();
  const running = snapshot.focus?.running;
  if (!running || (id && running.id !== id) || running.plannedSeconds === STOPWATCH_MAX_SECONDS) return;

  let existingMod: FocusSessionMod = { id: running.id, pausedAt: null, pausedMs: 0, extraSeconds: 0 };
  try {
    const raw = await AsyncStorage.getItem(FOCUS_MOD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FocusSessionMod>;
      if (parsed.id === running.id) {
        existingMod = {
          id: running.id,
          pausedAt: typeof parsed.pausedAt === 'number' ? parsed.pausedAt : null,
          pausedMs: typeof parsed.pausedMs === 'number' ? parsed.pausedMs : 0,
          extraSeconds: typeof parsed.extraSeconds === 'number' ? parsed.extraSeconds : 0,
        };
      }
    }
  } catch {
    // Ignore malformed mod payload and start fresh for this running session.
  }

  const nextMod: FocusSessionMod = { ...existingMod, extraSeconds: existingMod.extraSeconds + delta };
  setFocusSessionMod(nextMod);
  await AsyncStorage.setItem(FOCUS_MOD_KEY, JSON.stringify(nextMod)).catch(() => {});

  const nextPlannedSeconds = running.plannedSeconds + delta;
  await update((current) => ({
    ...current,
    notice: null,
    focus: current.focus?.running?.id === running.id
      ? { ...current.focus, running: { ...current.focus.running, plannedSeconds: nextPlannedSeconds } }
      : current.focus,
  }));

  const nextEndMs = Date.parse(running.startedAt) + nextPlannedSeconds * 1000;
  const totalMinutes = Math.round(nextPlannedSeconds / 60);
  if (nextEndMs > Date.now()) {
    await scheduleAlert('focus', nextEndMs, `집중 ${totalMinutes}분 완료`, `${totalMinutes >= 50 ? 10 : 5}분 쉬어 가세요.`);
  }
  externalChange();
}

async function completeFocus(id: string, prefs: WidgetRenderPrefs): Promise<void> {
  const snapshot = await readSnapshot();
  const running = snapshot.focus?.running;
  const targetId = id || running?.id || '';
  if (!targetId) return;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const elapsedSeconds = running && running.id === targetId
    ? Math.max(1, Math.round((nowMs - Date.parse(running.startedAt)) / 1000))
    : 0;
  try {
    await api.finishFocus(targetId, { status: 'completed', ended_at: nowIso });
  } catch {
    await update((current) => ({ ...current, notice: '연결되지 않아 완료하지 못했습니다' }));
    return;
  }

  await cancelAlert('focus');
  setFocusSessionMod(EMPTY_SESSION_MOD);
  await AsyncStorage.removeItem(FOCUS_MOD_KEY).catch(() => {});
  const todayKey = logicalToday(deviceTimeZone(), prefs.dayStartHour).toString();
  await update((current) => {
    const prev = current.focus;
    const sameDay = prev?.date === todayKey;
    return {
      ...current,
      notice: null,
      focus: {
        date: todayKey,
        count: (sameDay ? prev!.count : 0) + 1,
        seconds: (sameDay ? prev!.seconds : 0) + elapsedSeconds,
        running: null,
      },
    };
  });
  externalChange();
}

function resolveQuickAddDate(defaultDate: string, zone: string, dayStartHour: number): { due_at: string | null; all_day: boolean } {
  const todayDate = logicalToday(zone, dayStartHour);
  const normalized = defaultDate.trim().toLowerCase();
  if (normalized === 'none') return { due_at: null, all_day: false };
  if (normalized === 'tomorrow') return { due_at: instantFor(todayDate.add({ days: 1 }), null, zone), all_day: true };
  if (normalized === 'evening') return { due_at: instantFor(todayDate, 19 * 60, zone), all_day: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    try {
      return { due_at: instantFor(Temporal.PlainDate.from(normalized), null, zone), all_day: true };
    } catch {
      // Fall back to today on malformed date string.
    }
  }
  return { due_at: instantFor(todayDate, null, zone), all_day: true };
}

async function quickAddTask(data: Record<string, unknown>, prefs: WidgetRenderPrefs): Promise<void> {
  const rawText = String(data.text ?? '').trim();
  if (!rawText) return;
  const defaultDate = String(data.defaultDate ?? 'today').trim();
  const rawPriority = Number(data.priority);
  const zone = deviceTimeZone();

  let parsed: ReturnType<typeof analyzeTask>['task'] | null = null;
  let hasExplicitPriority = false;
  try {
    const analysis = analyzeTask({ text: rawText, timezone: zone, now: new Date().toISOString() });
    if (analysis.task.title) {
      parsed = analysis.task;
      hasExplicitPriority = analysis.tokens.some((token) => token.kind === 'priority');
    }
  } catch {
    // Fall back to plain title when input has non-schedule text.
  }

  // QuickAddOverlayActivity encodes chip urgency as 1 ("보통") .. 4 ("!!!"), inverse of Dayframe's p1..p4.
  const overlayPriority: Priority | null = Number.isInteger(rawPriority) && rawPriority >= 1 && rawPriority <= 4
    ? ((5 - rawPriority) as Priority)
    : null;
  const priority: Priority = hasExplicitPriority && parsed ? parsed.priority : (overlayPriority ?? 4);
  const title = parsed?.title?.trim() || rawText;
  const schedule = parsed?.due_at
    ? { due_at: parsed.due_at, all_day: parsed.all_day }
    : resolveQuickAddDate(defaultDate, zone, prefs.dayStartHour);

  const id = uuid();
  const nowIso = new Date().toISOString();
  const optimistic: WidgetTask | null = schedule.due_at ? {
    id,
    title,
    due_at: schedule.due_at,
    all_day: schedule.all_day,
    timezone: zone,
    priority,
    updated_at: nowIso,
    recurrence_rule: parsed?.recurrence_rule ?? null,
    ...(parsed?.recurrence_mode ? { recurrence_mode: parsed.recurrence_mode } : {}),
    ...(parsed?.recurrence_local_time ? { recurrence_local_time: parsed.recurrence_local_time } : {}),
    ...(parsed?.project ? { projectName: parsed.project } : {}),
  } : null;

  if (optimistic) {
    await update((current) => {
      const kept = snapshotTasks([{ ...optimistic, completed_at: null }], Date.now());
      return {
        ...current,
        notice: null,
        tasks: [...current.tasks.filter((task) => task.id !== id), ...kept]
          .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!)),
        calendar: adjustCalendar(current.calendar, undefined, optimistic),
      };
    });
  }

  try {
    let matchedProject: { id: string; name: string } | undefined;
    if (parsed?.project) {
      const projects = await api.projects().catch(() => []);
      matchedProject = projects.find((project) => project.name.toLowerCase() === parsed!.project!.toLowerCase());
    }
    const created = await api.createTask({
      id,
      title,
      priority,
      timezone: zone,
      ...(schedule.due_at ? { due_at: schedule.due_at, all_day: schedule.all_day } : {}),
      ...(parsed?.recurrence_rule ? { recurrence_rule: parsed.recurrence_rule, recurrence_mode: parsed.recurrence_mode } : {}),
      ...(parsed?.recurrence_local_time ? { recurrence_local_time: parsed.recurrence_local_time } : {}),
      ...(parsed?.duration_minutes ? { duration_minutes: parsed.duration_minutes } : {}),
      ...(matchedProject ? { project_id: matchedProject.id } : {}),
    });
    if (parsed?.tags?.length) {
      const existingTags = await api.tags().catch(() => []);
      const tagMap = new Map(existingTags.map((tag) => [tag.name.toLowerCase(), tag.id]));
      await Promise.allSettled(parsed.tags.map((name) => {
        const tagId = tagMap.get(name.toLowerCase());
        return tagId ? api.attachTag(created.id, tagId) : Promise.resolve();
      }));
    }
    await update((current) => {
      const nextSnapshot = withTask(current, id, created);
      if (matchedProject) {
        return {
          ...nextSnapshot,
          tasks: nextSnapshot.tasks.map((task) => (task.id === created.id ? { ...task, projectName: matchedProject!.name } : task)),
        };
      }
      return nextSnapshot;
    });
    externalChange();
  } catch {
    await update((current) => ({
      ...current,
      notice: '연결되지 않아 추가하지 못했습니다',
      tasks: current.tasks.filter((task) => task.id !== id),
      calendar: optimistic ? adjustCalendar(current.calendar, optimistic, null) : current.calendar,
    }));
  }
}

async function quickAddHabit(data: Record<string, unknown>, prefs: WidgetRenderPrefs): Promise<void> {
  const name = String(data.name ?? '').trim();
  if (!name) return;
  const id = uuid();
  const zone = deviceTimeZone();
  const todayIso = logicalToday(zone, prefs.dayStartHour).toString();
  const optimistic: WidgetHabit = {
    id,
    name,
    cadence: 'daily',
    target_count: 1,
    timezone: zone,
    date: todayIso,
    todayCount: 0,
    progress: 0,
  };
  await update((current) => ({
    ...current,
    notice: null,
    habits: [...(current.habits ?? []), optimistic],
  }));
  try {
    await api.createHabit({ id, name, cadence: 'daily', target_count: 1, timezone: zone, start_date: todayIso });
    externalChange();
  } catch {
    await update((current) => ({
      ...current,
      notice: '연결되지 않아 추가하지 못했습니다',
      habits: current.habits?.filter((habit) => habit.id !== id),
    }));
  }
}

async function postponeTask(id: string, occurrence: string, prefs: WidgetRenderPrefs): Promise<void> {
  if (!id) return;
  const before = await readSnapshot();
  const existing = before.tasks.find((task) => task.id === id);
  const optimisticZone = existing?.timezone ?? deviceTimeZone();
  const optimisticTomorrow = logicalToday(optimisticZone, prefs.dayStartHour).add({ days: 1 });
  const optimisticDueAt = existing?.due_at && !existing.all_day
    ? (() => {
      const dueZdt = Temporal.Instant.from(existing.due_at).toZonedDateTimeISO(optimisticZone);
      return instantFor(optimisticTomorrow, dueZdt.hour * 60 + dueZdt.minute, optimisticZone);
    })()
    : instantFor(optimisticTomorrow, null, optimisticZone);

  const optimisticNext: WidgetTask | null = existing ? { ...existing, due_at: optimisticDueAt } : null;
  if (optimisticNext) {
    await update((current) => ({
      ...current,
      notice: null,
      tasks: [...current.tasks.filter((task) => task.id !== id), optimisticNext]
        .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!)),
      calendar: adjustCalendar(current.calendar, existing, optimisticNext),
    }));
  }

  try {
    const task = await api.task(id);
    if (task.completed_at) {
      await update((current) => withTask(current, id, null));
      externalChange();
      return;
    }
    const taskTomorrow = logicalToday(task.timezone, prefs.dayStartHour).add({ days: 1 });
    const nextDueAt = !task.all_day && task.due_at
      ? (() => {
        const dueZdt = Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone);
        return instantFor(taskTomorrow, dueZdt.hour * 60 + dueZdt.minute, task.timezone);
      })()
      : instantFor(taskTomorrow, null, task.timezone);
    const updated = await api.updateTask(
      id,
      task.recurrence_rule && task.due_at
        ? { due_at: nextDueAt, expected_due_at: task.due_at, preserve_recurrence: true }
        : { due_at: nextDueAt, all_day: task.all_day },
    );
    const cancelTarget = occurrence || task.due_at;
    if (cancelTarget) await cancelOccurrence(id, cancelTarget);
    await update((current) => withTask(current, id, updated));
    externalChange();
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) {
      await update((current) => withTask(current, id, null));
      externalChange();
      return;
    }
    await update((current) => ({
      ...current,
      notice: '연결되지 않아 미루지 못했습니다',
      tasks: existing
        ? [...current.tasks.filter((task) => task.id !== id), existing].sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))
        : current.tasks,
      calendar: existing && optimisticNext ? adjustCalendar(current.calendar, optimisticNext, existing) : current.calendar,
    }));
  }
}

function rescheduledOverdueFields(
  task: Pick<Task, 'due_at' | 'all_day' | 'timezone'>,
  nowMs: number,
): { due_at: string; all_day: boolean } {
  const targetDay = todayInZone(task.timezone);
  const candidate = instantFor(targetDay, dueMinutes(task), task.timezone);
  if (!task.all_day && Date.parse(candidate) < nowMs) {
    return { due_at: instantFor(targetDay, null, task.timezone), all_day: true };
  }
  return { due_at: candidate, all_day: task.all_day };
}

async function rescheduleOverdueTasks(): Promise<void> {
  const before = await readSnapshot();
  const nowMs = Date.now();
  await update((current) => {
    let calendar = current.calendar;
    const nextTasks = current.tasks.map((task) => {
      if (dueBucket(task) !== 'overdue') return task;
      const moved = rescheduledOverdueFields(task, nowMs);
      const nextTask: WidgetTask = { ...task, ...moved };
      calendar = adjustCalendar(calendar, task, nextTask);
      return nextTask;
    }).sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));
    return { ...current, notice: null, tasks: nextTasks, calendar };
  });

  try {
    const pastWallClock = (await api.openTasks()).filter((task) => (
      dueBucket(task) === 'overdue' && !task.all_day && rescheduledOverdueFields(task, nowMs).all_day
    ));
    for (const task of pastWallClock) {
      try {
        await api.updateTask(task.id, rescheduledOverdueFields(task, nowMs));
      } catch (error) {
        if (!(error instanceof ApiFailure && error.status === 404)) throw error;
      }
    }
    await api.rescheduleOverdue();
    await fetched(await readSnapshot(), false);
    externalChange();
  } catch {
    await update((current) => ({
      ...current,
      notice: '연결되지 않아 일정을 옮기지 못했습니다',
      tasks: before.tasks,
      calendar: before.calendar,
    }));
  }
}

export const widgetTaskHandler: WidgetTaskHandler = async ({ widgetInfo, widgetAction, clickAction, clickActionData, renderWidget }) => {
  if (widgetAction === 'WIDGET_DELETED') return;
  const name = widgetInfo.widgetName as WidgetName;
  const data = clickActionData ?? {};
  const prefs = await readWidgetPrefs();
  if (widgetAction === 'WIDGET_CLICK') {
    if (clickAction === ACTIONS.complete) {
      const id = String(data.id ?? '');
      const occurrence = String(data.occurrence ?? '');
      // The row leaves at once; the server is told afterwards.
      const before = await readSnapshot();
      renderWidget(drawWidget(name, { ...before, notice: null, tasks: before.tasks.filter((task) => task.id !== id) }, Date.now(), prefs));
      const outcome = await completeOccurrence(id, occurrence);
      if (outcome.status === 'failed') await update((current) => ({ ...current, notice: '연결되지 않아 완료하지 못했습니다' }));
      else {
        await widgetTaskChanged(id, outcome.task, { completed: outcome.status === 'done' });
        await cancelOccurrence(id, occurrence);
      }
    } else if (clickAction === ACTIONS.habit) await checkInHabit(String(data.id ?? ''));
    else if (clickAction === ACTIONS.startFocus) {
      const rawMinutes = Number(data.minutes);
      const validMinutes = Number.isFinite(rawMinutes)
        && rawMinutes >= FOCUS_LIMITS.focus.min
        && rawMinutes <= FOCUS_LIMITS.focus.max
        ? Math.round(rawMinutes)
        : prefs.focusPrimaryMinutes;
      await startFocus(validMinutes);
    } else if (clickAction === ACTIONS.stopFocus) await stopFocus(String(data.id ?? ''));
    else if (clickAction === ACTIONS.extendFocus) {
      await extendFocus(String(data.id ?? ''), Number(data.addSeconds) || 300);
    } else if (clickAction === ACTIONS.completeFocus) {
      await completeFocus(String(data.id ?? ''), prefs);
    } else if (clickAction === ACTIONS.quickAdd) {
      await quickAddTask(data, prefs);
    } else if (clickAction === ACTIONS.quickAddHabit) {
      await quickAddHabit(data, prefs);
    } else if (clickAction === ACTIONS.postpone) {
      await postponeTask(String(data.id ?? ''), String(data.occurrence ?? ''), prefs);
    } else if (clickAction === ACTIONS.rescheduleOverdue) {
      await rescheduleOverdueTasks();
    } else if (clickAction === ACTIONS.calendarSelect) {
      const date = String(data.date ?? '').trim();
      if (date) {
        await update((current) => ({
          ...current,
          calendarSelectedDate: current.calendarSelectedDate === date ? null : date,
        }));
      }
    } else if (clickAction === ACTIONS.calendarMove) {
      const by = Number(data.by) || 0;
      await update((current) => ({
        ...current,
        calendarOffset: by === 0 ? 0 : Math.max(-CALENDAR_RANGE.back, Math.min(CALENDAR_RANGE.ahead, (current.calendarOffset ?? 0) + by)),
        calendarSelectedDate: by === 0 ? current.calendarSelectedDate : null,
      }));
    } else if (clickAction === ACTIONS.refresh) {
      const refreshed = await fetched(await readSnapshot(), true);
      externalChange();
      renderWidget(drawWidget(name, refreshed, Date.now(), prefs));
      return;
    }
    renderWidget(drawWidget(name, await readSnapshot(), Date.now(), prefs));
    return;
  }
  let snapshot = await readSnapshot();
  renderWidget(drawWidget(name, snapshot, Date.now(), prefs));
  if ((widgetAction === 'WIDGET_UPDATE' || widgetAction === 'WIDGET_ADDED')
    && (name === WIDGETS.today || name === WIDGETS.upcoming || name === WIDGETS.calendar || name === WIDGETS.habits)) {
    snapshot = await fetched(snapshot, name === WIDGETS.habits);
    renderWidget(drawWidget(name, snapshot, Date.now(), prefs));
  }
};
