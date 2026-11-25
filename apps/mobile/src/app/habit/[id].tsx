import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { type DayMark, MonthCalendar } from '@/components/MonthCalendar';
import { Button, Card, Chip, Divider, EmptyState, Header, Icon, IconButton, Loading, Row, Screen, Sheet, Txt } from '@/components/ui';
import { useHabitActions, useHabitLogs, useHabits, useHabitStats } from '@/data/habits';
import { habitLook, startDateLabel } from '@/features/habits/display';
import { logsByDate } from '@/features/habits/goal';
import { HabitAvatar } from '@/features/habits/HabitAvatar';
import { showHabitUndoToast } from '@/features/habits/HabitCard';
import { type HabitLook, HabitLookPicker, QuoteField } from '@/features/habits/HabitLookPicker';
import { deleteHabitMeta, HABIT_TIME_GROUPS, setHabitMeta, useHabitMetaMap } from '@/features/habits/habitMeta';
import { Heatmap, HeatmapLegend, heatmapWidth } from '@/features/habits/Heatmap';
import { computeHabitStrength } from '@/features/habits/strength';
import { KEY_PRIORITY, matchesCombo, useKeyHandler, useScreenContext, useScreenFocused } from '@/features/keyboard';
import { HabitReminderChips } from '@/features/reminders/ReminderChips';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { logicalToday, type PlainDate, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { HabitLogStatus } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.md, gap: 2 }}>
      <Txt variant="heading" tabular>{value}</Txt>
      <Txt variant="caption" tone="muted">{label}</Txt>
    </View>
  );
}

