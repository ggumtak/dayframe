import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, type ScrollViewInstance, Share, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { EmptyToday, OfflineArt } from '@/components/art';
import { Button, Card, Chip, EMPTY_ART, EmptyState, Header, Icon, IconButton, Loading, Row, Screen, SectionTitle, Segmented, Sheet, Txt } from '@/components/ui';
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
import { buildShareText, createTodayReuser, deriveToday, type TodayGrouping } from '@/features/tasks/todayList';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { UpdateBanner } from '@/features/update/UpdateBanner';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, formatTime, instantFor, today, weekdayName } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { PANE_FRAME_MAX } from '@/lib/layout';
import { useLayout } from '@/lib/layoutContext';
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

const groupLabels: Record<TodayGrouping, string> = {
  project: '목록별',
  time: '시간대별',
  priority: '우선순위별',
  none: '그룹 없음',
};

const isTodayView = (value: string): value is TodayView => value === 'list' || value === 'timeline' || value === 'matrix';
const isTodaySort = (value: string): value is TodaySort => value in sortLabels;
const isTodayGrouping = (value: string): value is TodayGrouping => value in groupLabels;

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
  const { twoPane } = useLayout();
  const mainView: TodayView = twoPane && view === 'timeline' ? 'list' : view;
  const [sort, setSort] = usePersistentState<TodaySort>('dayframe-today-sort', 'schedule', isTodaySort);
  const [grouping, setGrouping] = usePersistentState<TodayGrouping>('dayframe-today-group', 'project', isTodayGrouping);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  useTabScrollTop('index', scrollRef);
  const { data: projects } = useProjects();

  const minute = useMinute();
  const timeZone = deviceTimeZone();
  const date = today(timeZone);
  useScreenDefaults({ dueToday: true });

  const smartNowMs = sort === 'smart' ? minute * 60_000 : 0;
  const compare = useMemo(() => {
    if (sort === 'priority') return byPriority;
    if (sort === 'schedule') return bySchedule;
    const context = { subtaskProgress, nowMs: smartNowMs };
    return (a: Task, b: Task) => bySmartRank(a, b, context);
  }, [sort, subtaskProgress, smartNowMs]);
  const projectIds = useMemo(() => (projects ?? []).map((project) => project.id), [projects]);

  const [reuseToday] = useState(createTodayReuser);
  const { overdue, due, groups } = useMemo(
    () => reuseToday(deriveToday(tasks, compare, projectIds, minute * 60_000, grouping)),
    [reuseToday, tasks, compare, projectIds, minute, grouping],
  );
  const allVisibleToday = useMemo(() => [...overdue, ...due], [overdue, due]);
  const grouped = grouping !== 'none';

  const remaining = overdue.length + due.length;
  const summary = remaining || done.length
    ? [remaining ? `${remaining}개 남음` : '', done.length ? `${done.length}개 완료` : ''].filter(Boolean).join(' · ')
    : '할 일 없음';

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
    showToast(`기한 지난 할 일 ${overdue.length}개를 오늘로 옮겼습니다.`);
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

  const closeOptions = () => setOptionsOpen(false);

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
    showToast('체험 체크리스트를 추가했습니다. 눌러서 펼쳐 보세요.');
  };

  const showOnboarding = !isLoading && !isError && tasks.length === 0 && done.length === 0 && !onboardingDismissed;

  const allDoneCard = (
    <View style={styles.allDone}>
      <Icon name="check-circle" size={20} color={done.length ? colors.accentText : colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong">
          {done.length ? `오늘 할 일 ${done.length}개를 모두 마쳤습니다` : '오늘 남은 할 일이 없습니다'}
        </Txt>
        {done.length ? <Txt variant="small" tone="muted">수고하셨습니다. 다른 할 일도 살펴볼까요?</Txt> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="추천 보기" hitSlop={8} onPress={() => setPlanning(true)}>
        <Txt variant="smallStrong" tone="accent">추천 보기</Txt>
      </Pressable>
    </View>
  );

  const timeline = (
    <Timeline
      tasks={due} sessions={sessions ?? []} timeZone={timeZone} overdueCount={twoPane ? 0 : overdue.length}
      onComplete={flow.complete} onAddAt={addAt} onRescheduleTime={rescheduleOnTimeline}
      onPlanOverdue={() => setPlanning(true)} />
  );

  const hasCustomViewBar = mainView === 'list' && remaining > 0 && (grouping !== 'project' || sort !== 'schedule');

  return (
    <Screen maxWidth={twoPane ? PANE_FRAME_MAX : undefined}>
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
                setOptionsOpen(true);
              }}
              color={selectedIds || hasCustomViewBar ? colors.accentText : colors.textMuted} />
          </View>
        )} />
      <UpdateBanner />
      <View style={twoPane ? styles.panes : styles.single}>
        <View style={twoPane ? { width: twoPane.listWidth } : styles.single}>
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            <Segmented<TodayView>
              value={mainView}
              onChange={(next) => {
                setSelectedIds(null);
                setView(next);
              }}
              options={twoPane ? [
                { value: 'list', label: '목록', icon: 'list' },
                { value: 'matrix', label: '매트릭스', icon: 'grid' },
              ] : [
                { value: 'list', label: '목록', icon: 'list' },
                { value: 'timeline', label: '타임라인', icon: 'clock' },
                { value: 'matrix', label: '매트릭스', icon: 'grid' },
              ]} />
          </View>

          {hasCustomViewBar ? (
            <View style={styles.viewPillRow}>
              <Chip
                icon="layers" label={groupLabels[grouping]} selected={grouping !== 'project'}
                onPress={() => setOptionsOpen(true)} />
              <Chip
                icon="sliders" label={sortLabels[sort]} selected={sort !== 'schedule'}
                onPress={() => setOptionsOpen(true)} />
            </View>
          ) : null}

          {isLoading ? <Loading /> : mainView === 'timeline' ? timeline : mainView === 'matrix' ? (
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
                      바로 써 볼 수 있는 4단계 체험 체크리스트를 오늘 할 일에 추가해 드릴까요?
                    </Txt>
                    <View style={{ flexDirection: 'row', gap: space.sm }}>
                      <Button label="체험 체크리스트 추가" kind="secondary" icon="check-square" onPress={createStarterChecklist} style={{ flex: 1, minHeight: 42 }} />
                      <Button label="건너뛰기" kind="secondary" onPress={dismissOnboarding} style={{ minHeight: 42 }} />
                    </View>
                  </Card>
                  {hasHabits ? <TodayHabits /> : null}
                </View>
              ) : remaining === 0 && done.length === 0 && !hasHabits ? (
                <EmptyState
                  icon="sun" art={<EmptyToday size={EMPTY_ART} />} title="오늘 할 일이 없습니다"
                  message="아래 + 버튼으로 추가하거나, 하루 계획에서 다른 할 일을 가져올 수 있습니다."
                  action={<Button label="할 일 추천 보기" kind="secondary" icon="compass" onPress={() => setPlanning(true)} />} />
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
                        title="기한 지남" count={overdue.length} tone="danger"
                        action={(
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                            {overdue.length >= 2 ? (
                              <Pressable
                                accessibilityRole="button" accessibilityLabel="여러 날로 일정 나누기" hitSlop={8}
                                onPress={() => {
                                  haptic.tap();
                                  setPlanning(true);
                                }}
                                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                                <Txt variant="smallStrong">일정 나누기</Txt>
                              </Pressable>
                            ) : null}
                            <Pressable
                              accessibilityRole="button" accessibilityLabel="기한 지난 할 일 오늘로 옮기기" hitSlop={8} onPress={moveOverdue}
                              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                              <Txt variant="smallStrong" tone="muted">오늘로 이동</Txt>
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
                    <Txt variant="small" tone="muted" style={{ padding: space.lg }}>오늘 예정된 할 일이 없습니다.</Txt>
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
        </View>
        {twoPane ? (
          <View style={[styles.side, { borderLeftColor: colors.border }]}>
            {isLoading ? null : timeline}
          </View>
        ) : null}
      </View>

      <PlanDaySheet
        visible={planning} onClose={() => setPlanning(false)}
        overdue={overdue} allOpen={tasks} openRoots={roots} subtaskProgress={subtaskProgress} />

      {optionsOpen ? (
        <Sheet visible onClose={closeOptions} title="보기 옵션">
          {mainView === 'list' ? (
            <View style={{ gap: space.md, marginBottom: space.sm }}>
              <View style={{ gap: 6 }}>
                <Txt variant="caption" tone="muted">그룹 기준</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(['project', 'time', 'priority', 'none'] as TodayGrouping[]).map((option) => (
                    <Chip
                      key={option}
                      icon={option === 'project' ? 'hash' : option === 'time' ? 'clock' : option === 'priority' ? 'flag' : 'list'}
                      label={groupLabels[option]}
                      selected={grouping === option}
                      onPress={() => setGrouping(option)} />
                  ))}
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <Txt variant="caption" tone="muted">정렬 기준</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(['schedule', 'smart', 'priority'] as TodaySort[]).map((option) => (
                    <Chip
                      key={option}
                      icon={option === 'schedule' ? 'calendar' : option === 'smart' ? 'zap' : 'flag'}
                      label={sortLabels[option]}
                      selected={sort === option}
                      onPress={() => setSort(option)} />
                  ))}
                </View>
              </View>
            </View>
          ) : null}
          {mainView === 'list' && (selectedIds || allVisibleToday.length > 1) ? (
            <Row
              icon="check-square" label={selectedIds ? '선택 취소' : '여러 개 선택'}
              onPress={() => {
                haptic.tap();
                closeOptions();
                setSelectedIds((prev) => (prev ? null : new Set()));
              }} />
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
        </Sheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  single: { flex: 1 },
  panes: { flex: 1, flexDirection: 'row' },
  side: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth },
  viewPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space.lg, paddingBottom: space.xs },
  guideBadge: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.lg },
});
