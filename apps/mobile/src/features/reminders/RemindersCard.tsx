import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, Pressable, Switch, View } from 'react-native';

import { Button, Card, Chip, Icon, Txt } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

import { openNotificationSettings, type PermissionState, reminderPermission, requestReminderPermission } from './notify';
import { useReminderOverrides } from './overrides';
import type { ReminderSettings } from './plan';
import { setReminderSettings, useReminderSettings } from './settings';

const leads: { value: ReminderSettings['leadMinutes']; label: string }[] = [
  { value: 0, label: '정시' }, { value: 5, label: '5분 전' }, { value: 10, label: '10분 전' }, { value: 30, label: '30분 전' }, { value: 60, label: '1시간 전' },
];
const allDay: { value: number | null; label: string }[] = [{ value: null, label: '알리지 않음' }, { value: 8, label: '오전 8시' }, { value: 9, label: '오전 9시' }];

/** Settings for task alerts, with a preview of how an alert will read. */
export function RemindersCard() {
  const { colors } = useTheme();
  const settings = useReminderSettings();
  const overrides = useReminderOverrides();
  const hasHabitAlerts = Object.keys(overrides.habits).length > 0;
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

      {(settings.enabled || hasHabitAlerts) && permission !== 'granted' ? (
        <View style={{ backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
          <Txt variant="small" tone="danger">
            {permission === 'denied' ? '휴대폰 설정에서 Dayframe 알림이 꺼져 있어 알림이 울리지 않습니다.' : '알림을 허용해야 울립니다.'}
          </Txt>
          <Button
            label={permission === 'denied' ? '휴대폰 설정 열기' : '알림 허용'} kind="secondary" style={{ minHeight: 40 }}
            onPress={() => (permission === 'denied' ? void openNotificationSettings() : void requestReminderPermission(true).then(setPermission))} />
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
          <Pressable
            accessibilityRole="button" accessibilityLabel="휴대폰 알림 설정 열기" onPress={() => void openNotificationSettings()}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs, opacity: pressed ? 0.6 : 1 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">팝업 모양·소리</Txt>
              <Txt variant="small" tone="muted">간략한 팝업·자세한 팝업, 잠금화면 표시, 소리는 휴대폰 설정에서 정합니다.</Txt>
            </View>
            <Icon name="external-link" size={18} color={colors.textMuted} />
          </Pressable>
        </>
      ) : null}
    </Card>
  );
}
