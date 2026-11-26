import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, type ScrollViewInstance, Share, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { EmptyToday, OfflineArt } from '@/components/art';
import { AllDoneArt } from '@/components/art/Illustrations';
import {
  Button, Card, Chip, EMPTY_ART, EmptyState, Header, Icon, IconButton, Loading, ProgressBar, Row, Screen, SectionTitle, Segmented, Sheet, Txt,
} from '@/components/ui';
import { useFocusSessions } from '@/data/focus';
import { useHabits } from '@/data/habits';
import { byPosition, byPriority, bySchedule, useDoneToday, useProjects, useSubtaskProgress, useTaskIndex } from '@/data/tasks';
import { AI_ROUTES } from '@/features/ai';
import { TodayHabits } from '@/features/habits/TodayHabits';
import {
  type HardwareKeyEvent, KEY_PRIORITY, matchesCombo, useKeyHandler, useListCursor,
  useScreenContext, useScreenFocused, useTaskShortcuts,
} from '@/features/keyboard';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { TODAY_HABITS_POSITIONS, type TodayHabitsPosition } from '@/features/settings/prefs';
import { setPersonalPrefs, usePersonalPrefs } from '@/features/settings/prefsStore';
import { BatchBar } from '@/features/tasks/BatchBar';
import { DoneToday } from '@/features/tasks/DoneToday';
import { EisenhowerView } from '@/features/tasks/EisenhowerView';
import { useDailyFocus } from '@/features/tasks/mitStore';
import { dismissOnboarding, STARTER_CHECKLIST, useOnboardingDismissed } from '@/features/tasks/onboarding';
import { PlanDaySheet } from '@/features/tasks/PlanDaySheet';
import { TaskListSheets, TaskRows, useTaskListModel } from '@/features/tasks/TaskList';
import { Timeline } from '@/features/tasks/Timeline';
import { useTodayFoldedGroups } from '@/features/tasks/todayFold';
import { OverdueBar } from '@/features/tasks/OverdueBar';
import { TodayGroups } from '@/features/tasks/TodayGroups';
import {
  buildShareText, buildTodayGroups, createTodayReuser, deriveToday, partitionDailyFocus, type TodayGrouping,
} from '@/features/tasks/todayList';
import { useScreenDefaults } from '@/features/tasks/useScreenDefaults';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { UpdateBanner } from '@/features/update/UpdateBanner';
import { useMinute } from '@/lib/clock';
import { deviceTimeZone, dueMinutes, formatDurationMinutes, formatTime, instantFor, logicalToday, Temporal, weekdayName } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { PANE_FRAME_MAX } from '@/lib/layout';
import { useLayout } from '@/lib/layoutContext';
import { usePersistentState } from '@/lib/persist';
import type { Task, TaskPatch } from '@/lib/shared';
import { bySmartRank } from '@/lib/smart';
import { useTabScrollTop } from '@/lib/tabScroll';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

type TodayView = 'list' | 'timeline' | 'matrix';
type TodaySort = 'schedule' | 'smart' | 'priority' | 'manual';

const sortLabels: Record<TodaySort, string> = {
  schedule: '일정순',
  smart: '추천순',
  priority: '우선순위순',
  manual: '직접 정렬',
};

const groupLabels: Record<TodayGrouping, string> = {
  project: '목록별',
  time: '시간대별',
  priority: '우선순위별',
  none: '그룹 없음',
};

const habitPositionLabels: Record<TodayHabitsPosition, string> = {
  top: '위',
  bottom: '아래',
  hidden: '숨김',
};

const isTodayView = (value: string): value is TodayView => value === 'list' || value === 'timeline' || value === 'matrix';
const isTodaySort = (value: string): value is TodaySort => value in sortLabels;
const isTodayGrouping = (value: string): value is TodayGrouping => value in groupLabels;
const taskId = (task: Task) => task.id;

function snapshotSchedule(task: Task): TaskPatch {
  return {
    due_at: task.due_at,
    all_day: task.all_day,
    recurrence_rule: task.recurrence_rule,
    recurrence_mode: task.recurrence_mode,
    recurrence_local_time: task.recurrence_local_time,
  };
}

