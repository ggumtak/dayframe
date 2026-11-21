import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, Switch, View } from 'react-native';

import { Button, Card, Chip, Icon, type IconName, Segmented, Txt } from '@/components/ui';
import { pinWidget } from '@/features/widget/render';
import { type WidgetName, WIDGETS } from '@/features/widget/names';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

import { type PermissionState, reminderPermission, requestReminderPermission } from './notify';
import type { ReminderSettings, ReminderStyle } from './plan';
import { setReminderSettings, useReminderSettings } from './settings';

const leads: { value: ReminderSettings['leadMinutes']; label: string }[] = [
  { value: 0, label: '정시' }, { value: 5, label: '5분 전' }, { value: 10, label: '10분 전' }, { value: 30, label: '30분 전' }, { value: 60, label: '1시간 전' },
];
const widgetChoices: { name: WidgetName; label: string; detail: string; icon: IconName }[] = [
  { name: WIDGETS.today, label: '오늘 할 일', detail: '지연·오늘 목록, 동그라미로 바로 완료 (4×2)', icon: 'sun' },
  { name: WIDGETS.upcoming, label: '예정', detail: '앞으로 7일을 날짜별로 (4×2)', icon: 'calendar' },
  { name: WIDGETS.habits, label: '습관', detail: '누르면 오늘 기록 (4×2)', icon: 'repeat' },
  { name: WIDGETS.focus, label: '집중', detail: '25분·50분 바로 시작 (2×2)', icon: 'clock' },
  { name: WIDGETS.quickAdd, label: '빠른 추가', detail: '눌러서 할 일 입력 (4×1)', icon: 'plus-circle' },
];
const allDay: { value: number | null; label: string }[] = [{ value: null, label: '알리지 않음' }, { value: 8, label: '오전 8시' }, { value: 9, label: '오전 9시' }];

/** Settings for task alerts, with a preview of how an alert will read. */
export function RemindersCard() {
  const { colors } = useTheme();
  const settings = useReminderSettings();
  const [permission, setPermission] = useState<PermissionState>('granted');
  const check = useCallback(() => void reminderPermission().then(setPermission), []);

  // Coming back from the phone's settings may have changed the answer.
  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => subscription.remove();
  }, [check]);

  if (Platform.OS !== 'android') {
    return <Card><Txt tone="muted">알림은 Android 앱에서 설정할 수 있습니다.</Txt></Card>;
  }
  const lead = settings.leadMinutes ? leads.find((item) => item.value === settings.leadMinutes)!.label.replace(' 전', ' 후') + ' · ' : '';

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="bodyStrong">할 일 알림</Txt>
          <Txt variant="small" tone="muted">시간이 정해진 할 일을 그 시간에 알려 줍니다. 앱이 꺼져 있어도 울립니다.</Txt>
        </View>
        <Switch
          accessibilityLabel="할 일 알림" value={settings.enabled} onValueChange={(enabled) => setReminderSettings({ enabled })}
          trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#FFFFFF" />
      </View>

      {settings.enabled && permission !== 'granted' ? (
        <View style={{ backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
          <Txt variant="small" tone="danger">
            {permission === 'denied' ? '휴대폰 설정에서 Dayframe 알림이 꺼져 있어 알림이 울리지 않습니다.' : '알림을 허용해야 울립니다.'}
          </Txt>
          <Button
            label={permission === 'denied' ? '휴대폰 설정 열기' : '알림 허용'} kind="secondary" style={{ minHeight: 40 }}
            onPress={() => (permission === 'denied' ? void Linking.openSettings() : void requestReminderPermission(true).then(setPermission))} />
        </View>
      ) : null}

      {settings.enabled ? (
        <>
          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong" tone="muted">알림 시점 (할 일마다 바꾸려면 할 일 상세 → 알림)</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {leads.map((item) => (
                <Chip key={item.value} label={item.label} selected={settings.leadMinutes === item.value} onPress={() => setReminderSettings({ leadMinutes: item.value })} />
              ))}
            </View>
          </View>
          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong" tone="muted">종일 할 일</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {allDay.map((item) => (
                <Chip key={item.label} label={item.label} selected={settings.allDayHour === item.value} onPress={() => setReminderSettings({ allDayHour: item.value })} />
              ))}
            </View>
          </View>
          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong" tone="muted">알림 모양</Txt>
            <Segmented<ReminderStyle>
              value={settings.style} onChange={(style) => setReminderSettings({ style })}
              options={[{ value: 'brief', label: '간단히' }, { value: 'detailed', label: '자세히' }]} />
            <View accessibilityLabel="알림 미리보기" style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: 2 }}>
              <Txt variant="caption" tone="muted">Dayframe · 지금</Txt>
              <Txt variant="bodyStrong">보고서 제출</Txt>
              <Txt variant="small" tone="muted">{lead + '오후 3:00' + (settings.style === 'detailed' ? ' · 매주 금 · #회사' : '')}</Txt>
              {settings.style === 'detailed' ? (
                <>
                  <Txt variant="small" tone="muted">최종본은 공유 폴더에 올리기</Txt>
                  <Txt variant="small" tone="muted">하위 작업 2개 남음</Txt>
                  <View style={{ flexDirection: 'row', gap: space.xl, marginTop: space.xs }}>
                    <Txt variant="smallStrong" tone="accent">완료</Txt>
                    <Txt variant="smallStrong" tone="accent">10분 뒤에</Txt>
                  </View>
                </>
              ) : null}
            </View>
          </View>
        </>
      ) : null}

      <View style={{ height: 1, backgroundColor: colors.border }} />
      <View style={{ gap: space.sm }}>
        <Txt variant="bodyStrong">홈 화면 위젯</Txt>
        <Txt variant="small" tone="muted">누르면 홈 화면에 놓을 수 있습니다. 홈 화면을 길게 눌러 위젯 → Dayframe에서 골라도 됩니다.</Txt>
        {widgetChoices.map((choice) => (
          <Pressable
            key={choice.name} accessibilityRole="button" accessibilityLabel={choice.label + ' 위젯 추가'}
            onPress={() => void pinWidget(choice.name).then((asked) => {
              if (!asked) showToast('홈 화면을 길게 눌러 위젯 → Dayframe을 골라 주세요.');
            })}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={choice.icon} size={18} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{choice.label}</Txt>
              <Txt variant="small" tone="muted">{choice.detail}</Txt>
            </View>
            <Icon name="plus" size={18} color={colors.accent} />
          </Pressable>
        ))}
      </View>
    </Card>
  );
}
