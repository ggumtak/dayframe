import { FlexWidget, ListWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { type AccentId, accentPalette, DEFAULT_ACCENT } from '../settings/palettes';
import type { StartOfWeek } from '../settings/prefs';
import type { TodayWidgetItem, UpcomingRow, WidgetRow } from './items';
import { ACTIONS } from './names';
import { priorityMark } from '../tasks/priority';


type Hex = `#${string}`;
interface Palette {
  background: Hex; text: Hex; muted: Hex; faint: Hex; control: Hex; accent: Hex; accentText: Hex; onAccent: Hex; danger: Hex;
  border: Hex; track: Hex;
}

// The app's own tokens (src/theme/tokens.ts, default blue), copied because widgets are drawn natively, outside the
// theme. The same budget as the app: neutral rows, the accent only for the add button and progress, red only overdue.
const light: Palette = {
  background: '#FFFFFF', text: '#1D2129', muted: '#5C6675', faint: '#858E9C', control: '#868E9C', accent: '#2B66E0', accentText: '#2B66E0',
  onAccent: '#FFFFFF', danger: '#CC3A2E', border: '#E6E9EE', track: '#F3F5F8',
};
const dark: Palette = {
  background: '#1D2024', text: '#E8EAED', muted: '#A0A7B2', faint: '#767E8B', control: '#7A8290', accent: '#3B6CD0', accentText: '#82ADFE',
  onAccent: '#F5F7FA', danger: '#F08074', border: '#31353C', track: '#272B31',
};

function palettesFor(accent: AccentId = DEFAULT_ACCENT): { light: Palette; dark: Palette } {
  const chosen = accentPalette(accent);
  return {
    light: { ...light, accent: chosen.light.accent as Hex, accentText: chosen.light.accentText as Hex },
    dark: { ...dark, accent: chosen.dark.accent as Hex, accentText: chosen.dark.accentText as Hex },
  };
}

const RADIUS = 20;
const both = <P extends { accent?: AccentId }>(Widget: (props: P & { palette: Palette }) => React.JSX.Element, props: P) => {
  const { light: lightPalette, dark: darkPalette } = palettesFor(props.accent);
  return { light: <Widget {...props} palette={lightPalette} />, dark: <Widget {...props} palette={darkPalette} /> };
};

const svg = (body: string, size = 24) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
const ring = (color: string) => svg(`<circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="2"/>`);
const repeatRing = (color: string) =>
  svg(`<circle cx="12" cy="12" r="8.5" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="3 2.5"/>`
    + `<path d="M9.5 12a2.5 2.5 0 0 1 4.3-1.7M14.5 12a2.5 2.5 0 0 1-4.3 1.7" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`);
const refreshIcon = (color: string) =>
  svg(`<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v3.8h-3.8" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
const searchIcon = (color: string) =>
  svg(`<circle cx="11" cy="11" r="6.5" fill="none" stroke="${color}" stroke-width="2"/><path d="M16 16l4 4" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);
const focusIcon = (color: string) =>
  svg(`<circle cx="12" cy="12" r="8" fill="none" stroke="${color}" stroke-width="2"/><path d="M12 8v4l2.8 1.8" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
const plus = (background: string, foreground: string) =>
  svg(`<circle cx="12" cy="12" r="12" fill="${background}"/><path d="M12 7.5v9M7.5 12h9" stroke="${foreground}" stroke-width="2.0" stroke-linecap="round"/>`, 24);
const postponeIcon = (color: string) =>
  svg(`<path d="M5 12h13M13 7l5 5-5 5" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`);

function overlayQuickAddUri(kind: 'task' | 'habit', widget: string, defaultDate?: string): string {
  const params = [`kind=${kind}`];
  if (defaultDate) params.push(`defaultDate=${encodeURIComponent(defaultDate)}`);
  params.push(`widget=${encodeURIComponent(widget)}`);
  return `dayframe-overlay://quick-add?${params.join('&')}`;
}

/** A progress ring with a check when the goal is met. */
function progressRing(ratio: number, palette: Palette): string {
  const r = 9;
  const length = 2 * Math.PI * r;
  if (ratio >= 1) {
    return svg(`<circle cx="12" cy="12" r="10" fill="${palette.accent}"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="${palette.onAccent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return svg(`<circle cx="12" cy="12" r="${r}" fill="none" stroke="${palette.control}" stroke-width="1.5"/>`
    + (ratio > 0 ? `<circle cx="12" cy="12" r="${r}" fill="none" stroke="${palette.accent}" stroke-width="2.6" stroke-linecap="round" `
      + `stroke-dasharray="${(length * ratio).toFixed(2)} ${length.toFixed(2)}" transform="rotate(-90 12 12)"/>` : ''));
}

function Header({
  title, subtitle, palette, uri, add,
  addUri = overlayQuickAddUri('task', 'Today', 'today'),
  addLabel = '할 일 추가', refresh, progress, subtitleColor,
}: {
  title: string; subtitle: string; palette: Palette; uri: string; add?: boolean; addUri?: string; addLabel?: string;
  refresh?: boolean; progress?: number | null; subtitleColor?: Hex;
}) {
  const pct = progress !== null && progress !== undefined ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : null;
  return (
    <FlexWidget style={{ width: 'match_parent', paddingHorizontal: 16, paddingBottom: 6 }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri }} accessibilityLabel={title + ' 열기'} style={{ flex: 1 }}>
          <TextWidget text={title} style={{ fontSize: 17, fontWeight: '800', color: palette.text }} />
          {subtitle ? (
            <TextWidget text={subtitle} maxLines={1} truncate="END" style={{ fontSize: 12, color: subtitleColor ?? palette.muted, marginTop: 1 }} />
          ) : null}
        </FlexWidget>
        {refresh ? (
          <SvgWidget
            svg={refreshIcon(palette.faint)} clickAction={ACTIONS.refresh}
            accessibilityLabel="위젯 새로고침" style={{ height: 24, width: 24, padding: 3, marginRight: add ? 6 : 0 }} />
        ) : null}
        {add ? (
          <SvgWidget
            svg={plus(palette.accent, palette.onAccent)} clickAction="OPEN_URI" clickActionData={{ uri: addUri }}
            accessibilityLabel={addLabel} style={{ height: 26, width: 26, padding: 1 }} />
        ) : null}
      </FlexWidget>
      {pct !== null ? (
        <FlexWidget style={{ width: 'match_parent', height: 4, marginTop: 6, borderRadius: 2, backgroundColor: palette.track, flexDirection: 'row', overflow: 'hidden' }}>
          {pct > 0 ? <FlexWidget style={{ width: 0, height: 'match_parent', flex: pct, backgroundColor: palette.accent, borderRadius: 2 }} /> : null}
          {pct < 100 ? <FlexWidget style={{ width: 0, height: 'match_parent', flex: 100 - pct }} /> : null}
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

function Frame({ palette, children }: { palette: Palette; children: React.ReactNode }) {
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: palette.background, borderRadius: RADIUS, paddingTop: 12, paddingBottom: 6 }}>
      {children}
    </FlexWidget>
  );
}

function Message({ text, subtext, palette, uri }: { text: string; subtext?: string; palette: Palette; uri: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI" clickActionData={{ uri }}
      style={{ height: 'match_parent', width: 'match_parent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
      <TextWidget text={text} style={{ fontSize: 13, fontWeight: '600', color: palette.muted, textAlign: 'center' }} />
      {subtext ? <TextWidget text={subtext} style={{ fontSize: 11, color: palette.faint, textAlign: 'center', marginTop: 2 }} /> : null}
    </FlexWidget>
  );
}

const SIGNED_OUT = {
  tasks: '앱에서 로그인하면 할 일이 표시됩니다.',
  habits: '앱에서 로그인하면 습관이 표시됩니다.',
  focus: '앱에서 로그인하면 집중을 시작할 수 있습니다.',
  calendar: '앱에서 로그인하면 일정이 표시됩니다.',
} as const;

function SectionLabel({ label, danger, palette, uri, actionLabel, actionClick, actionData }: {
  label: string; danger?: boolean; palette: Palette; uri?: string;
  actionLabel?: string; actionClick?: string; actionData?: Record<string, unknown>;
}) {
  return (
    <FlexWidget
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 2 }}>
      <FlexWidget
        {...(uri ? { clickAction: 'OPEN_URI' as const, clickActionData: { uri } } : {})}
        style={{ flex: 1 }}>
        <TextWidget text={label} style={{ fontSize: 11, fontWeight: '700', color: danger ? palette.danger : palette.muted }} />
      </FlexWidget>
      {actionLabel && actionClick ? (
        <FlexWidget
          clickAction={actionClick}
          {...(actionData ? { clickActionData: actionData } : {})}
          accessibilityLabel={actionLabel}
          style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.track, marginLeft: 8 }}>
          <TextWidget text={actionLabel} style={{ fontSize: 11, fontWeight: '700', color: palette.accentText }} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

function TaskLine({ row, palette, allowPostpone = false }: { row: WidgetRow; palette: Palette; allowPostpone?: boolean }) {
  const completable = row.completable !== false;
  const rawTaskId = row.id.includes('@') ? row.id.split('@')[0] : row.id;
  return (
    <FlexWidget
      clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///task/' + rawTaskId }} accessibilityLabel={row.title}
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: allowPostpone && completable ? 10 : 16, height: row.meta ? 50 : 44 }}>
      {completable ? (
        <SvgWidget
          svg={ring(row.overdue ? palette.danger : palette.control)} clickAction={ACTIONS.complete}
          clickActionData={{ id: rawTaskId, occurrence: row.occurrence }} accessibilityLabel={row.title + ' 완료'}
          style={{ height: 44, width: 40, paddingHorizontal: 8, paddingVertical: 10 }} />
      ) : (
        <SvgWidget
          svg={repeatRing(palette.faint)}
          accessibilityLabel={row.title + ' 반복 예정'}
          style={{ height: 44, width: 40, paddingHorizontal: 8, paddingVertical: 10 }} />
      )}
      <FlexWidget style={{
        flex: 1, height: row.meta ? 50 : 44, flexDirection: 'row', alignItems: 'center',
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text={(row.priority < 4 ? priorityMark(row.priority as 1 | 2 | 3) + ' ' : '') + row.title} maxLines={1} truncate="END"
            style={{ fontSize: 14, fontWeight: row.priority <= 2 ? '600' : '400', color: completable ? palette.text : palette.muted }} />
          {row.meta ? (
            <TextWidget text={row.meta} maxLines={1} truncate="END" style={{ fontSize: 11, color: palette.faint, marginTop: 1 }} />
          ) : null}
        </FlexWidget>
        {row.when ? (
          <TextWidget
            text={row.when} maxLines={1}
            style={{ fontSize: 12, fontWeight: row.overdue ? '600' : '400', color: row.overdue ? palette.danger : palette.muted, marginLeft: 8 }} />
        ) : null}
        {completable && allowPostpone ? (
          <SvgWidget
            svg={postponeIcon(palette.faint)}
            clickAction={ACTIONS.postpone}
            clickActionData={{ id: rawTaskId, occurrence: row.occurrence }}
            accessibilityLabel={row.title + ' 내일로 미루기'}
            style={{ height: 24, width: 24, padding: 4, marginLeft: 4 }} />
        ) : null}
      </FlexWidget>
    </FlexWidget>
  );
}

// ---- 오늘 할 일

export interface TodayWidgetProps {
  items: TodayWidgetItem[];
  subtitle: string;
  progress: number | null;
  doneCount: number;
  signedIn: boolean;
  notice?: string | null;
  accent?: AccentId;
}

function Today({ items, subtitle, progress, doneCount, signedIn, notice, palette }: TodayWidgetProps & { palette: Palette }) {
  const hasTasks = items.some((item) => item.kind === 'task');
  const addUri = overlayQuickAddUri('task', 'Today', 'today');
  return (
    <Frame palette={palette}>
      <Header
        title="오늘" uri="dayframe:///" add={signedIn} addUri={addUri} refresh={signedIn} palette={palette}
        progress={signedIn ? progress : null}
        subtitleColor={notice ? palette.danger : undefined}
        subtitle={notice ?? subtitle} />
      {!signedIn ? <Message text={SIGNED_OUT.tasks} palette={palette} uri="dayframe:///" />
        : !hasTasks ? (
          <Message
            text={doneCount > 0 ? `오늘 할 일 ${doneCount}개를 모두 마쳤습니다.` : '오늘 남은 할 일이 없습니다.'}
            subtext="눌러서 새 할 일을 추가해 보세요"
            palette={palette} uri={addUri} />
        ) : (
          <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
            {items.map((item) => (item.kind === 'section'
              ? (
                <SectionLabel
                  key={item.key} label={item.label} danger={item.danger} palette={palette} uri="dayframe:///"
                  actionLabel={item.danger ? '모두 오늘로' : undefined}
                  actionClick={item.danger ? ACTIONS.rescheduleOverdue : undefined} />
              )
              : <TaskLine key={item.id} row={item} palette={palette} allowPostpone />))}
          </ListWidget>
        )}
    </Frame>
  );
}
export const todayWidget = (props: TodayWidgetProps) => both(Today, props);

// ---- 예정

export interface UpcomingWidgetProps {
  rows: UpcomingRow[];
  signedIn: boolean;
  stamp?: number;
  notice?: string | null;
  accent?: AccentId;
}

function Upcoming({ rows, signedIn, stamp = 0, notice, palette }: UpcomingWidgetProps & { palette: Palette }) {
  const count = rows.filter((row) => row.kind === 'task').length;
  const addUri = overlayQuickAddUri('task', 'Upcoming', 'tomorrow');
  return (
    <Frame palette={palette}>
      <Header
        title="예정"
        subtitle={notice ?? (signedIn ? (count ? '앞으로 7일 · ' + count + '개' : '앞으로 7일') : '')}
        subtitleColor={notice ? palette.danger : undefined}
        uri="dayframe:///upcoming" add={signedIn} addUri={addUri} refresh={signedIn} palette={palette} />
      {!signedIn ? <Message text={SIGNED_OUT.tasks} palette={palette} uri="dayframe:///" />
        : count === 0 ? <Message text="앞으로 7일간 예정된 할 일이 없습니다." subtext="눌러서 일정을 추가해 보세요" palette={palette} uri={addUri} />
          : (
            <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
              {rows.map((row) => (row.kind === 'day' ? (
                <SectionLabel
                  key={row.key} label={`${row.label} · ${row.count}`} palette={palette}
                  uri={`dayframe:///upcoming?view=month&date=${row.key}&at=${stamp}`} />
              ) : <TaskLine key={row.id} row={row} palette={palette} />))}
            </ListWidget>
          )}
    </Frame>
  );
}
export const upcomingWidget = (props: UpcomingWidgetProps) => both(Upcoming, props);

