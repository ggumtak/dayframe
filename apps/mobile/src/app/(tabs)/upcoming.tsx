import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Button, EmptyState, Header, Icon, Loading, Screen, SectionTitle, Segmented, Txt } from '@/components/ui';
import { bySchedule, useTaskIndex } from '@/data/tasks';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { TaskList } from '@/features/tasks/TaskList';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, dueDate, formatDate, Temporal, today, weekdayName } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { datePhrase, occurrenceDates } from '@/lib/occurrences';
import { nextOccurrence, type Task } from '@/lib/shared';
import { radius, space, useTheme } from '@/theme';

export default function Upcoming() {
  const { colors } = useTheme();
  const { tasks, isLoading, refetch } = useTaskIndex();
  const [refreshing, setRefreshing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [monthDay, setMonthDay] = useState<string | null>(null);
  const quickAdd = useQuickAdd();
  // The floating + adds to the day in view: the picked day of the week strip or of the calendar.
  const focusDay = view === 'month' ? monthDay : picked;
  useScreenDefaults({ initialText: focusDay ? datePhrase(Temporal.PlainDate.from(focusDay), today(deviceTimeZone())) + ' ' : undefined });
  const addOn = (date: Temporal.PlainDate) => quickAdd.open({ initialText: datePhrase(date, today(deviceTimeZone())) + ' ' });

  // The calendar widget opens a day here; `at` differs on every tap, so the same day can be opened twice.
  const params = useLocalSearchParams<{ view?: string; date?: string; at?: string }>();
  const link = (params.view ?? '') + '|' + (params.date ?? '') + '|' + (params.at ?? '');
  const [appliedLink, setAppliedLink] = useState('||');
  if (link !== appliedLink) {
    setAppliedLink(link);
    if (params.view === 'month') setView('month');
    if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) setMonthDay(params.date);
  }
  useMinute();

  // Grouped on every render: `useMinute` re-renders this screen when the date rolls over.
  const groups = new Map<string, { title: string; tasks: Task[] }>();
  for (const task of tasks.filter((item) => dueBucket(item) === 'upcoming').sort(bySchedule)) {
    const date = dueDate(task)!;
    const key = date.toString();
    const title = dayTitle(date, today(task.timezone));
    groups.set(key, { title, tasks: [...(groups.get(key)?.tasks ?? []), task] });
  }
  const all = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, group]) => ({ key, ...group }));
  // The strip covers the coming week; a picked day that has since passed or emptied shows everything again.
  const first = today(deviceTimeZone()).add({ days: 1 });
  const week = Array.from({ length: 7 }, (_, offset) => first.add({ days: offset }));
  const selected = picked && week.some((date) => date.toString() === picked) ? picked : null;
  // The coming week lists every day, free ones too, so a day can be planned from here (as Todoist's Upcoming does).
  const weekKeys = new Set(week.map((date) => date.toString()));
  const planner = [
    ...week.map((date) => groups.get(date.toString())
      ? { key: date.toString(), ...groups.get(date.toString())! }
      : { key: date.toString(), title: dayTitle(date, first.subtract({ days: 1 })), tasks: [] as Task[] }),
    ...all.filter((day) => !weekKeys.has(day.key)),
  ];
  const days = selected ? all.filter((day) => day.key === selected) : all.length ? planner : [];

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <Screen>
      <Header title="예정" subtitle={all.length ? `앞으로 ${all.reduce((sum, day) => sum + day.tasks.length, 0)}개` : undefined} />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <Segmented<'week' | 'month'>
          value={view} onChange={setView}
          options={[{ value: 'week', label: '목록', icon: 'list' }, { value: 'month', label: '달력', icon: 'calendar' }]} />
      </View>
      {view === 'month' ? (
        <MonthView key={appliedLink} tasks={tasks} selected={monthDay} onSelect={setMonthDay} onAdd={addOn} refreshing={refreshing} onRefresh={refresh} />
      ) : (
        <>
        <View style={[styles.week, { borderBottomColor: colors.border }]}>
          {week.map((date) => {
            const key = date.toString();
            const active = key === selected;
            const count = groups.get(key)?.tasks.length ?? 0;
            return (
              <Pressable
                key={key} accessibilityRole="button" accessibilityState={{ selected: active }}
                accessibilityLabel={`${date.month}월 ${date.day}일 ${weekdayName(date)}요일, ${count}개`}
                onPress={() => {
                  haptic.tap();
                  setPicked(active ? null : key);
                }}
                style={styles.day}>
                <Txt variant="caption" style={{ color: date.dayOfWeek === 7 ? colors.danger : date.dayOfWeek === 6 ? colors.accent : colors.textMuted }}>{weekdayName(date)}</Txt>
                <View style={[styles.dayNumber, active && { backgroundColor: colors.accent }]}>
                  <Txt variant="bodyStrong" style={{ color: active ? colors.onAccent : colors.text }}>{date.day}</Txt>
                </View>
                <View style={[styles.dot, { backgroundColor: count ? (active ? colors.accent : colors.textFaint) : 'transparent' }]} />
              </Pressable>
            );
          })}
        </View>
        {isLoading ? <Loading /> : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
            {days.length ? days.map((day) => (day.tasks.length ? (
              <Fragmented key={day.key} title={day.title} tasks={day.tasks} onAdd={() => addOn(Temporal.PlainDate.from(day.key))} />
            ) : (
              <View key={day.key} style={[styles.freeDay, { borderBottomColor: colors.border }]}>
                <Txt variant="small" tone="faint" style={{ flex: 1 }}>{day.title}</Txt>
                <AddButton label={day.title} onPress={() => addOn(Temporal.PlainDate.from(day.key))} />
              </View>
            ))) : (
              <EmptyState
                icon="calendar" title={selected ? '이 날은 예정된 일이 없습니다' : '예정된 일이 없습니다'}
                message={selected ? '날짜를 다시 누르면 전체 일정이 보입니다.' : '‘내일 오후 3시 회의’처럼 날짜를 함께 적으면 여기에 모입니다.'}
                action={selected ? (
                  <Button label="이 날에 할 일 추가" icon="plus" onPress={() => addOn(Temporal.PlainDate.from(selected))} />
                ) : undefined} />
            )}
          </ScrollView>
        )}
        </>
      )}
    </Screen>
  );
}

