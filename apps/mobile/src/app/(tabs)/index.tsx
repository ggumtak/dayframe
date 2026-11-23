import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Button, EmptyState, Header, Icon, IconButton, Loading, ProgressBar, Row, Screen, SectionTitle, Segmented, Sheet, Txt } from '@/components/ui';
import { useFocusSessions } from '@/data/focus';
import { useHabits } from '@/data/habits';
import { byPriority, bySchedule, useDoneToday, useSubtaskProgress, useTaskIndex } from '@/data/tasks';
import { TodayHabits } from '@/features/habits/TodayHabits';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { BatchBar } from '@/features/tasks/BatchBar';
import { DoneToday } from '@/features/tasks/DoneToday';
import { EisenhowerView } from '@/features/tasks/EisenhowerView';
import { PlanDaySheet } from '@/features/tasks/PlanDaySheet';
import { TaskList } from '@/features/tasks/TaskList';
import { Timeline } from '@/features/tasks/Timeline';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { UpdateBanner } from '@/features/update/UpdateBanner';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueBucket, today, weekdayName } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { usePersistentState } from '@/lib/persist';
import type { Task } from '@/lib/shared';
import { bySmartRank } from '@/lib/smart';
import { showToast } from '@/lib/toast';
import { space, useTheme } from '@/theme';

type TodayView = 'list' | 'timeline' | 'matrix';
type TodaySort = 'schedule' | 'smart' | 'priority';

const sortLabels: Record<TodaySort, string> = {
  schedule: '일정순',
  smart: '스마트 추천순',
  priority: '우선순위순',
};

const isTodayView = (value: string): value is TodayView => value === 'list' || value === 'timeline' || value === 'matrix';
const isTodaySort = (value: string): value is TodaySort => value in sortLabels;