// ---- 습관

export interface HabitWidgetRow { id: string; name: string; label: string; ratio: number; date: string }
export interface HabitsWidgetProps {
  rows: HabitWidgetRow[];
  signedIn: boolean;
  notice?: string | null;
  accent?: AccentId;
}

function Habits({ rows, signedIn, notice, palette }: HabitsWidgetProps & { palette: Palette }) {
  const done = rows.filter((row) => row.ratio >= 1).length;
  const ordered = [...rows].sort((a, b) => Number(a.ratio >= 1) - Number(b.ratio >= 1));
  const progress = rows.length > 0 ? done / rows.length : null;
  const addUri = overlayQuickAddUri('habit', 'Habits');
  return (
    <Frame palette={palette}>
      <Header
        title="습관" uri="dayframe:///habits" add={signedIn} addUri={addUri} addLabel="습관 추가"
        refresh={signedIn} progress={signedIn ? progress : null} palette={palette}
        subtitleColor={notice ? palette.danger : undefined}
        subtitle={notice ?? (signedIn && rows.length ? '오늘 ' + done + '/' + rows.length + ' 달성' : '')} />
      {!signedIn ? <Message text={SIGNED_OUT.habits} palette={palette} uri="dayframe:///" />
        : ordered.length === 0 ? <Message text="오늘 실천할 습관을 만들어 보세요." subtext="눌러서 첫 습관을 추가해 보세요" palette={palette} uri={addUri} />
          : (
            <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
              {ordered.map((row) => {
                const met = row.ratio >= 1;
                return (
                  <FlexWidget
                    key={row.id} clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///habit/' + row.id }} accessibilityLabel={row.name}
                    style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 16, height: 46 }}>
                    <SvgWidget
                      svg={progressRing(row.ratio, palette)} clickAction={ACTIONS.habit} clickActionData={{ id: row.id }}
                      accessibilityLabel={row.name + ' 기록'} style={{ height: 46, width: 40, paddingHorizontal: 8, paddingVertical: 11 }} />
                    <FlexWidget style={{ flex: 1, height: 46, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: palette.border }}>
                      <FlexWidget style={{ flex: 1 }}>
                        <TextWidget text={row.name} maxLines={1} truncate="END" style={{ fontSize: 14, color: met ? palette.muted : palette.text }} />
                      </FlexWidget>
                      <TextWidget text={met ? '달성 · ' + row.label : row.label} style={{ fontSize: 12, color: met ? palette.faint : palette.muted, marginLeft: 8 }} />
                    </FlexWidget>
                  </FlexWidget>
                );
              })}
            </ListWidget>
          )}
    </Frame>
  );
}
export const habitsWidget = (props: HabitsWidgetProps) => both(Habits, props);

