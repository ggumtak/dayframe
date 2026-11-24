import { router, useSegments } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, type TextInputInstance, View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, Icon, IconButton, type IconName, Txt } from '@/components/ui';
import { useNewTaskDate } from '@/data/session';
import { AI_ROUTES } from '@/features/ai/routes';
import { nextPosition, useProjects, useSections, useTags, useTaskActions, useTaskIndex } from '@/data/tasks';
import { describeRecurrence, deviceTimeZone, formatDue, formatDurationMinutes, instantFor, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { usePersistentState } from '@/lib/persist';
import { analyzeTask, type Priority, type TaskAnalysis } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { elevation, priorityColor, radius, space, type, useTheme } from '@/theme';

import { HighlightInput, type PillPalette } from './HighlightInput';
import { parseErrorMessage } from './messages';
import { activeMention, applyMention, applyPriority, applyScheduleWord, matchNames, parseChecklistLines, removeTokens } from './suggest';

export const TAB_BAR_HEIGHT = 58;

/** Where a new task lands unless the text says otherwise. */
export interface QuickAddDefaults {
  parentTaskId?: string;
  projectId?: string | null;
  sectionId?: string | null;
  /** Date new tasks get when no date is typed. */
  dueToday?: boolean;
  /** Text to start from, such as a time picked on the timeline. */
  initialText?: string;
}

interface QuickAddValue {
  open: (defaults?: QuickAddDefaults) => void;
  /** Lets the focused screen set defaults for the floating button. */
  setScreenDefaults: (defaults: QuickAddDefaults | null) => void;
  /** Temporarily hides the floating + button while another bottom bar (e.g. BatchBar) or focus timer is active. */
  setFabHidden: (hidden: boolean) => void;
  fabHidden: boolean;
}

const QuickAddContext = createContext<QuickAddValue>({ open: () => {}, setScreenDefaults: () => {}, setFabHidden: () => {}, fabHidden: false });
export const useQuickAdd = () => useContext(QuickAddContext);

type KeepOpen = 'on' | 'off';
const isKeepOpen = (value: string): value is KeepOpen => value === 'on' || value === 'off';

const inserts: {
  label: string; text: string; icon: IconName; kind?: 'date' | 'time' | 'duration' | 'recurrence' | 'priority' | 'notes' | 'plain';
}[] = [
  { label: '오늘', text: '오늘', icon: 'sun', kind: 'date' },
  { label: '내일', text: '내일', icon: 'sunrise', kind: 'date' },
  { label: '주말', text: '이번 주말', icon: 'coffee', kind: 'date' },
  { label: '오전 9시', text: '오전 9시', icon: 'clock', kind: 'time' },
  { label: '저녁 7시', text: '저녁 7시', icon: 'moon', kind: 'time' },
  { label: '30분간', text: '30분간', icon: 'watch', kind: 'duration' },
  { label: '매일', text: '매일', icon: 'repeat', kind: 'recurrence' },
  { label: '완료 후 반복', text: '매일!', icon: 'check-circle', kind: 'recurrence' },
  { label: '목록', text: '#', icon: 'hash' },
  { label: '태그', text: '@', icon: 'tag' },
  { label: '우선순위', text: 'p1', icon: 'flag', kind: 'priority' },
  { label: '메모', text: '', icon: 'align-left', kind: 'notes' },
  { label: '원문 유지', text: '', icon: 'type', kind: 'plain' },
];
const priorities: Priority[] = [1, 2, 3, 4];

function QuickAddSheet({ defaults, onClose }: { defaults: QuickAddDefaults; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const input = useRef<TextInputInstance>(null);
  const [text, setText] = useState(defaults.initialText ?? '');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [plainText, setPlainText] = useState(false);
  const [added, setAdded] = useState(0);
  const [pickingPriority, setPickingPriority] = useState(false);
  // Tapping the default 오늘 chip leaves only the next task added from this sheet undated.
  const [undated, setUndated] = useState(false);
  const [keepOpen, setKeepOpen] = usePersistentState<KeepOpen>('dayframe-quickadd-keepopen', 'off', isKeepOpen);
  const [newTaskDate] = useNewTaskDate();
  const { tasks, byId } = useTaskIndex();
  const { data: projects } = useProjects();
  const { data: sections } = useSections();
  const { data: tags } = useTags();
  const actions = useTaskActions();
  const timezone = deviceTimeZone();
  const parent = defaults.parentTaskId ? byId.get(defaults.parentTaskId) : undefined;
  // Undated tasks land on today when added from 오늘, or anywhere when the user chose that in settings (Todoist's
  // Today view works the same). A subtask follows its parent instead.
  const defaultsToToday = !parent && (!!defaults.dueToday || newTaskDate === 'today');

  const multiLines = useMemo(() => (text.includes('\n') ? parseChecklistLines(text) : []), [text]);
  const isMultiLine = multiLines.length >= 2;

  const result = useMemo<{ analysis?: TaskAnalysis; error?: string | null }>(() => {
    if (!text.trim() || isMultiLine || plainText) return {};
    try {
      return { analysis: analyzeTask({ text, timezone }, { draft: true }) };
    } catch (error) {
      return { error: parseErrorMessage(error) };
    }
  }, [text, timezone, isMultiLine, plainText]);
  const { analysis } = result;
  // The schedule is marked as soon as it is typed, but there is nothing to add until a title follows.
  const parsed = plainText ? undefined : (analysis?.task.title ? analysis.task : undefined);
  const draft = plainText ? undefined : analysis?.task;

  // Prefilled words such as "11월 24일 " are a start: typing continues after them, not before.
  useEffect(() => {
    const length = defaults.initialText?.length ?? 0;
    if (!length) return;
    const timer = setTimeout(() => {
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

  const closeSheet = () => {
    Keyboard.dismiss();
    onClose();
  };

  const createSingleLine = (rawLine: string, positionOffset: number, extraNotes?: string | null, overrideParentId?: string) => {
    const targetParentId = overrideParentId ?? parent?.id;
    let parsedLine: ReturnType<typeof analyzeTask>['task'] | null = null;
    if (!plainText) {
      try {
        const res = analyzeTask({ text: rawLine, timezone });
        if (res.task.title) parsedLine = res.task;
      } catch {
        // Fall back to plain title when line contains non-schedule text.
      }
    }
    const fallbackToday = !parsedLine?.due_at && !targetParentId && defaultsToToday && !undated;
    const due_at = fallbackToday ? instantFor(today(timezone), null, timezone) : parsedLine?.due_at ?? null;
    const projectId = targetParentId || parsedLine?.project ? null : defaults.projectId ?? null;
    const sectionId = !targetParentId && !parsedLine?.project && projectId && projectId === defaults.projectId
      ? defaults.sectionId ?? null : null;
    const siblings = tasks.filter((task) => (targetParentId
      ? task.parent_task_id === targetParentId
      : !task.parent_task_id && task.project_id === projectId));
    return actions.create({
      input: {
        title: parsedLine?.title ?? rawLine,
        notes: extraNotes ?? null,
        priority: parsedLine?.priority ?? 4,
        timezone,
        position: nextPosition(siblings) + positionOffset * 1024,
        ...(due_at ? { due_at, all_day: fallbackToday ? true : (parsedLine?.all_day ?? true) } : {}),
        ...(parsedLine?.recurrence_rule ? { recurrence_rule: parsedLine.recurrence_rule, recurrence_mode: parsedLine.recurrence_mode } : {}),
        ...(parsedLine?.recurrence_local_time ? { recurrence_local_time: parsedLine.recurrence_local_time } : {}),
        ...(parsedLine?.duration_minutes ? { duration_minutes: parsedLine.duration_minutes } : {}),
        ...(targetParentId ? { parent_task_id: targetParentId } : {
          ...(projectId ? { project_id: projectId } : {}),
          ...(sectionId ? { section_id: sectionId } : {}),
        }),
      },
      projectName: targetParentId ? null : (parsedLine?.project ?? null),
      tagNames: parsedLine?.tags ?? [],
    });
  };

  const afterSubmit = (countAdded: number, toastMessage?: string) => {
    haptic.success();
    setText('');
    setNotes('');
    setShowNotes(false);
    setPlainText(false);
    setUndated(false);
    if (toastMessage) showToast(toastMessage);
    if (keepOpen === 'on') {
      setAdded((count) => count + countAdded);
      input.current?.focus();
    } else {
      closeSheet();
    }
  };

  const submitMultiSeparate = () => {
    multiLines.forEach((line, index) => {
      createSingleLine(line, index);
    });
    afterSubmit(multiLines.length, `${multiLines.length}개 할 일을 한 번에 추가했습니다.`);
  };

  const submitMultiAsChecklist = () => {
    if (multiLines.length < 2) return;
    const [head, ...rest] = multiLines;
    const parentId = createSingleLine(head, 0, notes.trim() ? notes : null);
    rest.forEach((line, index) => {
      createSingleLine(line, index, null, parentId);
    });
    afterSubmit(1, `‘${head}’${josa(head, '와/과')} 하위 작업 ${rest.length}개를 추가했습니다.`);
  };

  const submit = () => {
    if (isMultiLine) {
      submitMultiSeparate();
      return;
    }
    const plainTitle = plainText ? text.trim() : '';
    if (!parsed && !plainTitle) {
      haptic.warning();
      return;
    }
    const title = plainTitle || parsed!.title;
    const fallbackToday = !(parsed?.due_at) && defaultsToToday && !undated;
    const due_at = fallbackToday ? instantFor(today(timezone), null, timezone) : parsed?.due_at ?? null;
    const projectId = parent || parsed?.project ? null : defaults.projectId ?? null;
    const sectionId = !parent && !parsed?.project && projectId && projectId === defaults.projectId
      ? defaults.sectionId ?? null : null;
    const siblings = tasks.filter((task) => (parent
      ? task.parent_task_id === parent.id
      : !task.parent_task_id && task.project_id === projectId));
    actions.create({
      input: {
        title,
        notes: notes.trim() ? notes : null,
        priority: parsed?.priority ?? 4,
        timezone,
        position: nextPosition(siblings),
        ...(due_at ? { due_at, all_day: fallbackToday ? true : (parsed?.all_day ?? true) } : {}),
        ...(parsed?.recurrence_rule ? { recurrence_rule: parsed.recurrence_rule, recurrence_mode: parsed.recurrence_mode } : {}),
        ...(parsed?.recurrence_local_time ? { recurrence_local_time: parsed.recurrence_local_time } : {}),
        ...(parsed?.duration_minutes ? { duration_minutes: parsed.duration_minutes } : {}),
        ...(parent ? { parent_task_id: parent.id } : {
          ...(projectId ? { project_id: projectId } : {}),
          ...(sectionId ? { section_id: sectionId } : {}),
        }),
      },
      projectName: parent ? null : (parsed?.project ?? null),
      tagNames: parsed?.tags ?? [],
    });
    afterSubmit(1, keepOpen === 'on' ? undefined : `‘${title}’${josa(title, '을/를')} 추가했습니다.`);
  };

  const tokens = !plainText && analysis && analysis.text === text ? analysis.tokens : [];
  const mention = useMemo(() => (isMultiLine || plainText ? null : activeMention(text)), [text, isMultiLine, plainText]);
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const pool = mention.kind === 'project' ? (projects ?? []).map((item) => item.name) : (tags ?? []).map((item) => item.name);
    return matchNames(pool, mention.query);
  }, [mention, projects, tags]);

  const insert = (item: (typeof inserts)[number]) => {
    haptic.tap();
    if (item.kind === 'priority') {
      setPlainText(false);
      setPickingPriority((open) => !open);
      input.current?.focus();
      return;
    }
    if (item.kind === 'notes') {
      setShowNotes((open) => !open);
      return;
    }
    if (item.kind === 'plain') {
      setPlainText((on) => !on);
      setPickingPriority(false);
      input.current?.focus();
      return;
    }
    setPlainText(false);
    setPickingPriority(false);
    if (item.kind === 'date' || item.kind === 'time' || item.kind === 'duration' || item.kind === 'recurrence') {
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
  const repeat = describeRecurrence(draft?.recurrence_rule ?? null, draft?.recurrence_mode);
  const durationLabel = draft?.duration_minutes ? formatDurationMinutes(draft.duration_minutes) : null;
  const isNewProject = !!draft?.project
    && !projects?.some((project) => project.name.toLowerCase() === draft.project!.toLowerCase());
  const defaultProject = !draft?.project && defaults.projectId
    ? projects?.find((project) => project.id === defaults.projectId)?.name : undefined;
  const defaultSection = !draft?.project && defaults.sectionId
    ? sections?.find((section) => section.id === defaults.sectionId)?.name : undefined;
  const hasChips = !!draft && (due || durationLabel || repeat || draft.project || draft.tags.length > 0 || draft.priority < 4);
  const canSend = (plainText ? !!text.trim() : !!parsed) || isMultiLine;

  return (
    <KeyboardAvoidingView behavior="padding" style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityLabel="빠른 추가 닫기" style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={closeSheet} />
      </Animated.View>
      <View style={{ flex: 1 }} pointerEvents="none" />
      <Animated.View
        entering={FadeInDown.duration(180)}
        style={[styles.bar, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, space.md) }, elevation(colors, 2)]}>
        <View style={styles.topRow}>
          <Txt variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {parent
              ? `하위 작업 · ${parent.title}`
              : defaultSection && defaultProject
                ? `#${defaultProject} · ${defaultSection}`
                : defaultProject
                  ? `#${defaultProject}`
                  : '새 할 일'}
          </Txt>
          <Pressable
            accessibilityRole="switch" accessibilityState={{ checked: keepOpen === 'on' }}
            accessibilityLabel="연속 입력 모드"
            onPress={() => {
              haptic.tap();
              setKeepOpen(keepOpen === 'on' ? 'off' : 'on');
            }}
            style={({ pressed }) => [
              styles.keepPill,
              {
                backgroundColor: keepOpen === 'on' ? colors.accentSoft : colors.surfaceMuted,
                opacity: pressed ? 0.65 : 1,
              },
            ]}>
            <Icon name="layers" size={12} color={keepOpen === 'on' ? colors.accent : colors.textMuted} />
            <Txt variant="caption" tone={keepOpen === 'on' ? 'accent' : 'muted'} style={{ fontWeight: '600' }}>연속</Txt>
          </Pressable>
          {parent ? null : (
            // A long or messy note is easier to hand to 메모 정리; whatever is typed goes along.
            <Pressable
              accessibilityRole="button" accessibilityLabel="AI로 정리"
              onPress={() => {
                haptic.tap();
                const memo = text.trim();
                closeSheet();
                router.push({ pathname: AI_ROUTES.organize, params: memo ? { text: memo } : {} });
              }}
              style={({ pressed }) => [styles.keepPill, { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.65 : 1 }]}>
              <Icon name="zap" size={12} color={colors.textMuted} />
              <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>AI로 정리</Txt>
            </Pressable>
          )}
          <IconButton name="x" label="닫기" size={18} color={colors.textMuted} onPress={closeSheet} style={{ width: 32, height: 32 }} />
        </View>

        <HighlightInput
          ref={input} value={text} onChangeText={setText} tokens={tokens}
          palette={palette} disableHighlight={plainText} autoFocus onSubmitEditing={submit}
          placeholder={parent ? '하위 작업 추가 (여러 줄 붙여넣기 가능)' : '예: 내일 3시 30분간 회의, 완료 후 3일마다 필터 교체'}
          accessibilityLabel="할 일 입력" />
        {showNotes ? (
          <TextInput
            value={notes} onChangeText={setNotes} multiline maxLength={10000}
            placeholder="메모, 링크, 세부 내용..." placeholderTextColor={colors.textFaint} accessibilityLabel="메모"
            style={[type.small, styles.notesInput, { backgroundColor: colors.surfaceMuted, color: colors.text }]} />
        ) : null}
        {plainText ? (
          <View style={[styles.plainHint, { backgroundColor: colors.surfaceMuted }]}>
            <Icon name="type" size={13} color={colors.accent} />
            <Txt variant="caption" tone="muted" style={{ flex: 1 }}>원문 유지 켜짐 · 날짜나 태그를 읽지 않고 적은 그대로 저장합니다</Txt>
            <Pressable hitSlop={8} onPress={() => setPlainText(false)}>
              <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>해제</Txt>
            </Pressable>
          </View>
        ) : null}
        {isMultiLine ? (
          <View style={[styles.multiBox, { backgroundColor: colors.accentSoft }]}>
            <Txt variant="caption" tone="accent" style={{ fontWeight: '700' }}>
              {multiLines.length}줄을 한 번에 추가할 수 있습니다
            </Txt>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <Chip icon="layers" label={`${multiLines.length}개 할 일로 추가`} selected onPress={submitMultiSeparate} />
              {!parent ? (
                <Chip icon="git-merge" label={`체크리스트(하위 ${multiLines.length - 1}개)로 추가`} onPress={submitMultiAsChecklist} />
              ) : null}
            </View>
          </View>
        ) : null}
        {result.error ? (
          <Txt variant="small" tone="danger" style={{ marginTop: 6 }} accessibilityLiveRegion="polite">{result.error}</Txt>
        ) : null}
        {suggestions.length > 0 && mention ? (
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
            contentContainerStyle={{ gap: 6, paddingTop: space.sm }}>
            {suggestions.map((name) => (
              <Pressable
                key={name} accessibilityRole="button" accessibilityLabel={(mention.kind === 'project' ? '목록 ' : '태그 ') + name}
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
        {!isMultiLine && (hasChips || defaultProject || (defaultsToToday && !due)) ? (
          <View style={styles.chips}>
            {due ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip
                  icon="calendar" label={due + ' ×'} color={colors.schedule}
                  onPress={() => stripToken((token) => token.kind === 'date' || token.kind === 'time')} />
              </Animated.View>
            ) : defaultsToToday ? (
              <Chip
                icon={undated ? 'slash' : 'calendar'} label={undated ? '날짜 없음' : '오늘 ×'}
                color={undated ? undefined : colors.schedule}
                onPress={() => {
                  setUndated((current) => !current);
                  input.current?.focus();
                }} />
            ) : null}
            {durationLabel ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip icon="clock" label={durationLabel + ' ×'} color={colors.schedule} onPress={() => stripToken((token) => token.kind === 'duration')} />
              </Animated.View>
            ) : null}
            {repeat ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip icon="repeat" label={repeat + ' ×'} color={colors.schedule} onPress={() => stripToken((token) => token.kind === 'recurrence')} />
              </Animated.View>
            ) : null}
            {draft?.project ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip
                  icon="hash" label={draft.project + (isNewProject ? ' · 새 목록' : '') + ' ×'} color={colors.accent}
                  onPress={() => stripToken((token) => token.kind === 'project')} />
              </Animated.View>
            ) : defaultProject ? <Chip icon="hash" label={defaultSection ? `${defaultProject} · ${defaultSection}` : defaultProject} /> : null}
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
              const active = (item.kind === 'priority' && pickingPriority)
                || (item.kind === 'notes' && (showNotes || !!notes.trim()))
                || (item.kind === 'plain' && plainText);
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
            accessibilityRole="button" accessibilityLabel="할 일 추가" accessibilityState={{ disabled: !canSend }} onPress={submit}
            style={({ pressed }) => [styles.send, { backgroundColor: canSend ? colors.accent : colors.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}>
            <Icon name="arrow-up" size={20} color={canSend ? colors.onAccent : colors.textFaint} />
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
  const [fabHidden, setFabHidden] = useState(false);
  const screenDefaults = useRef<QuickAddDefaults | null>(null);

  const value = useMemo<QuickAddValue>(() => ({
    open: (defaults) => setActive(defaults ?? screenDefaults.current ?? {}),
    setScreenDefaults: (defaults) => { screenDefaults.current = defaults; },
    setFabHidden: (hidden) => setFabHidden(hidden),
    fabHidden,
  }), [fabHidden]);
  const close = useCallback(() => setActive(null), []);

  // Detail and settings screens add in their own way; every tab keeps the button unless a bottom batch bar or focus run is open.
  const showButton = segments[0] === '(tabs)' && !fabHidden;
  // On the habits tab the button makes a habit, as in TickTick; everywhere else it adds a task.
  const onHabits = showButton && segments[1] === 'habits';

  return (
    <QuickAddContext.Provider value={value}>
      {children}
      {showButton && !active ? (
        <Animated.View
          entering={ZoomIn.duration(160)} pointerEvents="box-none"
          style={[styles.fabWrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + space.lg }]}>
          <Pressable
            accessibilityRole="button" accessibilityLabel={onHabits ? '습관 추가' : '할 일 빠른 추가'}
            onPress={() => {
              haptic.light();
              if (onHabits) router.push('/habit/new');
              else value.open();
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
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: space.md,
  },
  topRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 4,
  },
  keepPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, height: 26, borderRadius: radius.pill,
  },
  notesInput: {
    marginTop: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8,
    minHeight: 40, maxHeight: 84, textAlignVertical: 'top',
  },
  plainHint: {
    marginTop: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 7,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  multiBox: {
    marginTop: space.sm, borderRadius: radius.md, padding: space.md, gap: space.sm,
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
