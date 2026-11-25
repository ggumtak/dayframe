import { type Href, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  type TextStyle,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconButton, type IconName, Txt } from '@/components/ui';
import { useProjects, useTagNames, useTaskIndex } from '@/data/tasks';
import { AI_ROUTES } from '@/features/ai/routes';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { TAB_ICONS, TAB_LABELS } from '@/features/settings/tabBar';
import { priorityMark } from '@/features/tasks/priority';
import { useTaskFlow } from '@/features/tasks/useTaskFlow';
import { formatDue, isPastDue } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { matchScore, searchTasks } from '@/lib/search';
import type { Task } from '@/lib/shared';
import { elevation, fontFamily, radius, space, type, useTheme } from '@/theme';

import { useInputCapture, useKeyboard, useKeyHandler } from './manager';
import { formatKeyLabel, matchesCombo, moveCursor } from './normalize';
import { type HardwareKeyEvent, KEY_PRIORITY } from './types';

const PALETTE_MAX_WIDTH = 540;
const MAX_TASK_RESULTS = 8;

type PaletteGroupId = 'quick' | 'navigate' | 'project' | 'tasks';

interface PaletteItem {
  id: string;
  group: PaletteGroupId;
  icon: IconName;
  label: string;
  detail?: string;
  detailTone?: 'muted' | 'danger';
  shortcut?: string;
  keywords?: readonly string[];
  keepKeyboard?: boolean;
  task?: Task;
  run: () => void;
}

type RenderRow =
  | { type: 'header'; key: string; title: string; count?: number }
  | { type: 'item'; key: string; item: PaletteItem; flatIndex: number };

const GROUP_TITLES: Record<PaletteGroupId, string> = {
  quick: '빠른 실행',
  navigate: '화면 이동',
  project: '목록에 할 일 추가',
  tasks: '할 일 바로 열기',
};

function scoreCommand(item: PaletteItem, rawQuery: string): number {
  const trimmed = rawQuery.trim();
  if (!trimmed) return 1;

  const fields = [item.label, item.detail ?? '', ...(item.keywords ?? [])].filter(Boolean);
  let directBest = 0;
  for (let i = 0; i < fields.length; i += 1) {
    const weight = i === 0 ? 1 : 0.7;
    directBest = Math.max(directBest, matchScore(fields[i], trimmed) * weight);
  }
  if (directBest > 0) return directBest;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return 0;

  let total = 0;
  for (const token of tokens) {
    let tokenBest = 0;
    for (let i = 0; i < fields.length; i += 1) {
      const weight = i === 0 ? 1 : 0.7;
      tokenBest = Math.max(tokenBest, matchScore(fields[i], token) * weight);
    }
    if (tokenBest <= 0) return 0;
    total += tokenBest;
  }
  return total / tokens.length;
}