export default function Today() {
  const { colors } = useTheme();
  const isFocused = useScreenFocused();
  useScreenContext('today', isFocused);
  const prefs = usePersonalPrefs();
  const { tasks, roots, isLoading, isError, refetch } = useTaskIndex();
  const { progress: subtaskProgress } = useSubtaskProgress();
  const { data: sessions } = useFocusSessions();
  const done = useDoneToday();
  const hasHabits = (useHabits().data ?? []).some((habit) => !habit.archived_at);
  const onboardingDismissed = useOnboardingDismissed();
  const flow = useTaskFlow();
  const quickAdd = useQuickAdd();
  const { model: listModel, sheets: listSheets } = useTaskListModel();

  const [view, setView] = usePersistentState<TodayView>('dayframe-today-view', 'list', isTodayView);
  const { twoPane } = useLayout();
  const mainView: TodayView = twoPane && view === 'timeline' ? 'list' : view;
  const [sort, setSort] = usePersistentState<TodaySort>('dayframe-today-sort', 'schedule', isTodaySort);
  const [grouping, setGrouping] = usePersistentState<TodayGrouping>('dayframe-today-group', 'project', isTodayGrouping);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planInitialTab, setPlanInitialTab] = useState<'overdue' | 'suggest' | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  useTabScrollTop('index', scrollRef);
  const { data: projects } = useProjects();

  const minute = useMinute();
  const timeZone = deviceTimeZone();
  const nowInstant = useMemo(() => Temporal.Instant.fromEpochMilliseconds(minute * 60_000), [minute]);
  const date = useMemo(() => logicalToday(timeZone, prefs.dayStartHour, nowInstant), [timeZone, prefs.dayStartHour, nowInstant]);
  const todayIso = date.toString();
  const zonedNow = useMemo(() => nowInstant.toZonedDateTimeISO(timeZone), [nowInstant, timeZone]);
  const nowMinutes = zonedNow.hour * 60 + zonedNow.minute;
  const nowHour = zonedNow.hour;

  const foldedGroups = useTodayFoldedGroups(todayIso);
  const dailyFocus = useDailyFocus(todayIso);
  useScreenDefaults({ dueToday: true });

  const smartNowMs = sort === 'smart' ? minute * 60_000 : 0;
  const compare = useMemo(() => {
    if (sort === 'manual') return byPosition;
    if (sort === 'priority') return byPriority;
    if (sort === 'schedule') return bySchedule;
    const context = { subtaskProgress, nowMs: smartNowMs };
    return (a: Task, b: Task) => bySmartRank(a, b, context);
  }, [sort, subtaskProgress, smartNowMs]);
  const projectIds = useMemo(() => (projects ?? []).map((project) => project.id), [projects]);

  const [reuseToday] = useState(createTodayReuser);
  const { overdue, due, groups } = useMemo(
    () => reuseToday(deriveToday(tasks, compare, projectIds, minute * 60_000, grouping, prefs.dayStartHour)),
    [reuseToday, tasks, compare, projectIds, minute, grouping, prefs.dayStartHour],
  );
  const allVisibleToday = useMemo(() => [...overdue, ...due], [overdue, due]);
  const grouped = grouping !== 'none';

  const { mitTasks, eveningTasks, restOverdue, restDue } = useMemo(
    () => partitionDailyFocus(overdue, due, dailyFocus.mitIds, dailyFocus.eveningIds),
    [overdue, due, dailyFocus.mitIds, dailyFocus.eveningIds],
  );

  const displayGroups = useMemo(() => {
    if (!grouped) return [];
    if (mitTasks.length === 0 && eveningTasks.length === 0) return groups;
    return buildTodayGroups(restOverdue, restDue, projectIds, grouping);
  }, [grouped, mitTasks.length, eveningTasks.length, groups, restOverdue, restDue, projectIds, grouping]);

  const visibleListTasks = useMemo(() => {
    if (mainView !== 'list') return [];
    const daytime = !grouped
      ? [...restOverdue, ...restDue]
      : displayGroups.flatMap((group) => (
        !selectedIds && foldedGroups.has(group.key) ? [] : [...group.overdue, ...group.due]
      ));
    return [...mitTasks, ...daytime, ...eveningTasks];
  }, [mainView, grouped, restOverdue, restDue, displayGroups, selectedIds, foldedGroups, mitTasks, eveningTasks]);

  const cursor = useListCursor(visibleListTasks, taskId, {
    enabled: isFocused && mainView === 'list',
    scrollRef,
    estimatedRowHeight: 64,
    headerOffset: 120,
  });

  const remaining = overdue.length + due.length;
  const totalToday = remaining + done.length;
  const summary = remaining || done.length
    ? [remaining ? `${remaining}개 남음` : '', done.length ? `${done.length}개 완료` : ''].filter(Boolean).join(' · ')
    : '할 일 없음';

  const plannedMinutes = useMemo(
    () => allVisibleToday.reduce((sum, task) => sum + (task.duration_minutes ?? 0), 0),
    [allVisibleToday],
  );

  const todayFocusMinutes = useMemo(() => {
    let total = 0;
    for (const session of sessions ?? []) {
      if (session.status !== 'completed' || !session.ended_at) continue;
      const startInstant = Temporal.Instant.from(session.started_at);
      const sessionDay = logicalToday(timeZone, prefs.dayStartHour, startInstant);
      if (Temporal.PlainDate.compare(sessionDay, date) !== 0) continue;
      total += Math.max(0, startInstant.until(Temporal.Instant.from(session.ended_at)).total('minutes'));
    }
    return Math.round(total);
  }, [sessions, timeZone, prefs.dayStartHour, date]);

  const focusTarget = useMemo(() => {
    const timed = due
      .map((task) => ({ task, start: dueMinutes(task) }))
      .filter((entry): entry is { task: Task; start: number } => entry.start !== null)
      .sort((a, b) => a.start - b.start);
    const active = timed.find(({ task, start }) => start <= nowMinutes && nowMinutes < start + (task.duration_minutes ?? 30));
    if (active) return active.task;
    if (mitTasks.length > 0) return mitTasks[0];
    const upcoming = timed.find(({ start }) => start >= nowMinutes);
    return upcoming?.task ?? null;
  }, [due, nowMinutes, mitTasks]);

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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const moveOverdue = useCallback(() => {
    if (!overdue.length) return;
    const snapshots = overdue.map((task) => ({ id: task.id, patch: snapshotSchedule(task) }));
    haptic.success();
    flow.rescheduleOverdue();
    showToast(`기한 지난 할 일 ${overdue.length}개를 오늘로 옮겼습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => {
        for (const snap of snapshots) flow.update(snap.id, snap.patch);
      },
    });
  }, [flow, overdue]);

  const deferRemainingToTomorrow = useCallback(() => {
    if (!allVisibleToday.length) return;
    const tomorrow = date.add({ days: 1 });
    const snapshots = allVisibleToday.map((task) => ({ id: task.id, patch: snapshotSchedule(task) }));
    haptic.success();
    for (const task of allVisibleToday) {
      flow.reschedule(task, tomorrow);
    }
    showToast(`남은 할 일 ${allVisibleToday.length}개를 내일로 미뤘습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => {
        for (const snap of snapshots) flow.update(snap.id, snap.patch);
      },
    });
  }, [allVisibleToday, date, flow]);

  const openPlanning = useCallback((initialTab?: 'overdue' | 'suggest') => {
    haptic.tap();
    setPlanInitialTab(initialTab);
    setPlanning(true);
  }, []);

  const startQuickFocus = useCallback((task: Task) => {
    haptic.light();
    router.navigate({
      pathname: '/focus',
      params: {
        taskId: task.id,
        title: task.title,
        ...(task.duration_minutes ? { minutes: String(task.duration_minutes), duration: String(task.duration_minutes) } : {}),
        autostart: '1',
        at: String(Date.now()),
      },
    });
  }, []);

  const handleAddSubtask = useCallback((task: Task) => {
    quickAdd.open({ parentTaskId: task.id });
  }, [quickAdd]);

  const handleTodayKey = useCallback((event: HardwareKeyEvent): boolean => {
    if (event.editing || event.modal) return false;

    if (matchesCombo(event, 'tab') || matchesCombo(event, ']')) {
      if (!event.repeat) {
        const views: TodayView[] = twoPane ? ['list', 'matrix'] : ['list', 'timeline', 'matrix'];
        const currentIndex = Math.max(0, views.indexOf(mainView));
        const next = views[(currentIndex + 1) % views.length];
        setSelectedIds(null);
        setView(next);
        haptic.tap();
      }
      return true;
    }
    if (matchesCombo(event, 'shift+tab') || matchesCombo(event, '[')) {
      if (!event.repeat) {
        const views: TodayView[] = twoPane ? ['list', 'matrix'] : ['list', 'timeline', 'matrix'];
        const currentIndex = Math.max(0, views.indexOf(mainView));
        const next = views[(currentIndex - 1 + views.length) % views.length];
        setSelectedIds(null);
        setView(next);
        haptic.tap();
      }
      return true;
    }
    if (matchesCombo(event, 'p')) {
      if (!event.repeat) openPlanning();
      return true;
    }
    if (matchesCombo(event, 'shift+o')) {
      if (!event.repeat) {
        haptic.tap();
        setOptionsOpen(true);
      }
      return true;
    }
    if (matchesCombo(event, 'shift+t')) {
      if (overdue.length > 0) {
        if (!event.repeat) moveOverdue();
        return true;
      }
      return false;
    }
    if (matchesCombo(event, 'r')) {
      if (!event.repeat) {
        void refresh();
        showToast('새로고침했습니다.');
      }
      return true;
    }
    return false;
  }, [twoPane, mainView, setView, openPlanning, overdue.length, moveOverdue, refresh]);

  const todayShortcutsEnabled = isFocused && !planning && !optionsOpen && !listSheets.scheduling && !listSheets.menu;

  useTaskShortcuts(cursor, {
    enabled: todayShortcutsEnabled && mainView === 'list',
    selecting: !!selectedIds,
    onToggleSelect: toggleSelect,
    onStartSelect: startSelect,
    onSchedule: listSheets.setScheduling,
    onOpenMenu: listSheets.setMenu,
    onAddSubtask: handleAddSubtask,
    onBefore: handleTodayKey,
  });

  useKeyHandler(handleTodayKey, {
    priority: KEY_PRIORITY.screen,
    enabled: todayShortcutsEnabled && mainView !== 'list',
  });

  const shareToday = () => {
    const names = new Map((projects ?? []).map((project) => [project.id, project.name]));
    const message = buildShareText({
      date, overdue, due,
      doneTitles: done.map(({ completion }) => completion.task.title),
      projectName: (id) => names.get(id),
      timeFormat: prefs.timeFormat,
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
    const prevPatch = snapshotSchedule(task);
    flow.reschedule(task, date, minutes);
    const label = formatTime(minutes, prefs.timeFormat);
    showToast(`‘${task.title}’${josa(task.title, '을/를')} ${label}${josa(label, '으로/로')} 옮겼습니다.`, {
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
  const showHabitsOnToday = hasHabits && prefs.todayHabitsPosition !== 'hidden';
  // The day bar: progress and planned/focused time, above the list and the timeline alike.
  const showFocusStrip = prefs.showTodayFocusStrip
    && (mainView === 'list' || mainView === 'timeline')
    && !isLoading
    && !showOnboarding
    && (remaining > 0 || done.length > 0 || todayFocusMinutes > 0);
  const showEveningWrapUp = nowHour >= 18 && remaining > 0 && !selectedIds;

  const allDoneCard = done.length > 0 ? (
    <View style={styles.allDoneCelebration}>
      {prefs.showAllDoneArt ? (
        <View style={{ marginBottom: space.xs }}>
          <AllDoneArt size={96} />
        </View>
      ) : (
        <Icon name="check-circle" size={24} color={colors.accentText} />
      )}
      <Txt variant="bodyStrong" style={{ textAlign: 'center' }}>
        오늘 할 일 {done.length}개를 모두 마쳤습니다
      </Txt>
      <Txt variant="small" tone="muted" style={{ textAlign: 'center' }}>
        수고하셨습니다. 다른 할 일도 살펴볼까요?
      </Txt>
      <View style={styles.allDoneActions}>
        <Pressable
          accessibilityRole="button" accessibilityLabel="추천 보기" hitSlop={8}
          onPress={() => openPlanning('suggest')}
          style={({ pressed }) => [styles.allDoneLink, { opacity: pressed ? 0.6 : 1 }]}>
          <Txt variant="smallStrong" tone="accent">추천 보기</Txt>
        </Pressable>
        <Txt variant="caption" tone="faint">·</Txt>
        <Pressable
          accessibilityRole="button" accessibilityLabel="주간 돌아보기" hitSlop={8}
          onPress={() => {
            haptic.tap();
            router.push(AI_ROUTES.review);
          }}
          style={({ pressed }) => [styles.allDoneLink, { opacity: pressed ? 0.6 : 1 }]}>
          <Txt variant="smallStrong" tone="muted">주간 돌아보기</Txt>
        </Pressable>
      </View>
    </View>
  ) : (
    <View style={styles.allDone}>
      <Icon name="check-circle" size={20} color={colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Txt variant="bodyStrong">오늘 남은 할 일이 없습니다</Txt>
      </View>
      <Pressable
        accessibilityRole="button" accessibilityLabel="할 일 추가" hitSlop={8}
        onPress={() => {
          haptic.tap();
          quickAdd.open({ dueToday: true });
        }}
        style={({ pressed }) => [styles.inlineAddPill, { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.65 : 1 }]}>
        <Icon name="plus" size={13} color={colors.accentText} />
        <Txt variant="smallStrong" tone="accent">할 일 추가</Txt>
      </Pressable>
    </View>
  );

  const mitSection = mitTasks.length > 0 ? (
    <View style={styles.focusSection}>
      <View style={styles.focusSectionHeader}>
        <Icon name="star" size={14} color={colors.textMuted} />
        <Txt variant="section" accessibilityRole="header">오늘의 핵심</Txt>
        <Txt variant="small" tone="faint" tabular>{mitTasks.length}/3</Txt>
      </View>
      <View style={[styles.sectionBorder, { borderTopColor: colors.border }]}>
        <TaskRows
          model={listModel} tasks={mitTasks} selectedIds={selectedIds} onToggleSelect={toggleSelect}
          focusedTaskId={cursor.focusedId} />
      </View>
    </View>
  ) : null;

  const eveningSection = eveningTasks.length > 0 ? (
    <View style={styles.focusSection}>
      <View style={styles.focusSectionHeader}>
        <Icon name="moon" size={14} color={colors.textMuted} />
        <Txt variant="section" tone="muted" accessibilityRole="header">오늘 저녁</Txt>
        <Txt variant="small" tone="faint" tabular>{eveningTasks.length}</Txt>
      </View>
      <View style={[styles.sectionBorder, { borderTopColor: colors.border }]}>
        <TaskRows
          model={listModel} tasks={eveningTasks} hideDate selectedIds={selectedIds} onToggleSelect={toggleSelect}
          focusedTaskId={cursor.focusedId} />
      </View>
    </View>
  ) : null;

  const eveningWrapUpFooter = showEveningWrapUp ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`남은 할 일 ${remaining}개 내일로 미루기`}
      onPress={deferRemainingToTomorrow}
      style={({ pressed }) => [
        styles.wrapUpFooter,
        { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
      ]}>
      <Icon name="moon" size={14} color={colors.textMuted} />
      <Txt variant="smallStrong" tone="muted" style={{ flex: 1 }}>남은 일 내일로 미루기</Txt>
      <Txt variant="caption" tone="faint" tabular>{remaining}개</Txt>
      <Icon name="arrow-right" size={14} color={colors.textFaint} />
    </Pressable>
  ) : null;

  const timeline = (
    <Timeline
      tasks={due} sessions={sessions ?? []} timeZone={timeZone} overdueCount={twoPane ? 0 : overdue.length}
      completedToday={done}
      onComplete={flow.complete} onAddAt={addAt} onRescheduleTime={rescheduleOnTimeline}
      onPlanOverdue={() => openPlanning('overdue')}
      onMoveOverdueToday={moveOverdue}
      keyboardActive={isFocused && mainView === 'timeline' && !planning && !optionsOpen} />
  );

  const hasCustomViewBar = mainView === 'list' && remaining > 0 && (grouping !== 'project' || sort !== 'schedule');

  return (
    <Screen maxWidth={twoPane ? PANE_FRAME_MAX : undefined}>
      <Header
        title="오늘"
        subtitle={[
          `${date.month}월 ${date.day}일 (${weekdayName(date)})`,
          // The day bar already shows done/total, so the subtitle keeps only what is left.
          showFocusStrip ? (remaining ? `${remaining}개 남음` : '') : summary,
        ].filter(Boolean).join(' · ')}
        right={(
          <View style={{ flexDirection: 'row' }}>
            <View style={{ position: 'relative' }}>
              <IconButton
                name="compass" label="하루 계획·일정 정리"
                onPress={() => openPlanning()}
                color={colors.textMuted} />
              {overdue.length > 0 ? (
                <View pointerEvents="none" style={[styles.headerBadgeDot, { backgroundColor: colors.danger }]} />
              ) : null}
            </View>
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

          {showFocusStrip ? (
            <View style={styles.dayBar}>
              <View style={styles.dayBarRow}>
                <Txt variant="smallStrong" tabular>{done.length}/{totalToday}</Txt>
                {plannedMinutes > 0 || todayFocusMinutes > 0 ? (
                  <Txt variant="caption" tone="muted" tabular numberOfLines={1} style={{ flexShrink: 1 }}>
                    {[
                      plannedMinutes > 0 ? `예정 ${formatDurationMinutes(plannedMinutes)}` : null,
                      todayFocusMinutes > 0 ? `집중 ${formatDurationMinutes(todayFocusMinutes)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </Txt>
                ) : null}
                <View style={{ flex: 1 }} />
                {focusTarget ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${focusTarget.title} 집중 시작`}
                    hitSlop={8}
                    onPress={() => startQuickFocus(focusTarget)}
                    style={({ pressed }) => [styles.focusStart, { opacity: pressed ? 0.6 : 1 }]}>
                    <Icon name="play" size={11} color={colors.accentText} />
                    <Txt variant="smallStrong" tone="accent">집중 시작</Txt>
                  </Pressable>
                ) : null}
              </View>
              <ProgressBar value={totalToday > 0 ? done.length / totalToday : 0} height={3} />
            </View>
          ) : null}

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
            <EisenhowerView
              roots={roots} subtaskProgress={subtaskProgress} refreshing={refreshing} onRefresh={refresh}
              keyboardActive={isFocused && mainView === 'matrix' && !planning && !optionsOpen} />
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
                  {showHabitsOnToday ? <TodayHabits /> : null}
                </View>
              ) : remaining === 0 && done.length === 0 && !showHabitsOnToday ? (
                <EmptyState
                  icon="sun" art={<EmptyToday size={EMPTY_ART} />} title="오늘 할 일이 없습니다"
                  message="할 일을 바로 추가하거나, 하루 계획에서 다른 할 일을 가져올 수 있습니다."
                  action={(
                    <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' }}>
                      <Button
                        label="+ 할 일 추가" kind="secondary"
                        onPress={() => quickAdd.open({ dueToday: true })} />
                      <Button
                        label="할 일 추천 보기" kind="ghost" icon="compass"
                        onPress={() => openPlanning('suggest')} />
                    </View>
                  )} />
              ) : grouped ? (
                <>
                  {overdue.length && grouping !== 'time' ? (
                    <OverdueBar count={overdue.length} onSpread={overdue.length >= 2 ? () => openPlanning('overdue') : undefined} onMoveToday={moveOverdue} />
                  ) : null}
                  {!selectedIds && prefs.todayHabitsPosition === 'top' ? <TodayHabits /> : null}
                  {mitSection}
                  {displayGroups.length ? (
                    <TodayGroups
                      groups={displayGroups} model={listModel} selectedIds={selectedIds} onToggleSelect={toggleSelect} onStartSelect={startSelect}
                      focusedTaskId={cursor.focusedId} todayIso={todayIso} />
                  ) : remaining === 0 ? (
                    allDoneCard
                  ) : null}
                  {eveningSection}
                  {eveningWrapUpFooter}
                  {!selectedIds && prefs.todayHabitsPosition === 'bottom' ? <TodayHabits /> : null}
                  {!selectedIds ? <DoneToday items={done} /> : null}
                </>
              ) : (
                <>
                  {!selectedIds && prefs.todayHabitsPosition === 'top' ? <TodayHabits /> : null}
                  {mitSection}
                  {restOverdue.length ? (
                    <>
                      <SectionTitle
                        title="기한 지남" count={restOverdue.length} tone="danger"
                        action={(
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                            {overdue.length >= 2 ? (
                              <Pressable
                                accessibilityRole="button" accessibilityLabel="여러 날에 나누어 배정하기" hitSlop={8}
                                onPress={() => openPlanning('overdue')}
                                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                                <Txt variant="smallStrong">일정 분산</Txt>
                              </Pressable>
                            ) : null}
                            <Pressable
                              accessibilityRole="button" accessibilityLabel="기한 지난 할 일 오늘로 옮기기" hitSlop={8} onPress={moveOverdue}
                              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                              <Txt variant="smallStrong" tone="muted">오늘로</Txt>
                            </Pressable>
                          </View>
                        )} />
                      <TaskRows
                        model={listModel} tasks={restOverdue} sortable={sort === 'manual'}
                        selectedIds={selectedIds} onToggleSelect={toggleSelect} focusedTaskId={cursor.focusedId} />
                    </>
                  ) : null}
                  {restDue.length ? (
                    <>
                      <SectionTitle
                        title="오늘" count={restDue.length}
                        action={sort !== 'schedule' ? <Txt variant="caption" tone="muted">{sortLabels[sort]}</Txt> : undefined} />
                      <TaskRows
                        model={listModel} tasks={restDue} hideDate sortable={sort === 'manual'}
                        selectedIds={selectedIds} onToggleSelect={toggleSelect} focusedTaskId={cursor.focusedId} />
                    </>
                  ) : remaining === 0 ? (
                    allDoneCard
                  ) : restOverdue.length > 0 && mitTasks.length === 0 && eveningTasks.length === 0 ? (
                    <Txt variant="small" tone="muted" style={{ padding: space.lg }}>오늘 예정된 할 일이 없습니다.</Txt>
                  ) : null}
                  {eveningSection}
                  {eveningWrapUpFooter}
                  {!selectedIds && prefs.todayHabitsPosition === 'bottom' ? <TodayHabits /> : null}
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
        visible={planning} onClose={() => setPlanning(false)} initialTab={planInitialTab}
        overdue={overdue} allOpen={tasks} openRoots={roots} subtaskProgress={subtaskProgress} />

      <TaskListSheets sheets={listSheets} onStartSelect={startSelect} />

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
                  {(['schedule', 'smart', 'priority', 'manual'] as TodaySort[]).map((option) => (
                    <Chip
                      key={option}
                      icon={option === 'schedule' ? 'calendar' : option === 'smart' ? 'zap' : option === 'priority' ? 'flag' : 'menu'}
                      label={sortLabels[option]}
                      selected={sort === option}
                      onPress={() => setSort(option)} />
                  ))}
                </View>
              </View>
              {hasHabits ? (
                <View style={{ gap: 6 }}>
                  <Txt variant="caption" tone="muted">오늘의 습관 위치</Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {TODAY_HABITS_POSITIONS.map((position) => (
                      <Chip
                        key={position}
                        icon={position === 'top' ? 'arrow-up' : position === 'bottom' ? 'arrow-down' : 'eye-off'}
                        label={habitPositionLabels[position]}
                        selected={prefs.todayHabitsPosition === position}
                        onPress={() => setPersonalPrefs({ todayHabitsPosition: position })} />
                    ))}
                  </View>
                </View>
              ) : null}
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
  headerBadgeDot: { position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 4 },
  dayBar: { paddingHorizontal: space.lg, paddingBottom: space.xs, gap: 6 },
  dayBarRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  focusStart: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 },
  focusSection: { marginTop: space.md },
  focusSectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, minHeight: 40,
  },
  sectionBorder: { borderTopWidth: StyleSheet.hairlineWidth },
  viewPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space.lg, paddingBottom: space.xs },
  guideBadge: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.lg },
  allDoneCelebration: {
    alignItems: 'center', gap: 6, paddingHorizontal: space.xl, paddingVertical: space.xl,
  },
  allDoneActions: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
  allDoneLink: { paddingVertical: 4, paddingHorizontal: 6 },
  inlineAddPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: space.md, minHeight: 34,
  },
  wrapUpFooter: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginTop: space.lg, paddingHorizontal: space.md, minHeight: 42,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
  },
});
