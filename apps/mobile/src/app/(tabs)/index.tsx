import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, type ScrollViewInstance, Share, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { EmptyToday, OfflineArt } from '@/components/art';
import { Button, Card, EMPTY_ART, EmptyState, Header, Icon, IconButton, Loading, Row, Screen, SectionTitle, Segmented, Sheet, Txt } from '@/components/ui';
import { useFocusSessions } from '@/data/focus';
import { useHabits } from '@/data/habits';
import { byPriority, bySchedule, useDoneToday, useProjects, useSubtaskProgress, useTaskIndex } from '@/data/tasks';
import { AI_ROUTES } from '@/features/ai';
import { TodayHabits } from '@/features/habits/TodayHabits';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { BatchBar } from '@/features/tasks/BatchBar';
import { DoneToday } from '@/features/tasks/DoneToday';
import { EisenhowerView } from '@/features/tasks/EisenhowerView';
import { dismissOnboarding, STARTER_CHECKLIST, useOnboardingDismissed } from '@/features/tasks/onboarding';
import { PlanDaySheet } from '@/features/tasks/PlanDaySheet';
import { TaskList } from '@/features/tasks/TaskList';
import { Timeline } from '@/features/tasks/Timeline';
import { OverdueStrip, TodayGroups } from '@/features/tasks/TodayGroups';
import { buildShareText, createTodayReuser, deriveToday } from '@/features/tasks/todayList';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { UpdateBanner } from '@/features/update/UpdateBanner';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, formatTime, instantFor, today, weekdayName } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { usePersistentState } from '@/lib/persist';
import type { Task, TaskPatch } from '@/lib/shared';
import { bySmartRank } from '@/lib/smart';
import { useTabScrollTop } from '@/lib/tabScroll';
import { showToast } from '@/lib/toast';
import { space, useTheme } from '@/theme';

type TodayView = 'list' | 'timeline' | 'matrix';

type TodaySort = 'schedule' | 'smart' | 'priority';

const sortLabels: Record<TodaySort, string> = {
  schedule: '일정순',
  smart: '추천순',
  priority: '우선순위순',
};

type TodayGrouping = 'project' | 'none';
type OptionsSheet = null | 'menu' | 'sort';

const isTodayView = (value: string): value is TodayView => value === 'list' || value === 'timeline' || value === 'matrix';
const isTodaySort = (value: string): value is TodaySort => value in sortLabels;
const isTodayGrouping = (value: string): value is TodayGrouping => value === 'project' || value === 'none';