// ---- 집중

export interface FocusWidgetProps {
  signedIn: boolean;
  running: { id: string } | null;
  endsAt: string | null;
  plannedMinutes: number | null;
  count: number;
  minutes: number;
  notice?: string | null;
  presets?: readonly number[];
  primaryMinutes?: number;
  accent?: AccentId;
}

const DEFAULT_FOCUS_PRESETS: readonly number[] = [15, 25, 50];

function focusButtonLabel(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}시간`;
  return `${minutes}분`;
}

function FocusButton({ label, palette, action, data, primary }: { label: string; palette: Palette; action: string; data: Record<string, unknown>; primary?: boolean }) {
  return (
    <FlexWidget
      clickAction={action} clickActionData={data} accessibilityLabel={label}
      style={{ flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? palette.accent : palette.track }}>
      <TextWidget text={label} style={{ fontSize: 13, fontWeight: '700', color: primary ? palette.onAccent : palette.text }} />
    </FlexWidget>
  );
}

function Focus({ signedIn, running, endsAt, plannedMinutes, count, minutes, notice, presets, primaryMinutes, palette }: FocusWidgetProps & { palette: Palette }) {
  const today = count ? '오늘 ' + count + '회 · ' + minutes + '분' : '오늘 첫 집중을 시작해 보세요';
  const isStopwatch = !!running && plannedMinutes === 480;
  const buttonPresets = presets && presets.length > 0 ? presets : DEFAULT_FOCUS_PRESETS;
  const highlighted = primaryMinutes ?? (buttonPresets.includes(25) ? 25 : buttonPresets[Math.floor(buttonPresets.length / 2)]);
  return (
    <Frame palette={palette}>
      <Header
        title="집중" subtitle={notice ?? today} subtitleColor={notice ? palette.danger : undefined}
        uri="dayframe:///focus" palette={palette} />
      {!signedIn ? <Message text={SIGNED_OUT.focus} palette={palette} uri="dayframe:///" /> : (
        <FlexWidget style={{ width: 'match_parent', height: 'match_parent', paddingHorizontal: 14, paddingBottom: 8, justifyContent: 'space-between' }}>
          <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///focus' }} style={{ width: 'match_parent', flex: 1, justifyContent: 'center' }}>
            {running ? (
              <FlexWidget>
                <TextWidget text={isStopwatch ? '측정 중' : endsAt + '까지'} style={{ fontSize: 22, fontWeight: '700', color: palette.text }} />
                <TextWidget text={isStopwatch ? '스톱워치 실행 중' : plannedMinutes + '분 집중 중'} style={{ fontSize: 12, color: palette.muted, marginTop: 2 }} />
              </FlexWidget>
            ) : (
              <TextWidget text="뽀모도로" style={{ fontSize: 19, fontWeight: '700', color: palette.text }} />
            )}
          </FlexWidget>
          {running ? (
            <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 6 }}>
              {!isStopwatch ? (
                <FocusButton label="+5분" palette={palette} action={ACTIONS.extendFocus} data={{ id: running.id, addSeconds: 300 }} />
              ) : null}
              <FocusButton label="완료" palette={palette} action={ACTIONS.completeFocus} data={{ id: running.id }} primary />
              <FocusButton label="중단" palette={palette} action={ACTIONS.stopFocus} data={{ id: running.id }} />
            </FlexWidget>
          ) : (
            <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 6 }}>
              {buttonPresets.map((preset) => (
                <FocusButton
                  key={preset}
                  label={focusButtonLabel(preset)}
                  palette={palette}
                  action={ACTIONS.startFocus}
                  data={{ minutes: preset }}
                  primary={preset === highlighted} />
              ))}
            </FlexWidget>
          )}
        </FlexWidget>
      )}
    </Frame>
  );
}
export const focusWidget = (props: FocusWidgetProps) => both(Focus, props);

// ---- 빠른 추가 (4×1 홈 화면 빠른 실행 바)

export interface QuickAddWidgetProps {
  accent?: AccentId;
  focusMinutes?: number;
  notice?: string | null;
}

function QuickBarIcon({ svgXml, uri, action, data, label, palette }: {
  svgXml: string; uri?: string; action?: string; data?: Record<string, unknown>; label: string; palette: Palette;
}) {
  return (
    <FlexWidget
      clickAction={action ?? 'OPEN_URI'}
      clickActionData={action ? (data ?? {}) : { uri }}
      accessibilityLabel={label}
      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: palette.track, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}>
      <SvgWidget svg={svgXml} style={{ width: 16, height: 16 }} />
    </FlexWidget>
  );
}

function QuickAdd({ focusMinutes = 25, notice, palette }: QuickAddWidgetProps & { palette: Palette }) {
  const addUri = overlayQuickAddUri('task', 'QuickAdd', 'today');
  return (
    <FlexWidget
      style={{
        height: 'match_parent', width: 'match_parent', backgroundColor: palette.background, borderRadius: RADIUS,
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10,
      }}>
      <FlexWidget
        clickAction="OPEN_URI" clickActionData={{ uri: addUri }} accessibilityLabel="할 일 빠른 추가"
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: 'match_parent' }}>
        <SvgWidget svg={plus(palette.accent, palette.onAccent)} style={{ height: 28, width: 28, padding: 1 }} />
        <FlexWidget style={{ flex: 1, marginLeft: 10 }}>
          <TextWidget text="할 일 빠른 추가" style={{ fontSize: 14, fontWeight: '700', color: palette.text }} />
          <TextWidget
            text={notice ?? '예: 금요일 3시 회의 #업무 !!!'} maxLines={1} truncate="END"
            style={{ fontSize: 11, color: notice ? palette.danger : palette.faint }} />
        </FlexWidget>
      </FlexWidget>
      <QuickBarIcon svgXml={searchIcon(palette.muted)} uri="dayframe:///search" label="할 일 검색" palette={palette} />
      <QuickBarIcon
        svgXml={focusIcon(palette.muted)}
        action={ACTIONS.startFocus}
        data={{ minutes: focusMinutes }}
        label={focusMinutes + '분 집중 바로 시작'}
        palette={palette} />
    </FlexWidget>
  );
}
export const quickAddWidget = (props: QuickAddWidgetProps = {}) => both(QuickAdd, props);

// ---- 달력

export interface CalendarWidgetProps {
  signedIn: boolean;
  title: string;
  weeks: ({ date: string; day: number; today: boolean; count: number; weekend: boolean } | null)[][];
  /** Changes on every draw so tapping the same day twice still opens it. */
  stamp: number;
  canBack: boolean;
  canAhead: boolean;
  startOfWeek?: StartOfWeek;
  selectedDate?: string | null;
  selectedDateLabel?: string | null;
  selectedRows?: WidgetRow[];
  accent?: AccentId;
}

const MONDAY_FIRST_DAYS = ['월', '화', '수', '목', '금', '토', '일'] as const;
const SUNDAY_FIRST_DAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

function NavButton({ label, direction, enabled, palette }: { label: string; direction: number; enabled: boolean; palette: Palette }) {
  const path = direction < 0 ? 'M14 6l-6 6 6 6' : 'M10 6l6 6-6 6';
  return (
    <SvgWidget
      svg={svg(`<path d="${path}" fill="none" stroke="${enabled ? palette.text : palette.border}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`)}
      {...(enabled ? { clickAction: ACTIONS.calendarMove, clickActionData: { by: direction } } : {})}
      accessibilityLabel={label} style={{ height: 32, width: 32, padding: 4 }} />
  );
}