/** "내일 · 11월 23일 월", "수요일 · 11월 25일", or the plain date when it is further away. */
function dayTitle(date: Temporal.PlainDate, now: Temporal.PlainDate): string {
  const label = formatDate(date, now);
  if (/^\d/.test(label)) return label;
  const day = `${date.month}월 ${date.day}일`;
  return label.endsWith('요일') ? `${label} · ${day}` : `${label} · ${day} ${weekdayName(date)}`;
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label + '에 추가'} hitSlop={10} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, opacity: pressed ? 0.6 : 1 })}>
      <Icon name="plus" size={16} color={colors.accent} />
      <Txt variant="smallStrong" tone="accent">추가</Txt>
    </Pressable>
  );
}

function Fragmented({ title, tasks, onAdd }: { title: string; tasks: Task[]; onAdd: () => void }) {
  return (
    <>
      <SectionTitle title={title} count={tasks.length} action={<AddButton label={title} onPress={onAdd} />} />
      <TaskList tasks={tasks} hideDate />
    </>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row', paddingHorizontal: space.sm, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  monthBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.md, marginTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  preview: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: space.lg },
  previewIcon: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginTop: 12, marginRight: space.md },
  previewBody: { flex: 1, gap: 3, paddingVertical: 11, paddingRight: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  freeDay: {
    flexDirection: 'row', alignItems: 'center', minHeight: 44, marginLeft: space.lg, paddingRight: space.lg, marginTop: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  day: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 },
  dayNumber: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2 },
});