export default function Today() {
  const { colors } = useTheme();
  const { tasks, roots, isLoading, isError, refetch } = useTaskIndex();
  const { progress: subtaskProgress } = useSubtaskProgress();
  const { data: sessions } = useFocusSessions();
  const done = useDoneToday();
  const hasHabits = (useHabits().data ?? []).some((habit) => !habit.archived_at);
  const flow = useTaskFlow();
  const quickAdd = useQuickAdd();

  const [view, setView] = usePersistentState<TodayView>('dayframe-today-view', 'list', isTodayView);
  const [sort, setSort] = usePersistentState<TodaySort>('dayframe-today-sort', 'schedule', isTodaySort);
  const [pickingSort, setPickingSort] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useMinute();
  const timeZone = deviceTimeZone();
  const date = today(timeZone);
  useScreenDefaults({ dueToday: true });

  const sortList = useCallback((list: Task[]) => {
    const copy = [...list];
    if (sort === 'smart') return copy.sort((a, b) => bySmartRank(a, b, { subtaskProgress }));
    if (sort === 'priority') return copy.sort(byPriority);
    return copy.sort(bySchedule);
  }, [sort, subtaskProgress]);

  // Deduplicate subtasks whose parent is already shown in the Today/Overdue list.
  const visibleDueIds = new Set(
    tasks.filter((task) => ['overdue', 'today'].includes(dueBucket(task))).map((task) => task.id),
  );
  const overdue = sortList(
    tasks.filter((task) => dueBucket(task) === 'overdue' && (!task.parent_task_id || !visibleDueIds.has(task.parent_task_id))),
  );
  const due = sortList(
    tasks.filter((task) => dueBucket(task) === 'today' && (!task.parent_task_id || !visibleDueIds.has(task.parent_task_id))),
  );
  const allVisibleToday = useMemo(() => [...overdue, ...due], [overdue, due]);

  const remaining = overdue.length + due.length;
  const totalToday = remaining + done.length;
  const progressRatio = totalToday > 0 ? done.length / totalToday : 0;

  const summary = overdue.length && due.length
    ? `지연 ${overdue.length} · 오늘 ${due.length}`
    : remaining ? `${remaining}개 남음` : done.length ? `${done.length}개 완료` : '남은 일 없음';

  const selectedTasks = useMemo(
    () => (selectedIds ? allVisibleToday.filter((t) => selectedIds.has(t.id)) : []),
    [selectedIds, allVisibleToday],
  );

  const toggleSelect = useCallback((task: Task) => {
    setSelectedIds((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }, []);

  const startSelect = useCallback((task: Task) => {
    setSelectedIds(new Set([task.id]));
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const moveOverdue = () => {
    haptic.success();
    flow.rescheduleOverdue();
    showToast(`지연된 ${overdue.length}개를 오늘로 옮겼습니다.`);
  };

  const addAt = (minutes: number) => {
    const clock = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    quickAdd.open({ dueToday: true, initialText: '오늘 ' + clock + ' ' });
  };

  return (
    <Screen>
      <Header
        title="오늘" subtitle={`${date.month}월 ${date.day}일 ${weekdayName(date)}요일 · ${summary}`}
        right={(
          <View style={{ flexDirection: 'row' }}>
            <IconButton
              name="compass" label="하루 계획 및 일정 정리"
              onPress={() => {
                haptic.tap();
                setPlanning(true);
              }}
              color={overdue.length > 0 ? colors.danger : colors.accent} />
            {view === 'list' ? (
              <IconButton
                name="sliders" label="정렬" onPress={() => setPickingSort(true)}
                color={sort !== 'schedule' ? colors.accent : colors.textMuted} />
            ) : null}
            <IconButton name="search" label="검색" onPress={() => router.push('/search')} color={colors.textMuted} />
            <IconButton name="settings" label="설정" onPress={() => router.push('/settings')} color={colors.textMuted} />
          </View>
        )} />
      <UpdateBanner />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.sm }}>
        <Segmented<TodayView>
          value={view}
          onChange={(next) => {
            setSelectedIds(null);
            setView(next);
          }}
          options={[
            { value: 'list', label: '목록', icon: 'list' },
            { value: 'timeline', label: '타임라인', icon: 'clock' },
            { value: 'matrix', label: '매트릭스', icon: 'grid' },
          ]} />
        {totalToday > 0 && view === 'list' ? (
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Txt variant="caption" tone={progressRatio === 1 ? 'success' : 'muted'}>
                {progressRatio === 1 ? `오늘 할 일 ${done.length}개 모두 완료!` : `오늘 진행률 ${done.length}/${totalToday} (${Math.round(progressRatio * 100)}%)`}
              </Txt>
              {allVisibleToday.length > 1 ? (
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    haptic.tap();
                    setSelectedIds((prev) => (prev ? null : new Set()));
                  }}>
                  <Txt variant="caption" tone={selectedIds ? 'accent' : 'faint'} style={{ fontWeight: '600' }}>
                    {selectedIds ? '선택 종료' : '일괄 편집'}
                  </Txt>
                </Pressable>
              ) : null}
            </View>
            <ProgressBar value={progressRatio} color={progressRatio === 1 ? colors.success : colors.accent} height={5} />
          </View>
        ) : null}
      </View>

      {isLoading ? <Loading /> : view === 'timeline' ? (
        <Timeline tasks={due} sessions={sessions ?? []} timeZone={timeZone} onComplete={flow.complete} onAddAt={addAt} />
      ) : view === 'matrix' ? (
        <EisenhowerView roots={roots} subtaskProgress={subtaskProgress} refreshing={refreshing} onRefresh={refresh} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: selectedIds ? 180 : 140, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {isError && tasks.length === 0 ? (
            <EmptyState
              icon="cloud-off" title="불러오지 못했습니다" message="네트워크 연결을 확인한 뒤 다시 시도해 주세요."
              action={<Button label="다시 시도" kind="secondary" onPress={refresh} />} />
          ) : remaining === 0 && done.length === 0 && !hasHabits ? (
            <EmptyState
              icon="sun" title="오늘 할 일이 없습니다"
              message="아래 + 버튼으로 추가하거나 하루 계획에서 남은 일을 가져올 수 있습니다."
              action={<Button label="오늘 할 일 추천 보기" kind="secondary" icon="compass" onPress={() => setPlanning(true)} />} />
          ) : (
            <>
              {overdue.length ? (
                <>
                  <SectionTitle
                    title="지연됨" count={overdue.length} tone="danger"
                    action={(
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                        {overdue.length >= 2 ? (
                          <Pressable
                            accessibilityRole="button" accessibilityLabel="일정 분산 정리" hitSlop={8}
                            onPress={() => {
                              haptic.tap();
                              setPlanning(true);
                            }}
                            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                            <Txt variant="smallStrong" tone="accent">분산 정리</Txt>
                          </Pressable>
                        ) : null}
                        <Pressable
                          accessibilityRole="button" accessibilityLabel="오늘로 옮기기" hitSlop={8} onPress={moveOverdue}
                          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                          <Txt variant="smallStrong" tone="muted">오늘로</Txt>
                        </Pressable>
                      </View>
                    )} />
                  <TaskList
                    tasks={overdue} selectedIds={selectedIds} onToggleSelect={toggleSelect} onStartSelect={startSelect} />
                </>
              ) : null}
              {due.length ? (
                <>
                  <SectionTitle
                    title="오늘" count={due.length}
                    action={sort !== 'schedule' ? <Txt variant="caption" tone="accent">{sortLabels[sort]}</Txt> : undefined} />
                  <TaskList
                    tasks={due} hideDate selectedIds={selectedIds} onToggleSelect={toggleSelect} onStartSelect={startSelect} />
                </>
              ) : overdue.length ? (
                <Txt variant="small" tone="muted" style={{ padding: space.lg }}>오늘 예정된 일은 없습니다.</Txt>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.xl }}>
                  <Icon name="check-circle" size={18} color={colors.success} />
                  <Txt variant="bodyStrong" style={{ flex: 1 }}>
                    {done.length ? '오늘 할 일을 모두 마쳤습니다' : '오늘 남은 할 일이 없습니다'}
                  </Txt>
                  <Pressable hitSlop={8} onPress={() => setPlanning(true)}>
                    <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>추천 보기</Txt>
                  </Pressable>
                </View>
              )}
              {!selectedIds ? <TodayHabits /> : null}
              {!selectedIds ? <DoneToday items={done} /> : null}
            </>
          )}
        </ScrollView>
      )}

      {selectedIds ? (
        <BatchBar
          selected={selectedTasks}
          totalCount={allVisibleToday.length}
          onSelectAll={() => {
            haptic.tap();
            setSelectedIds((prev) => (prev && prev.size === allVisibleToday.length ? new Set() : new Set(allVisibleToday.map((t) => t.id))));
          }}
          onCancel={() => setSelectedIds(null)} />
      ) : null}

      <PlanDaySheet
        visible={planning} onClose={() => setPlanning(false)}
        overdue={overdue} allOpen={tasks} openRoots={roots} subtaskProgress={subtaskProgress} />

      <Sheet visible={pickingSort} onClose={() => setPickingSort(false)} title="오늘 정렬 기준">
        {(['schedule', 'smart', 'priority'] as TodaySort[]).map((option) => (
          <Row
            key={option}
            icon={option === 'schedule' ? 'calendar' : option === 'smart' ? 'zap' : 'flag'}
            label={sortLabels[option]}
            detail={option === 'smart' ? '긴급도 · 우선순위 · 진행률 반영' : undefined}
            trailing={sort === option ? <Icon name="check" size={18} color={colors.accent} /> : undefined}
            onPress={() => {
              haptic.tap();
              setSort(option);
              setPickingSort(false);
            }} />
        ))}
      </Sheet>
    </Screen>
  );
}