function CalendarAgendaRow({ row, palette }: { row: WidgetRow; palette: Palette }) {
  const completable = row.completable !== false;
  const rawTaskId = row.id.includes('@') ? row.id.split('@')[0] : row.id;
  return (
    <FlexWidget style={{ width: 'match_parent', height: 26, flexDirection: 'row', alignItems: 'center' }}>
      {completable ? (
        <SvgWidget
          svg={ring(row.overdue ? palette.danger : palette.control)}
          clickAction={ACTIONS.complete}
          clickActionData={{ id: rawTaskId, occurrence: row.occurrence }}
          accessibilityLabel={row.title + ' 완료'}
          style={{ height: 24, width: 24, padding: 3 }} />
      ) : (
        <SvgWidget
          svg={repeatRing(palette.faint)}
          accessibilityLabel={row.title + ' 반복 예정'}
          style={{ height: 24, width: 24, padding: 3 }} />
      )}
      <FlexWidget
        clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///task/' + rawTaskId }} accessibilityLabel={row.title}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 4 }}>
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text={(row.priority < 4 ? priorityMark(row.priority as 1 | 2 | 3) + ' ' : '') + row.title}
            maxLines={1} truncate="END"
            style={{ fontSize: 12, fontWeight: row.priority <= 2 ? '600' : '400', color: completable ? palette.text : palette.muted }} />
        </FlexWidget>
        {row.when ? (
          <TextWidget
            text={row.when} maxLines={1}
            style={{ fontSize: 11, color: row.overdue ? palette.danger : palette.muted, marginLeft: 6 }} />
        ) : null}
      </FlexWidget>
    </FlexWidget>
  );
}