/** One task as it will fall on a later date of its repeat: shown for planning, opened to edit the task. */
function Preview({ task, date }: { task: Task; date: Temporal.PlainDate }) {
  const { colors } = useTheme();
  const at = task.due_at && !task.all_day ? Temporal.Instant.from(task.due_at).toZonedDateTimeISO(task.timezone) : null;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={task.title + ' 반복 예정'}
      onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
      style={({ pressed }) => [styles.preview, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={[styles.previewIcon, { borderColor: colors.border }]}>
        <Icon name="repeat" size={11} color={colors.textFaint} />
      </View>
      <View style={[styles.previewBody, { borderBottomColor: colors.border }]}>
        <Txt tone="muted" numberOfLines={1}>{task.title}</Txt>
        <Txt variant="small" tone="faint">{(at ? (at.hour < 12 ? '오전 ' : '오후 ') + (at.hour % 12 || 12) + ':' + String(at.minute).padStart(2, '0') + ' · ' : '') + '반복 예정 · ' + date.month + '/' + date.day}</Txt>
      </View>
    </Pressable>
  );
}

/**
 * A month at a glance. Dots mark days with something on them, repeats included; below, the whole month is
 * listed day by day, or only the chosen day. Each day has its own 추가.
 */
function MonthView({ tasks, selected, onSelect, onAdd, refreshing, onRefresh }: {
  tasks: Task[]; selected: string | null; onSelect: (day: string | null) => void; onAdd: (date: Temporal.PlainDate) => void;
  refreshing: boolean; onRefresh: () => void;
}) {
  const { colors } = useTheme();
  const now = today(deviceTimeZone());
  const picked = selected ? Temporal.PlainDate.from(selected) : null;
  const [month, setMonth] = useState(() => (picked ?? now).toPlainYearMonth());
  // Every date each task falls on this month; only a task's current due date is a real, completable item.
  // Keyed on the month's text, since a new PlainYearMonth object would redo this on every render.
  const monthKey = month.toString();
  const days = useMemo(() => {
    const shown = Temporal.PlainYearMonth.from(monthKey);
    const first = shown.toPlainDate({ day: 1 });
    const last = shown.toPlainDate({ day: shown.daysInMonth });
    const map = new Map<string, { real: Task[]; previews: Task[] }>();
    for (const task of tasks) {
      const due = dueDate(task)?.toString();
      for (const date of occurrenceDates(task, first, last, nextOccurrence)) {
        const key = date.toString();
        const entry = map.get(key) ?? { real: [], previews: [] };
        (key === due ? entry.real : entry.previews).push(task);
        map.set(key, entry);
      }
    }
    return map;
  }, [tasks, monthKey]);

  const listed = [...days.keys()].filter((key) => !selected || key === selected).sort();
  if (selected && !days.has(selected)) listed.push(selected);
  const title = (date: Temporal.PlainDate) => dayTitle(date, now);
  const total = [...days.values()].reduce((sum, day) => sum + day.real.length + day.previews.length, 0);

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}>
      <View style={{ paddingHorizontal: space.md }}>
        <MonthCalendar
          initial={picked ?? now} selected={picked} today={now} dots={new Set(days.keys())}
          onMonthChange={(next) => {
            setMonth(next);
            onSelect(null);
          }}
          onSelect={(date) => onSelect(date.toString() === selected ? null : date.toString())}
          onLongPress={(date) => {
            onSelect(date.toString());
            onAdd(date);
          }} />
      </View>
      <View style={[styles.monthBar, { borderTopColor: colors.border }]}>
        <Txt variant="small" tone="muted" style={{ flex: 1 }}>
          {selected ? '날짜를 다시 누르면 이번 달 전체 · + 는 이 날에 추가' : `${month.month}월 일정 ${total}개 · 날짜를 길게 누르면 바로 추가`}
        </Txt>
        {selected ? <AddButton label={title(picked!)} onPress={() => onAdd(picked!)} /> : null}
      </View>
      {listed.length === 0 ? (
        <Txt variant="small" tone="muted" style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>이번 달에는 일정이 없습니다.</Txt>
      ) : listed.map((key) => {
        const date = Temporal.PlainDate.from(key);
        const entry = days.get(key) ?? { real: [], previews: [] };
        return (
          <View key={key}>
            <SectionTitle
              title={title(date)} count={entry.real.length + entry.previews.length} tone={Temporal.PlainDate.compare(date, now) < 0 ? 'danger' : undefined}
              action={<AddButton label={title(date)} onPress={() => onAdd(date)} />} />
            {entry.real.length ? <TaskList tasks={[...entry.real].sort(bySchedule)} hideDate /> : null}
            {entry.previews.map((task) => <Preview key={task.id} task={task} date={date} />)}
            {entry.real.length + entry.previews.length === 0 ? (
              <Txt variant="small" tone="muted" style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }}>이 날은 할 일이 없습니다.</Txt>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
