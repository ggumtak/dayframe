import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, Pressable, Switch, View } from 'react-native';

import { Button, Card, Chip, Icon, Txt } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

import { openNotificationSettings, type PermissionState, reminderPermission, requestReminderPermission } from './notify';
import { useReminderOverrides } from './overrides';
import type { ReminderSettings } from './plan';
import { setReminderSettings, useReminderSettings } from './settings';

const leads: { value: ReminderSettings['leadMinutes']; label: string }[] = [
  { value: 0, label: '정시' },
  { value: 5, label: '5분 전' },
  { value: 10, label: '10분 전' },
  { value: 15, label: '15분 전' },
  { value: 30, label: '30분 전' },
  { value: 60, label: '1시간 전' },
];
const allDay: { value: number | null; label: string }[] = [
  { value: null, label: '끄기' },
  { value: 7, label: '오전 7시' },
  { value: 8, label: '오전 8시' },
  { value: 9, label: '오전 9시' },
  { value: 10, label: '오전 10시' },
  { value: 18, label: '오후 6시' },
];
const briefingHours: { value: number | null; label: string }[] = [
  { value: null, label: '끄기' },
  { value: 7, label: '오전 7시' },
  { value: 8, label: '오전 8시' },
  { value: 9, label: '오전 9시' },
  { value: 21, label: '오후 9시' },
];

/** Settings for task alerts, daily Today briefing, and lockscreen actions. */
export function RemindersCard() {
  const { colors } = useTheme();
  const settings = useReminderSettings();
  const overrides = useReminderOverrides();
  const hasHabitAlerts = Object.keys(overrides.habits).length > 0;
  const [permission, setPermission] = useState<PermissionState>('granted');
  const check = useCallback(() => void reminderPermission().then(setPermission), []);

  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => subscription.remove();
  }, [check]);

  if (Platform.OS !== 'android') {
    return <Card><Txt tone="muted">Android 전용 기능입니다.</Txt></Card>;
  }

  const currentBriefing = settings.briefingHour === undefined ? 8 : settings.briefingHour;

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Txt variant="bodyStrong" style={{ flex: 1 }}>할 일 알림</Txt>
        <Switch
          accessibilityLabel="할 일 알림" value={settings.enabled} onValueChange={(enabled) => setReminderSettings({ enabled })}
          trackColor={{ true: colors.accent, false: colors.control }} thumbColor={colors.onAccent} />
      </View>

      {(settings.enabled || hasHabitAlerts) && permission !== 'granted' ? (
        <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
          <Txt variant="small" tone="danger">
            {permission === 'denied' ? '시스템 설정에서 알림이 꺼져 있습니다.' : '알림 권한이 필요합니다.'}
          </Txt>
          <Button
            label={permission === 'denied' ? '시스템 설정' : '권한 허용'} kind="secondary" style={{ minHeight: 40 }}
            onPress={() => (permission === 'denied' ? void openNotificationSettings() : void requestReminderPermission(true).then(setPermission))} />
        </View>
      ) : null}

      {settings.enabled ? (
        <>
          <View style={{ gap: space.sm }}>
            <Txt variant="smallStrong" tone="muted">기본 알림</Txt>
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
            <Txt variant="smallStrong" tone="muted">오늘 요약</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {briefingHours.map((item) => (
                <Chip
                  key={item.label} label={item.label} selected={currentBriefing === item.value}
                  onPress={() => setReminderSettings({ briefingHour: item.value })} />
              ))}
            </View>
          </View>
          <Pressable
            accessibilityRole="button" accessibilityLabel="휴대폰 알림 설정 열기" onPress={() => void openNotificationSettings()}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs, opacity: pressed ? 0.6 : 1 }]}>
            <Txt variant="bodyStrong" style={{ flex: 1 }}>알림 팝업 및 소리</Txt>
            <Txt variant="small" tone="muted">시스템 설정</Txt>
            <Icon name="external-link" size={18} color={colors.textMuted} />
          </Pressable>
        </>
      ) : null}
    </Card>
  );
}
