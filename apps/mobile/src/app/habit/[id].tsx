import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';

import { type DayMark, MonthCalendar } from '@/components/MonthCalendar';
import { Button, Card, EmptyState, Header, IconButton, Loading, Row, Screen, Sheet, Txt } from '@/components/ui';
import { useHabitActions, useHabitLogs, useHabits, useHabitStats } from '@/data/habits';
import { Heatmap, heatmapWidth } from '@/features/habits/Heatmap';
import { HabitReminderChips } from '@/features/reminders/ReminderChips';
import { type PlainDate, Temporal, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.md, gap: 2 }}>
      <Txt variant="heading">{value}</Txt>
      <Txt variant="caption" tone="muted">{label}</Txt>
    </View>
  );
}

export default function HabitDetail() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: habits, isLoading } = useHabits();
  const { data: logs } = useHabitLogs(id);
  const { data: stats } = useHabitStats(id);
  const actions = useHabitActions();
  const habit = habits?.find((item) => item.id === id);
  const [name, setName] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const marks = useMemo(() => {
    const map = new Map<string, DayMark>();
    for (const log of logs ?? []) {
      const full = log.count >= (habit?.cadence === 'daily' ? habit.target_count : 1);
      map.set(log.log_date, log.status !== 'completed' ? 'skipped' : full ? 'done' : 'partial');
    }
    return map;
  }, [logs, habit]);

  if (isLoading) return <Screen><Loading /></Screen>;
  if (!habit) {
    return (
      <Screen>
        <EmptyState icon="alert-circle" title="습관을 찾을 수 없습니다" action={<Button label="돌아가기" kind="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const day = today(habit.timezone);
  const unit = habit.cadence === 'weekly' ? '주' : '일';
  const rate = stats?.completion_rate;
  const perDay = habit.cadence === 'daily' ? habit.target_count : 1;

  const toggle = (date: PlainDate) => {
    const key = date.toString();
    const done = marks.get(key) === 'done';
    haptic.light();
    actions.setLog({ habitId: habit.id, date: key, status: done ? null : 'completed', count: done ? 0 : perDay });
  };

  const rename = () => {
    const next = (name ?? '').trim();
    if (next && next !== habit.name) actions.rename(habit.id, next);
    setName(null);
  };

  return (
    <Screen>
      <Header
        title={habit.name} subtitle={(habit.cadence === 'daily' ? '매일' : '매주') + ` ${habit.target_count}${habit.cadence === 'daily' ? '회' : '일'} · ${habit.start_date} 시작`}
        left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Stat label="현재 연속" value={(stats?.current_streak ?? 0) + unit} />
          <Stat label="최장 연속" value={(stats?.longest_streak ?? 0) + unit} />
          <Stat label="달성률" value={rate === null || rate === undefined ? '–' : Math.round(rate * 100) + '%'} />
        </View>

        <Card style={{ gap: space.md }}>
          <Txt variant="section" tone="muted">최근 17주</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentOffset={{ x: heatmapWidth, y: 0 }}>
            <Heatmap habit={habit} logs={logs ?? []} today={day} />
          </ScrollView>
        </Card>

        <Card style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">달력 · 날짜를 눌러 기록을 고칠 수 있습니다</Txt>
          <MonthCalendar
            initial={day} today={day} marks={marks} min={Temporal.PlainDate.from(habit.start_date)} max={day} onSelect={toggle} />
        </Card>

        {name === null ? null : (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <TextInput
              value={name} onChangeText={setName} autoFocus maxLength={120} returnKeyType="done" onSubmitEditing={rename}
              accessibilityLabel="새 이름"
              style={[type.body, { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: space.md }]} />
            <Button label="저장" onPress={rename} />
          </View>
        )}

        {Platform.OS === 'android' ? (
          <Card style={{ gap: space.sm }}>
            <Txt variant="bodyStrong">알림</Txt>
            <HabitReminderChips habitId={habit.id} />
          </Card>
        ) : null}

        <Card style={{ paddingVertical: space.xs }}>
          <Row icon="clock" label="이 습관으로 집중 시작" onPress={() => router.navigate({ pathname: '/focus', params: { habitId: habit.id, at: String(Date.now()) } })} />
          <Row icon="edit-2" label="이름 바꾸기" onPress={() => setName(habit.name)} />
          <Row
            icon="archive" label="보관하기" detail="기록은 남습니다"
            onPress={() => {
              actions.archive(habit.id);
              showToast('습관을 보관했습니다.');
              router.back();
            }} />
          <Row icon="trash-2" label="삭제" tone="danger" onPress={() => setConfirm(true)} />
        </Card>
      </ScrollView>
      </KeyboardAvoidingView>

      <Sheet visible={confirm} onClose={() => setConfirm(false)} title="습관을 삭제할까요?">
        <Txt tone="muted" style={{ marginBottom: space.lg }}>모든 기록이 함께 지워지며 되돌릴 수 없습니다. 기록을 남기려면 보관을 선택하세요.</Txt>
        <View style={{ gap: space.sm }}>
          <Button
            label="삭제" kind="danger"
            onPress={() => {
              setConfirm(false);
              actions.remove(habit.id);
              router.back();
            }} />
          <Button label="취소" kind="secondary" onPress={() => setConfirm(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