export default function Today() {
  const { colors } = useTheme();
  const { tasks, roots, isLoading, isError, refetch } = useTaskIndex();
  const { progress: subtaskProgress } = useSubtaskProgress();
  const { data: sessions } = useFocusSessions();
  const done = useDoneToday();
  const hasHabits = (useHabits().data ?? []).some((habit) => !habit.archived_at);
  const onboardingDismissed = useOnboardingDismissed();
  const flow = useTaskFlow();
  const quickAdd = useQuickAdd();

  const [view, setView] = usePersistentState<TodayView>('dayframe-today-view', 'list', isTodayView);
  const [sort, setSort] = usePersistentState<TodaySort>('dayframe-today-sort', 'schedule', isTodaySort);
  const [grouping, setGrouping] = usePersistentState<TodayGrouping>('dayframe-today-group', 'project', isTodayGrouping);
  const [options, setOptions] = useState<OptionsSheet>(null);
  const [planning, setPlanning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  useTabScrollTop('index', scrollRef);
  const { data: projects } = useProjects();

  // Re-renders this screen once a minute (and on return to the foreground) so the day rolls over.
  const minute = useMinute();
  const timeZone = deviceTimeZone();
  const date = today(timeZone);
  useScreenDefaults({ dueToday: true });

  // Only the smart order depends on the clock; the other two stay the same function all day.
  const smartNowMs = sort === 'smart' ? minute * 60_000 : 0;
  const compare = useMemo(() => {
    if (sort === 'priority') return byPriority;
    if (sort === 'schedule') return bySchedule;
    const context = { subtaskProgress, nowMs: smartNowMs };
    return (a: Task, b: Task) => bySmartRank(a, b, context);
  }, [sort, subtaskProgress, smartNowMs]);
  const projectIds = useMemo(() => (projects ?? []).map((project) => project.id), [projects]);

  // Overdue / today / per-list groups, worked out once per input change (each task's bucket once). The
  // minute tick re-derives so midnight rolls over, but the reuser hands back the previous lists when
  // nothing moved, so memoised lists and rows see identical props and do not re-render.
  const [reuseToday] = useState(createTodayReuser);
  const { overdue, due, groups } = useMemo(
    () => reuseToday(deriveToday(tasks, compare, projectIds, minute * 60_000)),
    [reuseToday, tasks, compare, projectIds, minute],
  );
  const allVisibleToday = useMemo(() => [...overdue, ...due], [overdue, due]);
  const grouped = grouping === 'project';

  const remaining = overdue.length + due.length;

  // The day's numbers live in the subtitle, once; there is no progress bar repeating them.
  const summary = remaining || done.length
    ? [remaining ? `남은 일 ${remaining}` : '', done.length ? `완료 ${done.length}` : ''].filter(Boolean).join(' · ')
    : '남은 할 일 없음';

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
    showToast(`지연된 할 일 ${overdue.length}개를 오늘로 옮겼습니다.`);
  };

  const openPlanning = () => {
    haptic.tap();
    setPlanning(true);
  };

  const shareToday = () => {
    const names = new Map((projects ?? []).map((project) => [project.id, project.name]));
    const message = buildShareText({
      date, overdue, due,
      doneTitles: done.map(({ completion }) => completion.task.title),
      projectName: (id) => names.get(id),
    });
    if (!message) {
      showToast('공유할 할 일이 없습니다.');
      return;
    }
    Share.share({ message }).catch(() => showToast('공유하지 못했습니다.'));
  };

  const closeOptions = () => setOptions(null);

  const addAt = (minutes: number) => {
    const clock = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    quickAdd.open({ dueToday: true, initialText: '오늘 ' + clock + ' ' });
  };

  const rescheduleOnTimeline = (task: Task, minutes: number) => {
    const prevPatch: TaskPatch = {
      due_at: task.due_at,
      all_day: task.all_day,
      recurrence_rule: task.recurrence_rule,
      recurrence_mode: task.recurrence_mode,
      recurrence_local_time: task.recurrence_local_time,
    };
    flow.reschedule(task, today(task.timezone), minutes);
    showToast(`‘${task.title}’${josa(task.title, '을/를')} ${formatTime(minutes)}${josa(formatTime(minutes), '으로/로')} 옮겼습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => flow.update(task.id, prevPatch),
    });
  };

  const createStarterChecklist = () => {
    haptic.success();
    dismissOnboarding();
    const parentId = flow.create({
      input: {
        title: STARTER_CHECKLIST.title,
        notes: STARTER_CHECKLIST.notes,
        priority: 2,
        timezone: timeZone,
        position: 1024,
        due_at: instantFor(date, null, timeZone),
        all_day: true,
        duration_minutes: STARTER_CHECKLIST.durationMinutes,
      },
    });
    STARTER_CHECKLIST.items.forEach((item, idx) => {
      flow.create({
        input: {
          title: item,
          priority: 4,
          timezone: timeZone,
          position: (idx + 1) * 1024,
          parent_task_id: parentId,
        },
      });
    });
    showToast('체험 체크리스트를 넣었습니다. 눌러서 펼쳐 보세요.');
  };

  const showOnboarding = !isLoading && !isError && tasks.length === 0 && done.length === 0 && !onboardingDismissed;

  // A plain line, not a coloured card: one accent check is the only celebration that stays on screen (the moment
  // of completion already had its animation and haptic).
  const allDoneCard = (
    <View style={styles.allDone}>
      <Icon name="check-circle" size={20} color={done.length ? colors.accentText : colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong">
          {done.length ? `오늘 예정된 ${done.length}개를 모두 마쳤습니다` : '오늘 남은 할 일이 없습니다'}
        </Txt>
        {done.length ? <Txt variant="small" tone="muted">수고하셨습니다. 남은 일정도 살펴볼까요?</Txt> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="추천 보기" hitSlop={8} onPress={() => setPlanning(true)}>
        <Txt variant="smallStrong" tone="accent">추천 보기</Txt>
      </Pressable>
    </View>
  );

  return (
    <Screen>
      <Header
        title="오늘" subtitle={`${date.month}월 ${date.day}일 (${weekdayName(date)}) · ${summary}`}
        right={(
          <View style={{ flexDirection: 'row' }}>
            <IconButton
              name="compass" label="하루 계획·일정 정리"
              onPress={() => {
                haptic.tap();
                setPlanning(true);
              }}
              color={colors.textMuted} />
            <IconButton name="search" label="검색" onPress={() => router.push('/search')} color={colors.textMuted} />
            <IconButton
              name="more-vertical" label="보기 옵션"
              onPress={() => {
                haptic.tap();
                setOptions('menu');
              }}
              color={selectedIds ? colors.accentText : colors.textMuted} />
          </View>
        )} />
      <UpdateBanner />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
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
      </View>

      {isLoading ? <Loading /> : view === 'timeline' ? (
        <Timeline
          tasks={due} sessions={sessions ?? []} timeZone={timeZone} overdueCount={overdue.length}
          onComplete={flow.complete} onAddAt={addAt} onRescheduleTime={rescheduleOnTimeline}
          onPlanOverdue={() => setPlanning(true)} />
      ) : view === 'matrix' ? (
        <EisenhowerView roots={roots} subtaskProgress={subtaskProgress} refreshing={refreshing} onRefresh={refresh} />
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingBottom: selectedIds ? 180 : 140, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}>
          {isError && tasks.length === 0 ? (
            <EmptyState
              icon="cloud-off" art={<OfflineArt size={EMPTY_ART} />} title="불러오지 못했습니다" message="인터넷 연결을 확인한 뒤 다시 시도해 주세요."
              action={<Button label="다시 시도" kind="secondary" onPress={refresh} />} />
          ) : showOnboarding ? (
            <View style={{ padding: space.lg, gap: space.md }}>
              <Card style={{ gap: space.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <View style={[styles.guideBadge, { backgroundColor: colors.surfaceMuted }]}>
                    <Icon name="compass" size={18} color={colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">Dayframe 시작 가이드</Txt>
                    <Txt variant="caption" tone="muted">체크리스트 · 타임라인 · 습관 · 집중을 한곳에서</Txt>
                  </View>
                </View>
                <Txt variant="small" tone="muted">
                  직접 따라 해 볼 수 있는 4단계 체험 체크리스트를 오늘 할 일에 넣어 드릴까요?
                </Txt>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="체험 체크리스트 넣기" icon="check-square" onPress={createStarterChecklist} style={{ flex: 1, minHeight: 42 }} />
                  <Button label="건너뛰기" kind="secondary" onPress={dismissOnboarding} style={{ minHeight: 42 }} />
                </View>
              </Card>
              {hasHabits ? <TodayHabits /> : null}
            </View>
          ) : remaining === 0 && done.length === 0 && !hasHabits ? (
            <EmptyState
              icon="sun" art={<EmptyToday size={EMPTY_ART} />} title="오늘 할 일이 없습니다"
              message="아래 + 버튼으로 추가하거나 하루 계획에서 남은 일을 가져올 수 있습니다."
              action={<Button label="오늘 할 일 추천 보기" kind="secondary" icon="compass" onPress={() => setPlanning(true)} />} />
          ) : grouped ? (
            <>
              {overdue.length ? (
                <OverdueStrip count={overdue.length} onSpread={overdue.length >= 2 ? openPlanning : undefined} onMoveToday={moveOverdue} />
              ) : null}
              {groups.length ? (
                <TodayGroups groups={groups} selectedIds={selectedIds} onToggleSelect={toggleSelect} onStartSelect={startSelect} />
              ) : (
                allDoneCard
              )}
              {!selectedIds ? <TodayHabits /> : null}
              {!selectedIds ? <DoneToday items={done} /> : null}
            </>
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
                            accessibilityRole="button" accessibilityLabel="여러 날에 나눠 잡기" hitSlop={8}
                            onPress={() => {
                              haptic.tap();
                              setPlanning(true);
                            }}
                            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                            <Txt variant="smallStrong">나눠 잡기</Txt>
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
                    action={sort !== 'schedule' ? <Txt variant="caption" tone="muted">{sortLabels[sort]}</Txt> : undefined} />
                  <TaskList
                    tasks={due} hideDate selectedIds={selectedIds} onToggleSelect={toggleSelect} onStartSelect={startSelect} />
                </>
              ) : overdue.length ? (
                <Txt variant="small" tone="muted" style={{ padding: space.lg }}>오늘 예정된 일은 없습니다.</Txt>
              ) : (
                allDoneCard
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

      {/* Mounted only while open: a hidden Sheet still runs its gesture and animation hooks on every render. */}
      {options ? (
        <Sheet visible onClose={closeOptions} title={options === 'sort' ? '오늘 정렬 기준' : '보기 옵션'}>
          {options === 'sort' ? (
            (['schedule', 'smart', 'priority'] as TodaySort[]).map((option) => (
              <Row
                key={option}
                icon={option === 'schedule' ? 'calendar' : option === 'smart' ? 'zap' : 'flag'}
                label={sortLabels[option]}
                detail={option === 'smart' ? '긴급도 · 우선순위 · 진행률' : undefined}
                trailing={sort === option ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
                onPress={() => {
                  haptic.tap();
                  setSort(option);
                  closeOptions();
                }} />
            ))
          ) : (
            <>
              {view === 'list' ? (
                <>
                  <Row
                    icon="sliders" label="정렬" detail={sortLabels[sort]}
                    trailing={<Icon name="chevron-right" size={18} color={colors.textFaint} />}
                    onPress={() => {
                      haptic.tap();
                      setOptions('sort');
                    }} />
                  <Row
                    icon="layers" label="묶기" detail={grouped ? '목록별' : '묶지 않기'}
                    onPress={() => {
                      haptic.tap();
                      setGrouping(grouped ? 'none' : 'project');
                    }} />
                  {selectedIds || allVisibleToday.length > 1 ? (
                    <Row
                      icon="check-square" label={selectedIds ? '선택 끝내기' : '여러 개 선택'}
                      onPress={() => {
                        haptic.tap();
                        closeOptions();
                        setSelectedIds((prev) => (prev ? null : new Set()));
                      }} />
                  ) : null}
                </>
              ) : null}
              <Row
                icon="share-2" label="오늘 할 일 공유"
                onPress={() => {
                  closeOptions();
                  shareToday();
                }} />
              <Row
                icon="zap" label="AI 비서"
                onPress={() => {
                  closeOptions();
                  router.push(AI_ROUTES.hub);
                }} />
              <Row
                icon="settings" label="설정"
                onPress={() => {
                  closeOptions();
                  router.push('/settings');
                }} />
            </>
          )}
        </Sheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  guideBadge: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.lg },
});