function Calendar({
  signedIn, title, weeks, stamp, canBack, canAhead, startOfWeek = 'monday',
  selectedDate, selectedDateLabel, selectedRows, palette,
}: CalendarWidgetProps & { palette: Palette }) {
  const weekdays = startOfWeek === 'sunday' ? SUNDAY_FIRST_DAYS : MONDAY_FIRST_DAYS;
  const hasAgenda = Boolean(selectedDate);
  const previewRows = (selectedRows ?? []).slice(0, 3);
  const extraCount = Math.max(0, (selectedRows?.length ?? 0) - previewRows.length);
  const cellSize = hasAgenda ? 24 : 26;
  return (
    <Frame palette={palette}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8, paddingBottom: 4 }}>
        <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///upcoming?view=month&at=' + stamp }} style={{ flex: 1 }}>
          <TextWidget text={title} style={{ fontSize: 17, fontWeight: '800', color: palette.text }} />
        </FlexWidget>
        <NavButton label="이전 달" direction={-1} enabled={canBack} palette={palette} />
        <SvgWidget
          svg={svg(`<circle cx="12" cy="12" r="3.5" fill="${palette.muted}"/>`)} clickAction={ACTIONS.calendarMove} clickActionData={{ by: 0 }}
          accessibilityLabel="이번 달" style={{ height: 32, width: 28, padding: 6 }} />
        <NavButton label="다음 달" direction={1} enabled={canAhead} palette={palette} />
      </FlexWidget>
      {!signedIn ? <Message text={SIGNED_OUT.calendar} palette={palette} uri="dayframe:///" /> : (
        <FlexWidget style={{ width: 'match_parent', height: 'match_parent', paddingHorizontal: 8 }}>
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row' }}>
            {weekdays.map((name) => (
              <FlexWidget key={name} style={{ flex: 1, alignItems: 'center', paddingVertical: 2 }}>
                <TextWidget text={name} style={{ fontSize: 11, color: palette.faint }} />
              </FlexWidget>
            ))}
          </FlexWidget>
          <FlexWidget style={{ width: 'match_parent', flex: 1 }}>
            {weeks.map((week, row) => (
              <FlexWidget key={row} style={{ width: 'match_parent', flex: 1, flexDirection: 'row' }}>
                {week.map((cell, column) => {
                  if (!cell) return <FlexWidget key={column} style={{ flex: 1 }} />;
                  const isSelected = Boolean(selectedDate && cell.date === selectedDate);
                  return (
                    <FlexWidget
                      key={column} clickAction={ACTIONS.calendarSelect} clickActionData={{ date: cell.date }}
                      accessibilityLabel={cell.day + '일' + (cell.count ? ', 일정 ' + cell.count + '개' : '')}
                      style={{ flex: 1, height: 'match_parent', alignItems: 'center', justifyContent: 'center' }}>
                      <FlexWidget style={{
                        width: cellSize, height: cellSize, borderRadius: cellSize / 2,
                        alignItems: 'center', justifyContent: 'center',
                        backgroundColor: cell.today ? palette.accent : isSelected ? palette.track : palette.background,
                        borderWidth: isSelected && !cell.today ? 1.5 : 0,
                        borderColor: isSelected && !cell.today ? palette.accent : palette.background,
                      }}>
                        <TextWidget
                          text={String(cell.day)}
                          style={{
                            fontSize: hasAgenda ? 12 : 13,
                            fontWeight: cell.today || isSelected || cell.count ? '700' : '400',
                            color: cell.today ? palette.onAccent : isSelected ? palette.accentText : palette.text,
                          }} />
                      </FlexWidget>
                      <FlexWidget style={{ width: 4, height: 4, borderRadius: 2, marginTop: 1, backgroundColor: cell.count ? palette.muted : palette.background }} />
                    </FlexWidget>
                  );
                })}
              </FlexWidget>
            ))}
          </FlexWidget>
          {selectedDate ? (
            <FlexWidget style={{
              width: 'match_parent', borderTopWidth: 1, borderTopColor: palette.border,
              marginTop: 4, paddingTop: 6, paddingHorizontal: 6, paddingBottom: 2,
            }}>
              <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
                <FlexWidget style={{ flex: 1 }}>
                  <TextWidget text={selectedDateLabel ?? selectedDate} maxLines={1} truncate="END" style={{ fontSize: 12, fontWeight: '700', color: palette.text }} />
                </FlexWidget>
                <FlexWidget
                  clickAction="OPEN_URI"
                  clickActionData={{ uri: overlayQuickAddUri('task', 'Calendar', selectedDate) }}
                  accessibilityLabel={(selectedDateLabel ?? selectedDate) + ' 일정 추가'}
                  style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: palette.track, marginRight: 6 }}>
                  <TextWidget text="+ 추가" style={{ fontSize: 11, fontWeight: '700', color: palette.accentText }} />
                </FlexWidget>
                <FlexWidget
                  clickAction="OPEN_URI"
                  clickActionData={{ uri: `dayframe:///upcoming?view=month&date=${selectedDate}&at=${stamp}` }}
                  accessibilityLabel="앱에서 보기"
                  style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
                  <TextWidget text="앱에서 보기" style={{ fontSize: 11, color: palette.muted }} />
                </FlexWidget>
              </FlexWidget>
              {previewRows.length === 0 ? (
                <FlexWidget
                  clickAction="OPEN_URI"
                  clickActionData={{ uri: overlayQuickAddUri('task', 'Calendar', selectedDate) }}
                  style={{ width: 'match_parent', paddingVertical: 4 }}>
                  <TextWidget text="일정이 없습니다 · + 눌러 추가" style={{ fontSize: 11, color: palette.faint }} />
                </FlexWidget>
              ) : (
                <FlexWidget style={{ width: 'match_parent' }}>
                  {previewRows.map((row) => <CalendarAgendaRow key={row.id} row={row} palette={palette} />)}
                  {extraCount > 0 ? (
                    <FlexWidget
                      clickAction="OPEN_URI"
                      clickActionData={{ uri: `dayframe:///upcoming?view=month&date=${selectedDate}&at=${stamp}` }}
                      style={{ width: 'match_parent', paddingTop: 2, paddingLeft: 28 }}>
                      <TextWidget text={`+${extraCount}개 더 보기`} style={{ fontSize: 11, color: palette.muted }} />
                    </FlexWidget>
                  ) : null}
                </FlexWidget>
              )}
            </FlexWidget>
          ) : null}
        </FlexWidget>
      )}
    </Frame>
  );
}
export const calendarWidget = (props: CalendarWidgetProps) => both(Calendar, props);
