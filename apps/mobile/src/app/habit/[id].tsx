import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { type DayMark, MonthCalendar } from '@/components/MonthCalendar';
import { Button, Card, Chip, EmptyState, Header, IconButton, Loading, Row, Screen, Sheet, Txt } from '@/components/ui';
import { useHabitActions, useHabitLogs, useHabits, useHabitStats } from '@/data/habits';
import { habitLook, startDateLabel } from '@/features/habits/display';
import { HabitAvatar } from '@/features/habits/HabitAvatar';
import { type HabitLook, HabitLookPicker, QuoteField } from '@/features/habits/HabitLookPicker';
import { deleteHabitMeta, HABIT_TIME_GROUPS, setHabitMeta, useHabitMetaMap } from '@/features/habits/habitMeta';
import { Heatmap, heatmapWidth } from '@/features/habits/Heatmap';
import { computeHabitStrength } from '@/features/habits/strength';
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
  const habitMeta = useHabitMetaMap();
  const actions = useHabitActions();
  const habit = habits?.find((item) => item.id === id);
  const [name, setName] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  // The look being edited in the sheet; null while the sheet is closed.
  const [editing, setEditing] = useState<(HabitLook & { quote: string }) | null>(null);

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
        <EmptyState
          icon="alert-circle" title="이미 삭제된 습관입니다" message="습관 목록에서 다시 확인해 주세요."
          action={<Button label="돌아가기" kind="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const day = today(habit.timezone);
  const unit = habit.cadence === 'weekly' ? '주' : '일';
  const rate = stats?.completion_rate;
  const perDay = habit.cadence === 'daily' ? habit.target_count : 1;
  const strength = computeHabitStrength(habit, logs ?? [], day);
  const trendGlyph = strength.trend === 'up' ? ' ↑' : strength.trend === 'down' ? ' ↓' : '';

  const toggle = (date: PlainDate) => {
    const key = date.toString();
    const done = marks.get(key) === 'done';
    haptic.light();
    actions.setLog({ habitId: habit.id, date: key, status: done ? null : 'completed', count: done ? 0 : perDay });
  };

  const meta = habitMeta[habit.id];
  const look = habitLook(habit.name, meta);
  const openLook = () => setEditing({ emoji: meta?.emoji, color: meta?.color, quote: meta?.quote ?? '' });
  const saveLook = () => {
    if (!editing) return;
    setHabitMeta(habit.id, { emoji: editing.emoji, color: editing.color, quote: editing.quote.trim() || undefined });
    haptic.success();
    setEditing(null);
  };

  const rename = () => {
    const next = (name ?? '').trim();
    if (next && next !== habit.name) actions.rename(habit.id, next);
    setName(null);
  };

  return (
    <Screen>
      <Header
        title={habit.name}
        subtitle={(habit.archived_at ? '보관 중 · ' : '') + (habit.cadence === 'daily' ? '매일' : '매주') + ` ${habit.target_count}${habit.cadence === 'daily' ? '회' : '일'} · ${startDateLabel(habit.start_date, day.year)}`}
        left={(
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />
            <Pressable accessibilityRole="button" accessibilityLabel="아이콘과 응원 문구 바꾸기" onPress={openLook} hitSlop={4}>
              <HabitAvatar name={habit.name} emoji={look.emoji} size={40} />
            </Pressable>
          </View>
        )} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        {meta?.quote ? (
          <Txt variant="small" tone="muted" numberOfLines={2} style={{ marginTop: -space.sm }}>“{meta.quote}”</Txt>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Stat label="습관 강도" value={strength.score + '%' + trendGlyph} />
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
          <Txt variant="section" tone="muted">달력 · 날짜를 눌러 기록을 수정할 수 있습니다</Txt>
          <MonthCalendar
            initial={day} today={day} marks={marks} min={Temporal.PlainDate.from(habit.start_date)} max={day} onSelect={toggle} />
        </Card>

        {!habit.archived_at ? (
          <Card style={{ gap: space.sm }}>
            <Txt variant="bodyStrong">실천 시간대</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {HABIT_TIME_GROUPS.map((group) => {
                const currentGroup = habitMeta[habit.id]?.timeOfDay ?? 'anytime';
                return (
                  <Chip
                    key={group.key} icon={group.icon} label={group.label}
                    selected={currentGroup === group.key}
                    onPress={() => setHabitMeta(habit.id, { timeOfDay: group.key })} />
                );
              })}
            </View>
          </Card>
        ) : null}

        {Platform.OS === 'android' && !habit.archived_at ? (
          <Card style={{ gap: space.sm }}>
            <Txt variant="bodyStrong">알림</Txt>
            <HabitReminderChips habitId={habit.id} />
          </Card>
        ) : null}

        <Card style={{ paddingVertical: space.xs }}>
          {habit.archived_at ? (
            <Row
              icon="rotate-ccw" label="보관 해제" detail="습관 목록으로 되돌리기"
              onPress={() => {
                haptic.success();
                actions.unarchive(habit.id);
                showToast(`‘${habit.name}’ 습관을 보관 해제했습니다.`);
                router.back();
              }} />
          ) : (
            <Row icon="clock" label="이 습관으로 집중 시작" onPress={() => router.navigate({ pathname: '/focus', params: { habitId: habit.id, at: String(Date.now()) } })} />
          )}
          <Row icon="edit-2" label="이름 바꾸기" onPress={() => setName(habit.name)} />
          <Row icon="smile" label="아이콘과 응원 문구" onPress={openLook} />
          {habit.archived_at ? null : (
            <Row
              icon="archive" label="보관하기" detail="기록은 그대로 남습니다"
              onPress={() => {
                actions.archive(habit.id);
                showToast('습관을 보관했습니다.');
                router.back();
              }} />
          )}
          <Row icon="trash-2" label="삭제" tone="danger" onPress={() => setConfirm(true)} />
        </Card>
      </ScrollView>
      </KeyboardAvoidingView>

      <Sheet visible={name !== null} onClose={() => setName(null)} title="습관 이름 바꾸기">
        <View style={{ gap: space.md }}>
          <TextInput
            value={name ?? ''} onChangeText={setName} autoFocus maxLength={120} returnKeyType="done" onSubmitEditing={rename}
            placeholder="습관 이름" placeholderTextColor={colors.textFaint} accessibilityLabel="새 이름"
            style={[type.body, { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: space.md }]} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="취소" kind="secondary" onPress={() => setName(null)} style={{ flex: 1 }} />
            <Button label="저장" onPress={rename} disabled={!(name ?? '').trim()} style={{ flex: 1 }} />
          </View>
        </View>
      </Sheet>

      <Sheet visible={editing !== null} onClose={() => setEditing(null)} title="아이콘과 응원 문구">
        {editing ? (
          <View style={{ gap: space.lg }}>
            <HabitLookPicker name={habit.name} look={editing} onChange={(look) => setEditing({ ...editing, ...look })} />
            <QuoteField value={editing.quote} onChange={(quote) => setEditing({ ...editing, quote })} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="취소" kind="secondary" onPress={() => setEditing(null)} style={{ flex: 1 }} />
              <Button label="저장" onPress={saveLook} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={confirm} onClose={() => setConfirm(false)} title="습관을 삭제할까요?">
        <Txt tone="muted" style={{ marginBottom: space.lg }}>지금까지의 기록이 모두 사라지며 되돌릴 수 없습니다. 기록을 남기려면 ‘보관하기’를 이용해 보세요.</Txt>
        <View style={{ gap: space.sm }}>
          <Button
            label="삭제" kind="danger"
            onPress={() => {
              setConfirm(false);
              deleteHabitMeta(habit.id);
              actions.remove(habit.id);
              router.back();
            }} />
          <Button label="취소" kind="secondary" onPress={() => setConfirm(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