function filterAndRank(items: readonly PaletteItem[], query: string): PaletteItem[] {
  if (!query.trim()) return [...items];
  const scored: { item: PaletteItem; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const score = scoreCommand(item, query);
    if (score > 0) scored.push({ item, score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((entry) => entry.item);
}

function KeycapBadge({ combo, active }: { combo: string; active: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.keycap,
        {
          backgroundColor: active ? colors.surface : colors.surfaceMuted,
          borderColor: colors.border,
        },
      ]}>
      <Text style={[type.caption as TextStyle, styles.keycapText, { color: active ? colors.accentText : colors.textMuted }]}>
        {formatKeyLabel(combo)}
      </Text>
    </View>
  );
}

function CommandPaletteOverlay() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { paletteOpen, closePalette, openHelp, blurActiveInput } = useKeyboard();
  const { data: projects } = useProjects();
  const { tasks } = useTaskIndex();
  const tagNames = useTagNames();
  const quickAdd = useQuickAdd();
  const flow = useTaskFlow();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<TextInputInstance>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const rowLayoutsRef = useRef<Map<string, { y: number; height: number }>>(new Map());
  const closedRef = useRef(false);

  const handleClose = useCallback(
    (dismissKeyboard = true) => {
      if (closedRef.current) return;
      closedRef.current = true;
      if (dismissKeyboard) {
        blurActiveInput();
        Keyboard.dismiss();
      }
      closePalette();
    },
    [blurActiveInput, closePalette],
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose(true);
      return true;
    });
    return () => subscription.remove();
  }, [handleClose]);

  useInputCapture({ tab: true, arrows: true, enabled: paletteOpen });

  const projectNames = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project.name])),
    [projects],
  );

  const navigateTab = useCallback((href: Href) => {
    router.navigate(href);
  }, []);

  const pushScreen = useCallback((href: Href) => {
    router.push(href);
  }, []);

  const quickCommands = useMemo<PaletteItem[]>(() => [
    {
      id: 'quick:new-task',
      group: 'quick',
      icon: 'plus',
      label: '새 할 일 추가',
      shortcut: 'q',
      keywords: ['추가', '할일', 'quick add', 'task', 'new'],
      keepKeyboard: true,
      run: () => quickAdd.open(),
    },
    {
      id: 'quick:new-habit',
      group: 'quick',
      icon: 'plus-circle',
      label: '새 습관 만들기',
      shortcut: 'shift+n',
      keywords: ['습관', '루틴', 'habit', 'new'],
      run: () => pushScreen('/habit/new'),
    },
    {
      id: 'quick:search',
      group: 'quick',
      icon: 'search',
      label: '검색 열기',
      shortcut: '/',
      keywords: ['찾기', '필터', 'search', 'find'],
      keepKeyboard: true,
      run: () => pushScreen('/search'),
    },
    {
      id: 'quick:ai-organize',
      group: 'quick',
      icon: 'edit-3',
      label: 'AI 메모 정리',
      keywords: ['ai', '비서', '메모', '정리', 'organize'],
      run: () => pushScreen(AI_ROUTES.organize),
    },
    {
      id: 'quick:ai-plan',
      group: 'quick',
      icon: 'clock',
      label: 'AI 하루 계획',
      keywords: ['ai', '비서', '계획', '일정', 'plan'],
      run: () => pushScreen(AI_ROUTES.plan),
    },
    {
      id: 'quick:ai-review',
      group: 'quick',
      icon: 'bar-chart-2',
      label: 'AI 주간 돌아보기',
      keywords: ['ai', '비서', '주간', '회고', '돌아보기', 'review'],
      run: () => pushScreen(AI_ROUTES.review),
    },
    {
      id: 'quick:help',
      group: 'quick',
      icon: 'command',
      label: '키보드 단축키 안내',
      shortcut: '?',
      keywords: ['단축키', '도움말', '키보드', 'shortcuts', 'help'],
      run: () => openHelp(),
    },
  ], [openHelp, pushScreen, quickAdd]);

  const navigationCommands = useMemo<PaletteItem[]>(() => [
    {
      id: 'nav:today',
      group: 'navigate',
      icon: TAB_ICONS.index,
      label: TAB_LABELS.index,
      shortcut: '1',
      keywords: ['today', '홈', '오늘 할 일'],
      run: () => navigateTab('/'),
    },
    {
      id: 'nav:inbox',
      group: 'navigate',
      icon: TAB_ICONS.inbox,
      label: TAB_LABELS.inbox,
      shortcut: '2',
      keywords: ['inbox', '프로젝트', '할 일 목록'],
      run: () => navigateTab('/inbox'),
    },
    {
      id: 'nav:upcoming',
      group: 'navigate',
      icon: TAB_ICONS.upcoming,
      label: TAB_LABELS.upcoming,
      shortcut: '3',
      keywords: ['upcoming', '달력', '일정', '캘린더'],
      run: () => navigateTab('/upcoming'),
    },
    {
      id: 'nav:habits',
      group: 'navigate',
      icon: TAB_ICONS.habits,
      label: TAB_LABELS.habits,
      shortcut: '4',
      keywords: ['habits', '루틴'],
      run: () => navigateTab('/habits'),
    },
    {
      id: 'nav:focus',
      group: 'navigate',
      icon: TAB_ICONS.focus,
      label: TAB_LABELS.focus,
      shortcut: '5',
      keywords: ['focus', '타이머', '뽀모도로', '스톱워치'],
      run: () => navigateTab('/focus'),
    },
    {
      id: 'nav:completed',
      group: 'navigate',
      icon: 'check-circle',
      label: '완료한 일',
      keywords: ['completed', '완료', '기록'],
      run: () => pushScreen('/completed'),
    },
    {
      id: 'nav:routines',
      group: 'navigate',
      icon: 'star',
      label: '습관 갤러리',
      keywords: ['routines', '추천 습관', '템플릿'],
      run: () => pushScreen('/routines'),
    },
    {
      id: 'nav:habit-overview',
      group: 'navigate',
      icon: 'grid',
      label: '습관 기록 한눈에 보기',
      keywords: ['habit overview', '주간', '월간', '통계'],
      run: () => pushScreen('/habit/overview'),
    },
    {
      id: 'nav:assistant',
      group: 'navigate',
      icon: 'zap',
      label: 'AI 비서',
      keywords: ['assistant', 'ai', '인공지능'],
      run: () => pushScreen(AI_ROUTES.hub),
    },
    {
      id: 'nav:settings',
      group: 'navigate',
      icon: 'settings',
      label: '설정',
      shortcut: ',',
      keywords: ['settings', '환경설정'],
      run: () => pushScreen('/settings'),
    },
    {
      id: 'nav:appearance',
      group: 'navigate',
      icon: 'droplet',
      label: '테마 설정',
      keywords: ['appearance', 'theme', '다크 모드', '라이트 모드', '강조색', '외관'],
      run: () => pushScreen('/appearance'),
    },
    {
      id: 'nav:tab-bar',
      group: 'navigate',
      icon: 'sidebar',
      label: '탭 바 설정',
      keywords: ['tab bar', '하단 탭', '탭 순서'],
      run: () => pushScreen('/tab-bar'),
    },
  ], [navigateTab, pushScreen]);

  const projectCommands = useMemo<PaletteItem[]>(() => (
    (projects ?? []).map((project) => ({
      id: `project:${project.id}`,
      group: 'project' as const,
      icon: 'hash' as const,
      label: `#${project.name}에 할 일 추가`,
      keywords: [project.name, `#${project.name}`, '목록', '추가'],
      keepKeyboard: true,
      run: () => quickAdd.open({ projectId: project.id }),
    }))
  ), [projects, quickAdd]);

  const taskCommands = useMemo<PaletteItem[]>(() => {
    if (!query.trim()) return [];
    const matched = searchTasks(tasks, query, { projectNames, tagNames }).slice(0, MAX_TASK_RESULTS);
    return matched.map((task) => {
      const projectName = task.project_id ? projectNames.get(task.project_id) : undefined;
      const due = formatDue(task);
      const priority = task.priority < 4 ? priorityMark(task.priority) : '';
      const metaParts = [
        priority,
        projectName ? `#${projectName}` : '',
        due ?? '',
      ].filter(Boolean);
      const overdue = isPastDue(task);
      return {
        id: `task:${task.id}`,
        group: 'tasks' as const,
        icon: 'circle' as const,
        label: task.title,
        detail: metaParts.length > 0 ? metaParts.join(' · ') : undefined,
        detailTone: overdue ? 'danger' : 'muted',
        task,
        run: () => router.push({ pathname: '/task/[id]', params: { id: task.id } }),
      };
    });
  }, [projectNames, query, tagNames, tasks]);

  const { flatItems, renderRows } = useMemo(() => {
    const groups: { id: PaletteGroupId; items: PaletteItem[] }[] = [
      { id: 'quick', items: filterAndRank(quickCommands, query) },
      { id: 'navigate', items: filterAndRank(navigationCommands, query) },
      { id: 'project', items: filterAndRank(projectCommands, query) },
      { id: 'tasks', items: taskCommands },
    ];

    const flat: PaletteItem[] = [];
    const rows: RenderRow[] = [];

    for (const group of groups) {
      if (group.items.length === 0) continue;
      rows.push({
        type: 'header',
        key: `header:${group.id}`,
        title: GROUP_TITLES[group.id],
        count: group.id === 'tasks' ? group.items.length : undefined,
      });
      for (const item of group.items) {
        const flatIndex = flat.length;
        flat.push(item);
        rows.push({ type: 'item', key: item.id, item, flatIndex });
      }
    }

    return { flatItems: flat, renderRows: rows };
  }, [navigationCommands, projectCommands, query, quickCommands, taskCommands]);

  const safeIndex = flatItems.length === 0 ? -1 : Math.max(0, Math.min(selectedIndex, flatItems.length - 1));
  const activeItemId = safeIndex >= 0 ? flatItems[safeIndex]?.id : undefined;

  useEffect(() => {
    if (safeIndex < 0 || !activeItemId) return;
    if (safeIndex === 0) {
      scrollYRef.current = 0;
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    const rect = rowLayoutsRef.current.get(activeItemId);
    const viewportHeight = viewportHeightRef.current;
    if (!rect || viewportHeight <= 0) return;

    const margin = space.sm;
    const topEdge = rect.y - margin;
    const bottomEdge = rect.y + rect.height + margin;
    if (topEdge < scrollYRef.current) {
      const nextY = Math.max(0, topEdge);
      scrollYRef.current = nextY;
      scrollRef.current?.scrollTo({ y: nextY, animated: true });
    } else if (bottomEdge > scrollYRef.current + viewportHeight) {
      const nextY = Math.max(0, bottomEdge - viewportHeight);
      scrollYRef.current = nextY;
      scrollRef.current?.scrollTo({ y: nextY, animated: true });
    }
  }, [activeItemId, safeIndex]);

  const executeItem = useCallback(
    (item: PaletteItem) => {
      if (closedRef.current) return;
      haptic.tap();
      handleClose(!item.keepKeyboard);
      item.run();
    },
    [handleClose],
  );

  const completeTaskItem = useCallback(
    (item: PaletteItem) => {
      if (!item.task || closedRef.current) return;
      haptic.success();
      flow.complete(item.task);
      handleClose(true);
    },
    [flow, handleClose],
  );

  const moveSelection = useCallback(
    (delta: -1 | 1) => {
      if (flatItems.length === 0) return;
      setSelectedIndex((current) => {
        const clamped = Math.max(0, Math.min(current, flatItems.length - 1));
        const next = moveCursor(clamped, delta, flatItems.length);
        return next < 0 ? 0 : next;
      });
    },
    [flatItems.length],
  );

  const handleKey = useCallback(
    (event: HardwareKeyEvent): boolean => {
      if (matchesCombo(event, 'escape') || matchesCombo(event, 'mod+k')) {
        handleClose(true);
        return true;
      }
      if (matchesCombo(event, 'arrowdown') || matchesCombo(event, 'ctrl+j') || matchesCombo(event, 'tab')) {
        moveSelection(1);
        return true;
      }
      if (matchesCombo(event, 'arrowup') || matchesCombo(event, 'shift+tab')) {
        moveSelection(-1);
        return true;
      }
      if (matchesCombo(event, 'shift+enter')) {
        const activeItem = safeIndex >= 0 ? flatItems[safeIndex] : undefined;
        if (activeItem?.task) {
          completeTaskItem(activeItem);
        }
        return true;
      }
      if (matchesCombo(event, 'enter') || matchesCombo(event, 'mod+enter')) {
        const activeItem = safeIndex >= 0 ? flatItems[safeIndex] : undefined;
        if (activeItem) {
          executeItem(activeItem);
        } else {
          handleClose(true);
        }
        return true;
      }
      if (!event.editing) {
        return true;
      }
      return false;
    },
    [completeTaskItem, executeItem, flatItems, handleClose, moveSelection, safeIndex],
  );

  useKeyHandler(handleKey, { priority: KEY_PRIORITY.palette, enabled: paletteOpen });

  const handleQueryChange = useCallback((next: string) => {
    setQuery(next);
    setSelectedIndex(0);
  }, []);

  const handleSubmitEditing = useCallback(() => {
    const activeItem = safeIndex >= 0 ? flatItems[safeIndex] : undefined;
    if (activeItem) executeItem(activeItem);
  }, [executeItem, flatItems, safeIndex]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    viewportHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} pointerEvents="box-none" accessibilityViewIsModal>
      <Animated.View entering={FadeIn.duration(140)} style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="커맨드 팔레트 닫기"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={() => handleClose(true)} />
      </Animated.View>

      <KeyboardAvoidingView
        behavior="padding"
        style={[
          styles.avoiding,
          {
            paddingTop: Math.max(insets.top + space.lg, 48),
            paddingBottom: Math.max(insets.bottom, space.md),
          },
        ]}
        pointerEvents="box-none">
        <Animated.View
          entering={FadeInDown.duration(160)}
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
            elevation(colors, 2),
          ]}>
          <View style={[styles.searchRow, { borderBottomColor: colors.border }]}>
            <Icon name="search" size={18} color={colors.textMuted} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={handleQueryChange}
              onSubmitEditing={handleSubmitEditing}
              autoFocus
              autoCorrect={false}
              returnKeyType="go"
              placeholder="명령, 화면, 목록, 할 일 검색 (초성 지원)"
              placeholderTextColor={colors.textFaint}
              accessibilityLabel="커맨드 팔레트 검색"
              style={[
                styles.input,
                { color: colors.text },
                Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
              ]} />
            {query.length > 0 ? (
              <IconButton
                name="x"
                label="검색어 지우기"
                size={18}
                color={colors.textMuted}
                onPress={() => {
                  handleQueryChange('');
                  inputRef.current?.focus();
                }}
                style={styles.clearButton} />
            ) : (
              <View style={[styles.keycap, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
                <Text style={[type.caption as TextStyle, styles.keycapText, { color: colors.textMuted }]}>
                  {formatKeyLabel('escape')}
                </Text>
              </View>
            )}
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            onScroll={handleScroll}
            onLayout={handleViewportLayout}
            scrollEventThrottle={16}>
            {renderRows.length === 0 ? (
              <View style={styles.empty}>
                <Icon name="search" size={22} color={colors.textFaint} />
                <Txt variant="bodyStrong">일치하는 명령이나 할 일이 없습니다</Txt>
                <Txt variant="small" tone="muted">다른 검색어나 초성으로 다시 찾아보세요</Txt>
              </View>
            ) : (
              renderRows.map((row) => {
                if (row.type === 'header') {
                  return (
                    <View key={row.key} style={styles.groupHeader}>
                      <Txt variant="caption" tone="faint" style={styles.groupTitle} accessibilityRole="header">
                        {row.title}
                      </Txt>
                      {row.count !== undefined ? (
                        <Txt variant="caption" tone="faint">{row.count}</Txt>
                      ) : null}
                    </View>
                  );
                }

                const { item, flatIndex } = row;
                const active = flatIndex === safeIndex;

                return (
                  <Pressable
                    key={row.key}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: active }}
                    onPress={() => executeItem(item)}
                    onLayout={(event) => {
                      const { y, height } = event.nativeEvent.layout;
                      rowLayoutsRef.current.set(item.id, { y, height });
                    }}
                    style={({ pressed }) => [
                      styles.itemRow,
                      {
                        backgroundColor: active ? colors.accentSoft : pressed ? colors.surfaceMuted : 'transparent',
                        borderLeftColor: active ? colors.accent : 'transparent',
                      },
                    ]}>
                    <Icon
                      name={item.icon}
                      size={17}
                      color={active ? colors.accentText : colors.textMuted} />
                    <View style={styles.itemBody}>
                      <Text
                        numberOfLines={1}
                        style={[
                          (active ? type.bodyStrong : type.body) as TextStyle,
                          { color: colors.text },
                        ]}>
                        {item.label}
                      </Text>
                      {item.detail ? (
                        <Txt
                          variant="caption"
                          tone={item.detailTone === 'danger' ? 'danger' : 'muted'}
                          numberOfLines={1}>
                          {item.detail}
                        </Txt>
                      ) : null}
                    </View>
                    {item.shortcut ? (
                      <KeycapBadge combo={item.shortcut} active={active} />
                    ) : item.task && active ? (
                      <KeycapBadge combo="shift+enter" active />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={[styles.footer, { backgroundColor: colors.surfaceMuted, borderTopColor: colors.border }]}>
            <Txt variant="caption" tone="muted" numberOfLines={1}>
              ↑↓ 이동 · Enter 실행 · Shift+Enter 할 일 완료 · Esc 닫기
            </Txt>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

export function CommandPalette() {
  const { paletteOpen } = useKeyboard();
  if (!paletteOpen) return null;
  return <CommandPaletteOverlay />;
}

const styles = StyleSheet.create({
  root: {
    zIndex: 95,
  },
  avoiding: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: PALETTE_MAX_WIDTH,
    maxHeight: '100%',
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
    flexShrink: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    fontFamily,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 12,
  },
  clearButton: {
    width: 32,
    height: 32,
  },
  list: {
    flexShrink: 1,
    maxHeight: 420,
  },
  listContent: {
    paddingBottom: space.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  groupTitle: {
    fontWeight: '700',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 46,
    paddingLeft: space.md - 3,
    paddingRight: space.md,
    paddingVertical: space.sm,
    borderLeftWidth: 3,
  },
  itemBody: {
    flex: 1,
    gap: 2,
  },
  keycap: {
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  keycapText: {
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
  },
  footer: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
});
