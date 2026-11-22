import { useSegments } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, type TextInputInstance, View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, Icon, type IconName, Txt } from '@/components/ui';
import { nextPosition, useProjects, useTags, useTaskActions, useTaskIndex } from '@/data/tasks';
import { describeRecurrence, deviceTimeZone, formatDue, instantFor, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { analyzeTask, type Priority, type TaskAnalysis } from '@/lib/shared';
import { elevation, priorityColor, radius, space, useTheme } from '@/theme';

import { HighlightInput, type PillPalette } from './HighlightInput';
import { parseErrorMessage } from './messages';
import { activeMention, applyMention, applyPriority, applyScheduleWord, matchNames, removeTokens } from './suggest';

export const TAB_BAR_HEIGHT = 58;

/** Where a new task lands unless the text says otherwise. */
export interface QuickAddDefaults {
  parentTaskId?: string;
  projectId?: string | null;
  /** Date new tasks get when no date is typed. */
  dueToday?: boolean;
  /** Text to start from, such as a time picked on the timeline. */
  initialText?: string;
}

interface QuickAddValue {
  open: (defaults?: QuickAddDefaults) => void;
  /** Lets the focused screen set defaults for the floating button. */
  setScreenDefaults: (defaults: QuickAddDefaults | null) => void;
}

const QuickAddContext = createContext<QuickAddValue>({ open: () => {}, setScreenDefaults: () => {} });
export const useQuickAdd = () => useContext(QuickAddContext);

const inserts: { label: string; text: string; icon: IconName; kind?: 'date' | 'recurrence' | 'priority' }[] = [
  { label: '오늘', text: '오늘', icon: 'sun', kind: 'date' },
  { label: '내일', text: '내일', icon: 'sunrise', kind: 'date' },
  { label: '매일', text: '매일', icon: 'repeat', kind: 'recurrence' },
  { label: '프로젝트', text: '#', icon: 'hash' },
  { label: '태그', text: '@', icon: 'tag' },
  { label: '우선순위', text: 'p1', icon: 'flag', kind: 'priority' },
];
const priorities: Priority[] = [1, 2, 3, 4];

function QuickAddSheet({ defaults, onClose }: { defaults: QuickAddDefaults; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const input = useRef<TextInputInstance>(null);
  const [text, setText] = useState(defaults.initialText ?? '');
  const [added, setAdded] = useState(0);
  const [pickingPriority, setPickingPriority] = useState(false);
  const { tasks, byId } = useTaskIndex();
  const { data: projects } = useProjects();
  const { data: tags } = useTags();
  const actions = useTaskActions();
  const timezone = deviceTimeZone();
  const parent = defaults.parentTaskId ? byId.get(defaults.parentTaskId) : undefined;

  const result = useMemo<{ analysis?: TaskAnalysis; error?: string | null }>(() => {
    if (!text.trim()) return {};
    try {
      return { analysis: analyzeTask({ text, timezone }, { draft: true }) };
    } catch (error) {
      return { error: parseErrorMessage(error) };
    }
  }, [text, timezone]);
  const { analysis } = result;
  // The schedule is marked as soon as it is typed, but there is nothing to add until a title follows.
  const parsed = analysis?.task.title ? analysis.task : undefined;
  const draft = analysis?.task;

  // Prefilled words such as "11월 24일 " are a start: typing continues after them, not before.
  useEffect(() => {
    const length = defaults.initialText?.length ?? 0;
    if (!length) return;
    const timer = setTimeout(() => {
      // Native inputs have setSelection; on the web the element is a plain <textarea>.
      const field = input.current as unknown as { setSelection?: (a: number, b: number) => void; setSelectionRange?: (a: number, b: number) => void } | null;
      if (typeof field?.setSelection === 'function') field.setSelection(length, length);
      else field?.setSelectionRange?.(length, length);
    }, 60);
    return () => clearTimeout(timer);
  }, [defaults.initialText]);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => back.remove();
  }, [onClose]);

  const palette: PillPalette = {
    schedule: { background: colors.accentSoft, foreground: colors.accent },
    project: { background: colors.accentSoft, foreground: colors.accent },
    tag: { background: colors.accentSoft, foreground: colors.accent },
    priority: { background: colors.warningSoft, foreground: colors.warning },
  };

  const submit = () => {
    if (!parsed) {
      haptic.warning();
      return;
    }
    const fallbackToday = !parsed.due_at && defaults.dueToday && !parent;
    const due_at = fallbackToday ? instantFor(today(timezone), null, timezone) : parsed.due_at;
    const projectId = parent || parsed.project ? null : defaults.projectId ?? null;
    const siblings = tasks.filter((task) => (parent
      ? task.parent_task_id === parent.id
      : !task.parent_task_id && task.project_id === projectId));
    actions.create({
      input: {
        title: parsed.title, priority: parsed.priority, timezone, position: nextPosition(siblings),
        ...(due_at ? { due_at, all_day: fallbackToday ? true : parsed.all_day } : {}),
        ...(parsed.recurrence_rule ? { recurrence_rule: parsed.recurrence_rule } : {}),
        ...(parsed.recurrence_local_time ? { recurrence_local_time: parsed.recurrence_local_time } : {}),
        ...(parent ? { parent_task_id: parent.id } : projectId ? { project_id: projectId } : {}),
      },
      projectName: parent ? null : parsed.project,
      tagNames: parsed.tags,
    });
    haptic.success();
    setText('');
    setAdded((count) => count + 1);
    input.current?.focus();
  };

  const tokens = analysis && analysis.text === text ? analysis.tokens : [];
  const mention = useMemo(() => activeMention(text), [text]);
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const pool = mention.kind === 'project' ? (projects ?? []).map((item) => item.name) : (tags ?? []).map((item) => item.name);
    return matchNames(pool, mention.query);
  }, [mention, projects, tags]);

  const insert = (item: (typeof inserts)[number]) => {
    haptic.tap();
    if (item.kind === 'priority') {
      setPickingPriority((open) => !open);
      input.current?.focus();
      return;
    }
    setPickingPriority(false);
    if (item.kind === 'date' || item.kind === 'recurrence') {
      const scheduleKind = item.kind;
      setText((current) => applyScheduleWord(current, item.text, scheduleKind, tokens));
    } else {
      setText((current) => (current && !/\s$/.test(current) ? current + ' ' : current) + item.text);
    }
    input.current?.focus();
  };

  const pickPriority = (priority: Priority) => {
    haptic.tap();
    setText((current) => applyPriority(current, priority, tokens));
    setPickingPriority(false);
    input.current?.focus();
  };

  const pickSuggestion = (name: string) => {
    if (!mention) return;
    haptic.tap();
    setText((current) => applyMention(current, mention, name));
    input.current?.focus();
  };

  const stripToken = (predicate: (token: (typeof tokens)[number]) => boolean) => {
    haptic.tap();
    setText((current) => removeTokens(current, tokens, predicate));
    input.current?.focus();
  };

  const due = draft?.due_at ? formatDue({ due_at: draft.due_at, timezone, all_day: draft.all_day }) : null;
  const repeat = describeRecurrence(draft?.recurrence_rule ?? null);
  const isNewProject = !!draft?.project
    && !projects?.some((project) => project.name.toLowerCase() === draft.project!.toLowerCase());
  const defaultProject = !draft?.project && defaults.projectId
    ? projects?.find((project) => project.id === defaults.projectId)?.name : undefined;
  const hasChips = !!draft && (due || repeat || draft.project || draft.tags.length > 0 || draft.priority < 4);

  return (
    <KeyboardAvoidingView behavior="padding" style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityLabel="빠른 추가 닫기" style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }} />
      </Animated.View>
      <View style={{ flex: 1 }} pointerEvents="none" />
      <Animated.View
        entering={FadeInDown.duration(180)}
        style={[styles.bar, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, space.md) }, elevation(colors, 2)]}>
        {parent ? (
          <Txt variant="caption" tone="muted" numberOfLines={1} style={{ marginBottom: 6 }}>
            하위 작업 · {parent.title}
          </Txt>
        ) : null}
        <HighlightInput
          ref={input} value={text} onChangeText={setText} tokens={tokens}
          palette={palette} autoFocus onSubmitEditing={submit}
          placeholder={parent ? '하위 작업 추가' : '예: 내일 저녁 7시 운동 #건강 p2'}
          accessibilityLabel="할 일 입력" />
        {result.error ? (
          <Txt variant="small" tone="danger" style={{ marginTop: 6 }} accessibilityLiveRegion="polite">{result.error}</Txt>
        ) : null}
        {suggestions.length > 0 && mention ? (
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
            contentContainerStyle={{ gap: 6, paddingTop: space.sm }}>
            {suggestions.map((name) => (
              <Pressable
                key={name} accessibilityRole="button" accessibilityLabel={(mention.kind === 'project' ? '프로젝트 ' : '태그 ') + name}
                onPress={() => pickSuggestion(name)}
                style={({ pressed }) => [styles.suggestion, { backgroundColor: colors.accentSoft, opacity: pressed ? 0.6 : 1 }]}>
                <Icon name={mention.kind === 'project' ? 'hash' : 'tag'} size={12} color={colors.accent} />
                <Txt variant="smallStrong" tone="accent">{name}</Txt>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {pickingPriority ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: space.sm }}>
            {priorities.map((priority) => {
              const active = (draft?.priority ?? 4) === priority;
              const tint = priorityColor(colors, priority);
              return (
                <Pressable
                  key={priority} accessibilityRole="button" accessibilityLabel={'우선순위 ' + priority}
                  onPress={() => pickPriority(priority)}
                  style={({ pressed }) => [styles.insert, {
                    flex: 1, justifyContent: 'center', borderColor: active ? tint : colors.border,
                    backgroundColor: active ? colors.surfaceMuted : 'transparent', opacity: pressed ? 0.6 : 1,
                  }]}>
                  <Icon name="flag" size={13} color={tint} />
                  <Txt variant="smallStrong" style={{ color: active ? colors.text : colors.textMuted }}>P{priority}</Txt>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {hasChips || defaultProject || (defaults.dueToday && !parent && !due) ? (
          <View style={styles.chips}>
            {due ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip
                  icon="calendar" label={due + ' ×'} color={colors.schedule}
                  onPress={() => stripToken((token) => token.kind === 'date' || token.kind === 'time')} />
              </Animated.View>
            ) : defaults.dueToday && !parent ? <Chip icon="calendar" label="오늘" /> : null}
            {repeat ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip icon="repeat" label={repeat + ' ×'} color={colors.schedule} onPress={() => stripToken((token) => token.kind === 'recurrence')} />
              </Animated.View>
            ) : null}
            {draft?.project ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip
                  icon="hash" label={draft.project + (isNewProject ? ' · 새 프로젝트' : '') + ' ×'} color={colors.accent}
                  onPress={() => stripToken((token) => token.kind === 'project')} />
              </Animated.View>
            ) : defaultProject ? <Chip icon="hash" label={defaultProject} /> : null}
            {draft?.tags.map((tag) => (
              <Animated.View key={tag} entering={ZoomIn.duration(140)}>
                <Chip
                  icon="tag" label={tag + ' ×'} color={colors.accent}
                  onPress={() => stripToken((token) => token.kind === 'tag' && token.text.replace(/^@"?|"?$/g, '').toLowerCase() === tag.toLowerCase())} />
              </Animated.View>
            ))}
            {draft && draft.priority < 4 ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip
                  icon="flag" label={'P' + draft.priority + ' ×'} color={priorityColor(colors, draft.priority)}
                  onPress={() => stripToken((token) => token.kind === 'priority')} />
              </Animated.View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.tools}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
            {inserts.map((item) => {
              const active = item.kind === 'priority' && pickingPriority;
              return (
                <Pressable
                  key={item.label} accessibilityRole="button" accessibilityLabel={item.label + ' 넣기'} onPress={() => insert(item)}
                  style={({ pressed }) => [styles.insert, {
                    borderColor: active ? colors.accent : colors.border,
                    backgroundColor: active ? colors.accentSoft : 'transparent', opacity: pressed ? 0.6 : 1,
                  }]}>
                  <Icon name={item.icon} size={13} color={active ? colors.accent : colors.textMuted} />
                  <Txt variant="small" tone={active ? 'accent' : 'muted'}>{item.label}</Txt>
                </Pressable>
              );
            })}
          </ScrollView>
          {added > 0 ? (
            <Animated.View key={added} entering={ZoomIn.duration(160)} exiting={FadeOut.duration(400)}>
              <Txt variant="small" tone="success">{added}개 추가됨</Txt>
            </Animated.View>
          ) : null}
          <Pressable
            accessibilityRole="button" accessibilityLabel="할 일 추가" accessibilityState={{ disabled: !parsed }} onPress={submit}
            style={({ pressed }) => [styles.send, { backgroundColor: parsed ? colors.accent : colors.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}>
            <Icon name="arrow-up" size={20} color={parsed ? colors.onAccent : colors.textFaint} />
          </Pressable>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

/** Hosts the floating add button on every signed-in screen and the entry bar it opens. */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const segments: string[] = useSegments();
  const [active, setActive] = useState<QuickAddDefaults | null>(null);
  const screenDefaults = useRef<QuickAddDefaults | null>(null);

  const value = useMemo<QuickAddValue>(() => ({
    open: (defaults) => setActive(defaults ?? screenDefaults.current ?? {}),
    setScreenDefaults: (defaults) => { screenDefaults.current = defaults; },
  }), []);
  const close = useCallback(() => setActive(null), []);

  // Detail and settings screens add in their own way; every tab keeps the button.
  const showButton = segments[0] === '(tabs)';

  return (
    <QuickAddContext.Provider value={value}>
      {children}
      {showButton && !active ? (
        <Animated.View
          entering={ZoomIn.duration(160)} pointerEvents="box-none"
          style={[styles.fabWrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + space.lg }]}>
          <Pressable
            accessibilityRole="button" accessibilityLabel="할 일 빠른 추가"
            onPress={() => {
              haptic.light();
              value.open();
            }}
            style={({ pressed }) => [styles.fab, { backgroundColor: colors.accent, transform: [{ scale: pressed ? 0.94 : 1 }] }, elevation(colors, 2)]}>
            <Icon name="plus" size={26} color={colors.onAccent} />
          </Pressable>
        </Animated.View>
      ) : null}
      {active ? <QuickAddSheet defaults={active} onClose={close} /> : null}
    </QuickAddContext.Provider>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.lg,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  insert: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, height: 30,
  },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.sm, paddingHorizontal: 10, height: 30,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  fabWrap: { position: 'absolute', right: space.lg },
  fab: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
});
