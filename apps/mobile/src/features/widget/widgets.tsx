import { FlexWidget, ListWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import type { UpcomingRow, WidgetRow } from './items';
import { ACTIONS } from './names';


type Hex = `#${string}`;
interface Palette {
  background: Hex; text: Hex; muted: Hex; faint: Hex; accent: Hex; accentSoft: Hex; onAccent: Hex; danger: Hex; warning: Hex;
  success: Hex; border: Hex; track: Hex;
}

// The app's own colours, so the widgets read as part of it on either home screen.
const light: Palette = {
  background: '#FFFFFF', text: '#1D2129', muted: '#667085', faint: '#A4ACB9', accent: '#3574F0', accentSoft: '#E8F0FE', onAccent: '#FFFFFF',
  danger: '#DC4C3E', warning: '#E5870B', success: '#1F9D63', border: '#E6E9EE', track: '#F3F5F8',
};
const dark: Palette = {
  background: '#1D2024', text: '#ECEEF1', muted: '#9BA3AF', faint: '#687080', accent: '#5B8FF7', accentSoft: '#1C2A47', onAccent: '#FFFFFF',
  danger: '#F0685C', warning: '#F0A03C', success: '#4CC38A', border: '#31353C', track: '#272B31',
};

const RADIUS = 20;
const both = <P,>(Widget: (props: P & { palette: Palette }) => React.JSX.Element, props: P) =>
  ({ light: <Widget {...props} palette={light} />, dark: <Widget {...props} palette={dark} /> });

const svg = (body: string, size = 24) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
const ring = (color: string) => svg(`<circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="2"/>`);
const plus = (background: string, foreground: string) =>
  svg(`<circle cx="16" cy="16" r="16" fill="${background}"/><path d="M16 9v14M9 16h14" stroke="${foreground}" stroke-width="2.4" stroke-linecap="round"/>`, 32);
/** A progress ring with a check when the goal is met. */
function progressRing(ratio: number, palette: Palette): string {
  const r = 9;
  const length = 2 * Math.PI * r;
  if (ratio >= 1) {
    return svg(`<circle cx="12" cy="12" r="10" fill="${palette.success}"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return svg(`<circle cx="12" cy="12" r="${r}" fill="none" stroke="${palette.track}" stroke-width="2.6"/>`
    + (ratio > 0 ? `<circle cx="12" cy="12" r="${r}" fill="none" stroke="${palette.success}" stroke-width="2.6" stroke-linecap="round" `
      + `stroke-dasharray="${(length * ratio).toFixed(2)} ${length.toFixed(2)}" transform="rotate(-90 12 12)"/>` : ''));
}

function tint(palette: Palette, priority: number): Hex {
  return priority === 1 ? palette.danger : priority === 2 ? palette.warning : priority === 3 ? palette.accent : palette.faint;
}

function Header({ title, subtitle, palette, uri, add, subtitleColor }: {
  title: string; subtitle: string; palette: Palette; uri: string; add?: boolean; subtitleColor?: Hex;
}) {
  return (
    <FlexWidget
      clickAction="OPEN_URI" clickActionData={{ uri }} accessibilityLabel={title + ' 열기'}
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 }}>
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget text={title} style={{ fontSize: 17, fontWeight: '800', color: palette.text }} />
        <TextWidget text={subtitle} maxLines={1} truncate="END" style={{ fontSize: 12, color: subtitleColor ?? palette.muted, marginTop: 1 }} />
      </FlexWidget>
      {add ? (
        <SvgWidget
          svg={plus(palette.accent, palette.onAccent)} clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///add' }}
          accessibilityLabel="할 일 추가" style={{ height: 32, width: 32 }} />
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

function Message({ text, palette, uri }: { text: string; palette: Palette; uri: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI" clickActionData={{ uri }}
      style={{ height: 'match_parent', width: 'match_parent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
      <TextWidget text={text} style={{ fontSize: 13, color: palette.muted, textAlign: 'center' }} />
    </FlexWidget>
  );
}

const SIGNED_OUT = '앱에서 로그인하면 여기에 보입니다.';

function TaskLine({ row, palette, completable }: { row: WidgetRow; palette: Palette; completable: boolean }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///task/' + row.id }} accessibilityLabel={row.title}
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingLeft: completable ? 8 : 16, paddingRight: 16, height: 44 }}>
      {completable ? (
        <SvgWidget
          svg={ring(tint(palette, row.priority))} clickAction={ACTIONS.complete}
          clickActionData={{ id: row.id, occurrence: row.occurrence }} accessibilityLabel={row.title + ' 완료'}
          style={{ height: 44, width: 40, paddingHorizontal: 8, paddingVertical: 10 }} />
      ) : (
        <FlexWidget style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: tint(palette, row.priority), marginRight: 12 }} />
      )}
      <FlexWidget style={{ flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: palette.border }}>
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget text={row.title} maxLines={1} truncate="END" style={{ fontSize: 15, color: palette.text }} />
        </FlexWidget>
        {row.when ? <TextWidget text={row.when} maxLines={1} style={{ fontSize: 12, color: row.overdue ? palette.danger : palette.muted, marginLeft: 8 }} /> : null}
      </FlexWidget>
    </FlexWidget>
  );
}

// ---- 오늘 할 일

export interface TodayWidgetProps { rows: WidgetRow[]; date: string; signedIn: boolean; notice?: string | null }

function Today({ rows, date, signedIn, notice, palette }: TodayWidgetProps & { palette: Palette }) {
  return (
    <Frame palette={palette}>
      <Header
        title="오늘" uri="dayframe:///" add={signedIn} palette={palette} subtitleColor={notice ? palette.danger : undefined}
        subtitle={notice ?? date + (signedIn && rows.length ? ' · ' + rows.length + '개' : '')} />
      {!signedIn ? <Message text={SIGNED_OUT} palette={palette} uri="dayframe:///" />
        : rows.length === 0 ? <Message text="오늘 할 일을 모두 마쳤습니다." palette={palette} uri="dayframe:///add" />
          : (
            <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
              {rows.map((row) => <TaskLine key={row.id} row={row} palette={palette} completable />)}
            </ListWidget>
          )}
    </Frame>
  );
}
export const todayWidget = (props: TodayWidgetProps) => both(Today, props);

// ---- 예정

export interface UpcomingWidgetProps { rows: UpcomingRow[]; signedIn: boolean }

function Upcoming({ rows, signedIn, palette }: UpcomingWidgetProps & { palette: Palette }) {
  const count = rows.filter((row) => row.kind === 'task').length;
  return (
    <Frame palette={palette}>
      <Header title="예정" subtitle={signedIn ? (count ? '앞으로 7일 · ' + count + '개' : '앞으로 7일') : ''} uri="dayframe:///upcoming" add={signedIn} palette={palette} />
      {!signedIn ? <Message text={SIGNED_OUT} palette={palette} uri="dayframe:///" />
        : count === 0 ? <Message text="앞으로 7일 동안 예정된 일이 없습니다." palette={palette} uri="dayframe:///add" />
          : (
            <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
              {rows.map((row) => (row.kind === 'day' ? (
                <FlexWidget key={row.key} style={{ width: 'match_parent', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 }}>
                  <TextWidget text={row.label} style={{ fontSize: 12, fontWeight: '700', color: palette.accent }} />
                </FlexWidget>
              ) : <TaskLine key={row.id} row={row} palette={palette} completable={false} />))}
            </ListWidget>
          )}
    </Frame>
  );
}
export const upcomingWidget = (props: UpcomingWidgetProps) => both(Upcoming, props);

// ---- 습관

export interface HabitWidgetRow { id: string; name: string; label: string; ratio: number; date: string }
export interface HabitsWidgetProps { rows: HabitWidgetRow[]; signedIn: boolean; notice?: string | null }

function Habits({ rows, signedIn, notice, palette }: HabitsWidgetProps & { palette: Palette }) {
  const done = rows.filter((row) => row.ratio >= 1).length;
  return (
    <Frame palette={palette}>
      <Header
        title="습관" uri="dayframe:///habits" palette={palette} subtitleColor={notice ? palette.danger : undefined}
        subtitle={notice ?? (signedIn && rows.length ? '오늘 ' + done + '/' + rows.length + ' 달성' : '')} />
      {!signedIn ? <Message text={SIGNED_OUT} palette={palette} uri="dayframe:///" />
        : rows.length === 0 ? <Message text="앱에서 습관을 추가해 보세요." palette={palette} uri="dayframe:///habit/new" />
          : (
            <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
              {rows.map((row) => (
                <FlexWidget
                  key={row.id} clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///habit/' + row.id }} accessibilityLabel={row.name}
                  style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 16, height: 46 }}>
                  <SvgWidget
                    svg={progressRing(row.ratio, palette)} clickAction={ACTIONS.habit} clickActionData={{ id: row.id }}
                    accessibilityLabel={row.name + ' 기록'} style={{ height: 46, width: 40, paddingHorizontal: 8, paddingVertical: 11 }} />
                  <FlexWidget style={{ flex: 1, height: 46, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: palette.border }}>
                    <FlexWidget style={{ flex: 1 }}>
                      <TextWidget text={row.name} maxLines={1} truncate="END" style={{ fontSize: 15, color: palette.text }} />
                    </FlexWidget>
                    <TextWidget text={row.label} style={{ fontSize: 12, color: row.ratio >= 1 ? palette.success : palette.muted, marginLeft: 8 }} />
                  </FlexWidget>
                </FlexWidget>
              ))}
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
}

function FocusButton({ label, palette, action, data, primary }: { label: string; palette: Palette; action: string; data: Record<string, unknown>; primary?: boolean }) {
  return (
    <FlexWidget
      clickAction={action} clickActionData={data} accessibilityLabel={label}
      style={{ flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? palette.accent : palette.accentSoft }}>
      <TextWidget text={label} style={{ fontSize: 14, fontWeight: '700', color: primary ? palette.onAccent : palette.accent }} />
    </FlexWidget>
  );
}

function Focus({ signedIn, running, endsAt, plannedMinutes, count, minutes, notice, palette }: FocusWidgetProps & { palette: Palette }) {
  const today = count ? '오늘 ' + count + '회 · ' + minutes + '분' : '오늘 첫 집중을 시작해 보세요';
  return (
    <Frame palette={palette}>
      <Header title="집중" subtitle={notice ?? today} uri="dayframe:///focus" palette={palette} subtitleColor={notice ? palette.danger : undefined} />
      {!signedIn ? <Message text={SIGNED_OUT} palette={palette} uri="dayframe:///" /> : (
        <FlexWidget style={{ width: 'match_parent', height: 'match_parent', paddingHorizontal: 14, paddingBottom: 8, justifyContent: 'space-between' }}>
          <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///focus' }} style={{ width: 'match_parent', flex: 1, justifyContent: 'center' }}>
            {running ? (
              <FlexWidget>
                <TextWidget text={endsAt + '까지'} style={{ fontSize: 24, fontWeight: '700', color: palette.text }} />
                <TextWidget text={plannedMinutes + '분 집중 중'} style={{ fontSize: 13, color: palette.accent, marginTop: 2 }} />
              </FlexWidget>
            ) : (
              <TextWidget text="뽀모도로" style={{ fontSize: 20, fontWeight: '700', color: palette.text }} />
            )}
          </FlexWidget>
          {running ? (
            <FlexWidget style={{ width: 'match_parent', flexDirection: 'row' }}>
              <FocusButton label="그만두기" palette={palette} action={ACTIONS.stopFocus} data={{ id: running.id }} />
            </FlexWidget>
          ) : (
            <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 8 }}>
              <FocusButton label="25분" palette={palette} action={ACTIONS.startFocus} data={{ minutes: 25 }} primary />
              <FocusButton label="50분" palette={palette} action={ACTIONS.startFocus} data={{ minutes: 50 }} />
            </FlexWidget>
          )}
        </FlexWidget>
      )}
    </Frame>
  );
}
export const focusWidget = (props: FocusWidgetProps) => both(Focus, props);

// ---- 빠른 추가

function QuickAdd({ palette }: { palette: Palette }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///add' }} accessibilityLabel="할 일 추가"
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: palette.background, borderRadius: RADIUS, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
      <SvgWidget svg={plus(palette.accent, palette.onAccent)} style={{ height: 32, width: 32 }} />
      <FlexWidget style={{ flex: 1, marginLeft: 10 }}>
        <TextWidget text="할 일 추가" style={{ fontSize: 15, fontWeight: '600', color: palette.text }} />
        <TextWidget text="예: 내일 7시 운동 #건강" maxLines={1} truncate="END" style={{ fontSize: 12, color: palette.faint }} />
      </FlexWidget>
    </FlexWidget>
  );
}
export const quickAddWidget = () => both(QuickAdd, {});