export default function HabitDetail() {
  const { colors } = useTheme();
  const prefs = usePersonalPrefs();
  const isFocused = useScreenFocused();
  useScreenContext('habit-detail', isFocused);
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
  const [daySheetDate, setDaySheetDate] = useState<PlainDate | null>(null);
  const [shownMonth, setShownMonth] = useState<Temporal.PlainYearMonth | null>(null);

  const byDate = useMemo(() => logsByDate(logs ?? []), [logs]);

  // Keep `skipped` and `frozen` distinct: only `skipped` maps to MonthCalendar's muted skipped mark,
  // while `frozen` dates are tracked separately and surfaced explicitly below the calendar (and in Heatmap).
  const { marks, frozenLogs, skippedLogs } = useMemo(() => {
    const map = new Map<string, DayMark>();
    const frozen: string[] = [];
    const skipped: string[] = [];
    const perDayTarget = habit?.cadence === 'daily' ? habit.target_count : 1;
    for (const log of logs ?? []) {
      if (log.status === 'frozen') {
        frozen.push(log.log_date);
      } else if (log.status === 'skipped') {
        skipped.push(log.log_date);
        map.set(log.log_date, 'skipped');
      } else if (log.count > 0) {
        map.set(log.log_date, log.count >= perDayTarget ? 'done' : 'partial');
      }
    }
    return { marks: map, frozenLogs: frozen, skippedLogs: skipped };
  }, [logs, habit]);

  const day = habit ? logicalToday(habit.timezone, prefs.dayStartHour) : null;
  const activeMonth = shownMonth ?? (day ? day.toPlainYearMonth() : null);
  const perDay = habit?.cadence === 'daily' ? habit.target_count : 1;

  const monthPrefix = activeMonth ? activeMonth.toString() + '-' : '';
  const monthFrozen = useMemo(
    () => (monthPrefix ? frozenLogs.filter((d) => d.startsWith(monthPrefix)).sort() : []),
    [frozenLogs, monthPrefix],
  );
  const monthSkipped = useMemo(
    () => (monthPrefix ? skippedLogs.filter((d) => d.startsWith(monthPrefix)).sort() : []),
    [skippedLogs, monthPrefix],
  );

  const setDayStatus = (date: PlainDate, nextStatus: HabitLogStatus | null, nextCount: number, message: string) => {
    if (!habit) return;
    const key = date.toString();
    const prev = byDate.get(key);
    const prevStatus = prev?.status ?? null;
    const prevCount = prev?.count ?? 0;
    actions.setLog({ habitId: habit.id, date: key, status: nextStatus, count: nextCount });
    showHabitUndoToast(message, () => {
      actions.setLog({ habitId: habit.id, date: key, status: prevStatus, count: prevCount });
    });
  };

  const toggle = (date: PlainDate) => {
    if (!habit) return;
    const key = date.toString();
    const existing = byDate.get(key);
    const isMet = existing?.status === 'completed' && existing.count >= perDay;
    if (isMet) haptic.light();
    else haptic.success();
    setDayStatus(
      date,
      isMet ? null : 'completed',
      isMet ? 0 : perDay,
      `${date.month}월 ${date.day}일 기록을 ${isMet ? '지웠습니다.' : '남겼습니다.'}`,
    );
  };

  const openFocus = () => {
    if (!habit) return;
    haptic.tap();
    router.navigate({
      pathname: '/focus',
      params: { habitId: habit.id, title: habit.name, autostart: '1', at: String(Date.now()) },
    });
  };

  const saveLook = () => {
    if (!habit || !editing) return;
    setHabitMeta(habit.id, { emoji: editing.emoji, color: editing.color, quote: editing.quote.trim() || undefined });
    haptic.success();
    setEditing(null);
  };

  const rename = () => {
    if (!habit) return;
    const next = (name ?? '').trim();
    if (next && next !== habit.name) actions.rename(habit.id, next);
    setName(null);
  };

  const removeHabit = () => {
    if (!habit) return;
    setConfirm(false);
    deleteHabitMeta(habit.id);
    actions.remove(habit.id);
    router.back();
  };

  useKeyHandler(
    (event) => {
      if (event.editing || event.modal || !habit || !day) return false;
      if (matchesCombo(event, 'space') || matchesCombo(event, 'x')) {
        if (!event.repeat) toggle(day);
        return true;
      }
      if (matchesCombo(event, 'e')) {
        if (!event.repeat) {
          haptic.tap();
          setName(habit.name);
        }
        return true;
      }
      if (matchesCombo(event, 'f')) {
        if (!habit.archived_at) {
          if (!event.repeat) openFocus();
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'delete')) {
        if (!event.repeat) {
          haptic.tap();
          setConfirm(true);
        }
        return true;
      }
      if (matchesCombo(event, 'escape') || matchesCombo(event, 'backspace')) {
        if (!event.repeat) router.back();
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.screen, enabled: isFocused && !!habit && name === null && editing === null && !confirm && daySheetDate === null },
  );

  useKeyHandler(
    (event) => {
      if (event.editing) return false;
      if (matchesCombo(event, 'escape')) {
        if (!event.repeat) setConfirm(false);
        return true;
      }
      if (matchesCombo(event, 'enter')) {
        if (!event.repeat) {
          haptic.warning();
          removeHabit();
        }
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: isFocused && !!habit && confirm },
  );

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'mod+enter')) {
        if (!event.repeat) {
          if (name !== null) {
            if (name.trim()) rename();
          } else if (editing !== null) {
            saveLook();
          }
        }
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: isFocused && !!habit && (name !== null || editing !== null) },
  );

  if (isLoading) return <Screen><Loading /></Screen>;
  if (!habit || !day) {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle" title="이미 삭제된 습관입니다" message="습관 목록에서 다시 확인해 주세요."
          action={<Button label="돌아가기" kind="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const unit = habit.cadence === 'weekly' ? '주' : '일';
  const rate = stats?.completion_rate;
  const strength = computeHabitStrength(habit, logs ?? [], day);
  const trendGlyph = strength.trend === 'up' ? ' ↑' : strength.trend === 'down' ? ' ↓' : '';

  const meta = habitMeta[habit.id];
  const look = habitLook(habit.name, meta);
  const openLook = () => setEditing({ emoji: meta?.emoji, color: meta?.color, quote: meta?.quote ?? '' });
  const daySheetLog = daySheetDate ? byDate.get(daySheetDate.toString()) : undefined;

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
            <HeatmapLegend />
          </Card>

          <Card style={{ gap: space.sm }}>
            <Txt variant="section" tone="muted">달력 · 눌러서 기록, 길게 눌러 상태 변경</Txt>
            <MonthCalendar
              initial={day}
              today={day}
              marks={marks}
              min={Temporal.PlainDate.from(habit.start_date)}
              max={day}
              onSelect={toggle}
              onLongPress={(date) => setDaySheetDate(date)}
              onMonthChange={setShownMonth}
            />
            {monthFrozen.length > 0 || monthSkipped.length > 0 ? (
              <View style={{ gap: space.xs, paddingTop: space.xs }}>
                <Divider />
                <View style={styles.statusSummary}>
                  {monthFrozen.map((iso) => {
                    const parsed = Temporal.PlainDate.from(iso);
                    return (
                      <Pressable
                        key={'f:' + iso}
                        accessibilityRole="button"
                        accessibilityLabel={`${parsed.month}월 ${parsed.day}일 쉬어감, 눌러서 변경`}
                        onPress={() => {
                          haptic.tap();
                          setDaySheetDate(parsed);
                        }}
                        style={[styles.statusTag, { backgroundColor: colors.accentSoft, borderColor: colors.accentRamp[1] }]}>
                        <Icon name="pause" size={11} color={colors.accentText} />
                        <Txt variant="meta" tone="accent" tabular>{parsed.month}/{parsed.day} 쉬어감</Txt>
                      </Pressable>
                    );
                  })}
                  {monthSkipped.map((iso) => {
                    const parsed = Temporal.PlainDate.from(iso);
                    return (
                      <Pressable
                        key={'s:' + iso}
                        accessibilityRole="button"
                        accessibilityLabel={`${parsed.month}월 ${parsed.day}일 건너뜀, 눌러서 변경`}
                        onPress={() => {
                          haptic.tap();
                          setDaySheetDate(parsed);
                        }}
                        style={[styles.statusTag, { backgroundColor: 'transparent', borderColor: colors.control, borderStyle: 'dashed' }]}>
                        <Icon name="minus" size={11} color={colors.textMuted} />
                        <Txt variant="meta" tone="muted" tabular>{parsed.month}/{parsed.day} 건너뜀</Txt>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
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

          {Platform.OS !== 'web' && !habit.archived_at ? (
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
              <Row icon="clock" label="이 습관으로 집중 시작" onPress={openFocus} />
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

      <Sheet
        visible={daySheetDate !== null}
        onClose={() => setDaySheetDate(null)}
        title={daySheetDate ? `${daySheetDate.month}월 ${daySheetDate.day}일 기록` : undefined}>
        {daySheetDate ? (
          <View>
            <Row
              icon="check-circle"
              label="완료로 기록"
              detail={daySheetLog?.status === 'completed' ? `현재 ${daySheetLog.count}/${perDay}` : undefined}
              onPress={() => {
                haptic.success();
                const target = daySheetDate;
                setDaySheetDate(null);
                setDayStatus(target, 'completed', perDay, `${target.month}월 ${target.day}일 완료로 기록했습니다.`);
              }}
            />
            <Row
              icon="pause-circle"
              label="쉬어가기"
              detail="연속 기록 유지"
              onPress={() => {
                haptic.tap();
                const target = daySheetDate;
                setDaySheetDate(null);
                setDayStatus(target, 'frozen', 0, `${target.month}월 ${target.day}일 쉬어가기로 표시했습니다.`);
              }}
            />
            <Row
              icon="skip-forward"
              label="건너뛰기"
              detail="달성률에서 제외"
              onPress={() => {
                haptic.tap();
                const target = daySheetDate;
                setDaySheetDate(null);
                setDayStatus(target, 'skipped', 0, `${target.month}월 ${target.day}일 건너뛰었습니다.`);
              }}
            />
            {daySheetLog ? (
              <Row
                icon="rotate-ccw"
                label="기록 지우기"
                onPress={() => {
                  haptic.light();
                  const target = daySheetDate;
                  setDaySheetDate(null);
                  setDayStatus(target, null, 0, `${target.month}월 ${target.day}일 기록을 지웠습니다.`);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>

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
            onPress={removeHabit} />
          <Button label="취소" kind="secondary" onPress={() => setConfirm(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: space.xs },
  statusTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1,
  },
});
