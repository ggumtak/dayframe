import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Switch, View } from 'react-native';

import { Button, Card, Chip, Segmented, Txt } from '@/components/ui';
import { pinWidget } from '@/features/widget/render';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

import { type PermissionState, reminderPermission, requestReminderPermission } from './notify';
import type { ReminderSettings, ReminderStyle } from './plan';
import { setReminderSettings, useReminderSettings } from './settings';

const leads: { value: ReminderSettings['leadMinutes']; label: string }[] = [
  { value: 0, label: '정시' }, { value: 5, label: '5분 전' }, { value: 10, label: '10분 전' }, { value: 30, label: '30분 전' }, { value: 60, label: '1시간 전' },
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
            <Txt variant="smallStrong" tone="muted">알림 시점</Txt>
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
        <Txt variant="small" tone="muted">오늘과 지연된 할 일을 홈 화면에 띄웁니다. 동그라미를 누르면 앱을 열지 않고 완료됩니다.</Txt>
        <Button
          label="홈 화면에 위젯 추가" kind="secondary" icon="grid" style={{ minHeight: 40 }}
          onPress={() => void pinWidget().then((asked) => {
            if (!asked) showToast('홈 화면을 길게 눌러 위젯 → Dayframe을 골라 주세요.');
          })} />
      </View>
    </Card>
  );
}
