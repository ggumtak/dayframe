import { FlexWidget, ListWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetRow } from './items';

export const WIDGET_NAME = 'Today';

/** Click actions the task handler understands; the rest open the app through deep links. */
export const COMPLETE_ACTION = 'COMPLETE';

type Hex = `#${string}`;
interface Palette { background: Hex; text: Hex; muted: Hex; faint: Hex; accent: Hex; onAccent: Hex; danger: Hex; warning: Hex; border: Hex }

// The app's own colours, so the widget reads as part of it on either home screen.
const light: Palette = {
  background: '#FFFFFF', text: '#1D2129', muted: '#667085', faint: '#A4ACB9', accent: '#3574F0', onAccent: '#FFFFFF',
  danger: '#DC4C3E', warning: '#E5870B', border: '#E6E9EE',
};
const dark: Palette = {
  background: '#1D2024', text: '#ECEEF1', muted: '#9BA3AF', faint: '#687080', accent: '#5B8FF7', onAccent: '#FFFFFF',
  danger: '#F0685C', warning: '#F0A03C', border: '#31353C',
};

export interface TodayWidgetProps {
  rows: WidgetRow[];
  date: string;
  signedIn: boolean;
  notice?: string | null;
}

const circle = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
const plus = (background: string, foreground: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="${background}"/>`
  + `<path d="M16 9v14M9 16h14" stroke="${foreground}" stroke-width="2.4" stroke-linecap="round"/></svg>`;

function tint(palette: Palette, priority: number): Hex {
  return priority === 1 ? palette.danger : priority === 2 ? palette.warning : priority === 3 ? palette.accent : palette.faint;
}

function Widget({ rows, date, signedIn, notice, palette }: TodayWidgetProps & { palette: Palette }) {
  const remaining = rows.length;
  return (
    <FlexWidget
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: palette.background, borderRadius: 20, paddingTop: 12, paddingBottom: 6 }}>
      <FlexWidget
        clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///' }} accessibilityLabel="Dayframe 열기"
        style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 }}>
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget text="오늘" style={{ fontSize: 17, fontWeight: '800', color: palette.text }} />
          <TextWidget
            text={notice ?? (signedIn ? date + (remaining ? ' · ' + remaining + '개' : '') : date)} maxLines={1} truncate="END"
            style={{ fontSize: 12, color: notice ? palette.danger : palette.muted, marginTop: 1 }} />
        </FlexWidget>
        {signedIn ? (
          <SvgWidget
            svg={plus(palette.accent, palette.onAccent)} clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///add' }}
            accessibilityLabel="할 일 추가" style={{ height: 32, width: 32 }} />
        ) : null}
      </FlexWidget>

      {!signedIn ? (
        <Message text="앱에서 로그인하면 오늘 할 일이 여기에 보입니다." palette={palette} uri="dayframe:///" />
      ) : remaining === 0 ? (
        <Message text="오늘 할 일을 모두 마쳤습니다." palette={palette} uri="dayframe:///add" />
      ) : (
        <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
          {rows.map((row) => (
            <FlexWidget
              key={row.id} clickAction="OPEN_URI" clickActionData={{ uri: 'dayframe:///task/' + row.id }} accessibilityLabel={row.title}
              style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 16, height: 44 }}>
              <SvgWidget
                svg={circle(tint(palette, row.priority))} clickAction={COMPLETE_ACTION}
                clickActionData={{ id: row.id, occurrence: row.occurrence }} accessibilityLabel={row.title + ' 완료'}
                style={{ height: 44, width: 40, paddingHorizontal: 8, paddingVertical: 10 }} />
              <FlexWidget
                style={{ flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: palette.border }}>
                <FlexWidget style={{ flex: 1 }}>
                  <TextWidget text={row.title} maxLines={1} truncate="END" style={{ fontSize: 15, color: palette.text }} />
                </FlexWidget>
                {row.when ? (
                  <TextWidget text={row.when} maxLines={1} style={{ fontSize: 12, color: row.overdue ? palette.danger : palette.muted, marginLeft: 8 }} />
                ) : null}
              </FlexWidget>
            </FlexWidget>
          ))}
        </ListWidget>
      )}
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

/** Both themes, so the home screen picks the one that matches the system. */
export function todayWidget(props: TodayWidgetProps) {
  return { light: <Widget {...props} palette={light} />, dark: <Widget {...props} palette={dark} /> };
}
