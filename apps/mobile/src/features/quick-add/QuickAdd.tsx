import { router, useSegments } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, type StyleProp, StyleSheet,
  TextInput, type TextInputInstance, View, type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Chip, Icon, IconButton, type IconName, Txt } from '@/components/ui';
import { useNewTaskDate } from '@/data/session';
import { nextPosition, useProjects, useSections, useTags, useTaskActions, useTaskIndex } from '@/data/tasks';
import { AI_ROUTES } from '@/features/ai/routes';
import {
  KEY_PRIORITY, matchesCombo, moveCursor, useInputCapture, useKeyboard, useKeyHandler, useScreenContext,
} from '@/features/keyboard';
import { DAY_MINUTES, leadLabel, type TaskReminder } from '@/features/reminders/lead';
import { setTaskReminder } from '@/features/reminders/overrides';
import { priorityA11y, priorityLabel, priorityMark, priorityOption } from '@/features/tasks/priority';
import {
  describeRecurrence, deviceTimeZone, dueDate, formatDue, formatDurationMinutes, instantFor, type PlainDate,
  type Temporal, today,
} from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { useLayout } from '@/lib/layoutContext';
import { datePhrase } from '@/lib/occurrences';
import { usePersistentState } from '@/lib/persist';
import { analyzeTask, type Priority, type TaskAnalysis } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { elevation, radius, space, type, useTheme } from '@/theme';

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
  setScreenDefaults: (defaults: QuickAddDefaults | null) => void;
  setFabHidden: (hidden: boolean) => void;
  fabHidden: boolean;
}

const QuickAddContext = createContext<QuickAddValue>({ open: () => {}, setScreenDefaults: () => {}, setFabHidden: () => {}, fabHidden: false });
export const useQuickAdd = () => useContext(QuickAddContext);

type KeepOpen = 'on' | 'off';
const isKeepOpen = (value: string): value is KeepOpen => value === 'on' || value === 'off';

type ToolKind = 'calendar' | 'date' | 'time' | 'duration' | 'recurrence' | 'priority' | 'reminder' | 'notes' | 'plain';
const baseInserts: { label: string; text: string; icon: IconName; kind?: ToolKind; androidOnly?: boolean }[] = [
  { label: '달력', text: '', icon: 'calendar', kind: 'calendar' },
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
  { label: '알림', text: '', icon: 'bell', kind: 'reminder', androidOnly: true },
  { label: '메모', text: '', icon: 'align-left', kind: 'notes' },
  { label: '그대로 저장', text: '', icon: 'type', kind: 'plain' },
];

function insertA11yLabel(item: (typeof baseInserts)[number]): string {
  switch (item.kind) {
    case 'calendar': return '달력 열기';
    case 'priority': return '우선순위 선택';
    case 'reminder': return '알림 설정';
    case 'notes': return '메모 입력';
    case 'plain': return '그대로 저장 전환';
    default: return item.label + ' 넣기';
  }
}

const priorities: Priority[] = [1, 2, 3, 4];
const timedQuickReminders: { value: TaskReminder | undefined; label: string }[] = [
  { value: undefined, label: '기본' },
  { value: 0, label: '정시' },
  { value: 5, label: '5분 전' },
  { value: 10, label: '10분 전' },
  { value: 30, label: '30분 전' },
  { value: 60, label: '1시간 전' },
  { value: DAY_MINUTES, label: '하루 전' },
  { value: 'off', label: '알림 끔' },
];
const allDayQuickReminders: { value: TaskReminder | undefined; label: string }[] = [
  { value: undefined, label: '기본' },
  { value: 0, label: '당일' },
  { value: DAY_MINUTES, label: '하루 전' },
  { value: 2 * DAY_MINUTES, label: '2일 전' },
  { value: 'off', label: '알림 끔' },
];

function normalizeReminderForMode(choice: TaskReminder | undefined, timed: boolean): TaskReminder | undefined {
  if (!timed && typeof choice === 'number' && choice > 0 && choice < DAY_MINUTES) return 0;
  return choice;
}

function formatReminderChip(choice: TaskReminder | undefined, timed: boolean): string | null {
  const normalized = normalizeReminderForMode(choice, timed);
  if (normalized === undefined) return null;
  if (normalized === 'off') return '알림 끔';
  if (!timed) {
    if (normalized === 0) return '당일 알림';
    if (normalized === DAY_MINUTES) return '하루 전 알림';
    return `${Math.floor(normalized / DAY_MINUTES)}일 전 알림`;
  }
  if (normalized === 0) return '정시 알림';
  if (normalized === DAY_MINUTES) return '하루 전 알림';
  return leadLabel(normalized);
}

function analyzeDraft(text: string, timezone: string, isMultiLine: boolean, plainText: boolean): { analysis?: TaskAnalysis; error?: string | null } {
  if (!text.trim() || isMultiLine || plainText) return {};
  try {
    return { analysis: analyzeTask({ text, timezone }, { draft: true }) };
  } catch (error) {
    return { error: parseErrorMessage(error) };
  }
}

function QuickAddSheet({ defaults, frame, onClose }: {
  defaults: QuickAddDefaults;
  frame: StyleProp<ViewStyle>;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { keyboardMode, blurActiveInput } = useKeyboard();
  useScreenContext('quick-add');
  const input = useRef<TextInputInstance>(null);
  const notesInput = useRef<TextInputInstance>(null);
  const notesFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [text, setText] = useState(defaults.initialText ?? '');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [plainText, setPlainText] = useState(false);
  const [added, setAdded] = useState(0);
  const [openPane, setOpenPane] = useState<null | 'priority' | 'calendar' | 'reminder'>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [calendarCursor, setCalendarCursor] = useState<PlainDate | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Temporal.PlainYearMonth | null>(null);
  const [chosenSectionId, setChosenSectionId] = useState<string | null | undefined>(defaults.sectionId);
  const [reminderChoice, setReminderChoice] = useState<TaskReminder | undefined>(undefined);
  const [undated, setUndated] = useState(false);
  const [keepOpen, setKeepOpen] = usePersistentState<KeepOpen>('dayframe-quickadd-keepopen', 'off', isKeepOpen);
  const [newTaskDate] = useNewTaskDate();
  const { tasks, byId } = useTaskIndex();
  const { data: projects } = useProjects();
  const { data: sections } = useSections();
  const { data: tags } = useTags();
  const actions = useTaskActions();
  const [timezone] = useState(deviceTimeZone);
  const parent = defaults.parentTaskId ? byId.get(defaults.parentTaskId) : undefined;
  const defaultsToToday = !parent && (!!defaults.dueToday || newTaskDate === 'today');

  const inserts = useMemo(
    () => baseInserts.filter((item) => !item.androidOnly || Platform.OS === 'android'),
    [],
  );

  const multiLines = useMemo(() => (text.includes('\n') ? parseChecklistLines(text) : []), [text]);
  const isMultiLine = multiLines.length >= 2;

  const result = useMemo(
    () => analyzeDraft(text, timezone, isMultiLine, plainText),
    [text, timezone, isMultiLine, plainText],
  );
  const { analysis } = result;
  const parsed = plainText ? undefined : (analysis?.task.title ? analysis.task : undefined);
  const draft = plainText ? undefined : analysis?.task;
  const draftProject = draft?.project;
  const todayDate = useMemo(() => today(timezone), [timezone]);
  const draftPlainDate = draft?.due_at ? dueDate({ due_at: draft.due_at, timezone }) : (defaultsToToday && !undated ? todayDate : null);

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

  useEffect(() => () => {
    if (notesFocusTimer.current) {
      clearTimeout(notesFocusTimer.current);
      notesFocusTimer.current = null;
    }
  }, []);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => back.remove();
  }, [onClose]);

  const recognised = { background: colors.accentSoft, foreground: colors.accentText };
  const palette: PillPalette = { schedule: recognised, project: recognised, tag: recognised, priority: recognised };

  const closePane = () => {
    setOpenPane(null);
    setCalendarCursor(null);
    setCalendarMonth(null);
  };

  const closeSheet = () => {
    blurActiveInput();
    Keyboard.dismiss();
    onClose();
  };

  // Resolve the effective project (typed #project match or default screen project) so its sections can be chosen inline.
  const activeProject = useMemo(() => {
    if (parent) return undefined;
    if (draftProject) {
      return projects?.find((p) => p.name.toLowerCase() === draftProject.toLowerCase());
    }
    if (defaults.projectId) {
      return projects?.find((p) => p.id === defaults.projectId);
    }
    return undefined;
  }, [parent, draftProject, defaults.projectId, projects]);

  const availableSections = useMemo(
    () => (activeProject ? (sections ?? []).filter((s) => s.project_id === activeProject.id).sort((a, b) => a.position - b.position) : []),
    [activeProject, sections],
  );
  const effectiveSectionId = availableSections.some((s) => s.id === chosenSectionId) ? (chosenSectionId ?? null) : null;

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
    const due_at = fallbackToday ? instantFor(todayDate, null, timezone) : parsedLine?.due_at ?? null;
    const lineAllDay = fallbackToday ? true : (parsedLine?.all_day ?? true);
    const lineTimed = !!due_at && !lineAllDay;
    const matchedProj = parsedLine?.project ? projects?.find((p) => p.name.toLowerCase() === parsedLine!.project!.toLowerCase()) : undefined;
    const projectId = targetParentId ? null : (matchedProj ? matchedProj.id : (parsedLine?.project ? null : defaults.projectId ?? null));
    const sectionId = !targetParentId && projectId && projectId === activeProject?.id ? effectiveSectionId : null;
    const siblings = tasks.filter((task) => (targetParentId
      ? task.parent_task_id === targetParentId
      : !task.parent_task_id && task.project_id === projectId));
    const id = actions.create({
      input: {
        title: parsedLine?.title ?? rawLine,
        notes: extraNotes ?? null,
        priority: parsedLine?.priority ?? 4,
        timezone,
        position: nextPosition(siblings) + positionOffset * 1024,
        ...(due_at ? { due_at, all_day: lineAllDay } : {}),
        ...(parsedLine?.recurrence_rule ? { recurrence_rule: parsedLine.recurrence_rule, recurrence_mode: parsedLine.recurrence_mode } : {}),
        ...(parsedLine?.recurrence_local_time ? { recurrence_local_time: parsedLine.recurrence_local_time } : {}),
        ...(parsedLine?.duration_minutes ? { duration_minutes: parsedLine.duration_minutes } : {}),
        ...(targetParentId ? { parent_task_id: targetParentId } : {
          ...(projectId ? { project_id: projectId } : {}),
          ...(sectionId ? { section_id: sectionId } : {}),
        }),
      },
      projectName: targetParentId || matchedProj ? null : (parsedLine?.project ?? null),
      tagNames: parsedLine?.tags ?? [],
    });
    const lineReminder = normalizeReminderForMode(reminderChoice, lineTimed);
    if (lineReminder !== undefined && !overrideParentId) {
      setTaskReminder(id, lineReminder);
    }
    return id;
  };

  const afterSubmit = (countAdded: number, toastMessage?: string) => {
    haptic.success();
    setText('');
    setNotes('');
    setShowNotes(false);
    setPlainText(false);
    setUndated(false);
    closePane();
    setSuggestionIndex(0);
    setChosenSectionId(defaults.sectionId);
    setReminderChoice(undefined);
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
    afterSubmit(multiLines.length, `할 일 ${multiLines.length}개를 추가했습니다.`);
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
    const due_at = fallbackToday ? instantFor(todayDate, null, timezone) : parsed?.due_at ?? null;
    const allDay = fallbackToday ? true : (parsed?.all_day ?? true);
    const isTimed = !!due_at && !allDay;
    const matchedProj = parsed?.project ? projects?.find((p) => p.name.toLowerCase() === parsed.project!.toLowerCase()) : undefined;
    const projectId = parent ? null : (matchedProj ? matchedProj.id : (parsed?.project ? null : defaults.projectId ?? null));
    const sectionId = !parent && projectId && projectId === activeProject?.id ? effectiveSectionId : null;
    const siblings = tasks.filter((task) => (parent
      ? task.parent_task_id === parent.id
      : !task.parent_task_id && task.project_id === projectId));
    const createdId = actions.create({
      input: {
        title,
        notes: notes.trim() ? notes : null,
        priority: parsed?.priority ?? 4,
        timezone,
        position: nextPosition(siblings),
        ...(due_at ? { due_at, all_day: allDay } : {}),
        ...(parsed?.recurrence_rule ? { recurrence_rule: parsed.recurrence_rule, recurrence_mode: parsed.recurrence_mode } : {}),
        ...(parsed?.recurrence_local_time ? { recurrence_local_time: parsed.recurrence_local_time } : {}),
        ...(parsed?.duration_minutes ? { duration_minutes: parsed.duration_minutes } : {}),
        ...(parent ? { parent_task_id: parent.id } : {
          ...(projectId ? { project_id: projectId } : {}),
          ...(sectionId ? { section_id: sectionId } : {}),
        }),
      },
      projectName: parent || matchedProj ? null : (parsed?.project ?? null),
      tagNames: parsed?.tags ?? [],
    });
    const savedReminder = normalizeReminderForMode(reminderChoice, isTimed);
    if (savedReminder !== undefined) {
      setTaskReminder(createdId, savedReminder);
    }
    afterSubmit(1, keepOpen === 'on' ? undefined : `‘${title}’${josa(title, '을/를')} 추가했습니다.`);
  };

  const tokens = !plainText && analysis && analysis.text === text ? analysis.tokens : [];
  const mention = useMemo(() => (isMultiLine || plainText ? null : activeMention(text)), [text, isMultiLine, plainText]);
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const pool = mention.kind === 'project' ? (projects ?? []).map((item) => item.name) : (tags ?? []).map((item) => item.name);
    return matchNames(pool, mention.query);
  }, [mention, projects, tags]);
  const mentionKey = mention ? `${mention.kind}:${mention.query}` : '';
  const [lastMentionKey, setLastMentionKey] = useState(mentionKey);
  if (mentionKey !== lastMentionKey) {
    setLastMentionKey(mentionKey);
    setSuggestionIndex(0);
  }
  const activeSuggestion = suggestions.length ? Math.min(suggestionIndex, suggestions.length - 1) : -1;

  const applyPickedDate = (pickedDate: PlainDate | null) => {
    haptic.tap();
    setPlainText(false);
    closePane();
    if (pickedDate === null) {
      setText((current) => removeTokens(current, tokens, (t) => t.kind === 'date' || t.kind === 'time'));
      setUndated(true);
    } else {
      setUndated(false);
      const phrase = datePhrase(pickedDate, todayDate);
      setText((current) => applyScheduleWord(current, phrase, 'date', tokens));
    }
    input.current?.focus();
  };

  const toggleCalendarPane = () => {
    setPlainText(false);
    if (openPane === 'calendar') {
      closePane();
      input.current?.focus();
      return;
    }
    const initialDate = draftPlainDate ?? todayDate;
    setCalendarCursor(initialDate);
    setCalendarMonth(initialDate.toPlainYearMonth());
    setOpenPane('calendar');
    blurActiveInput();
    input.current?.blur();
    notesInput.current?.blur();
  };

  const moveCalendarCursor = (days: number) => {
    const base = calendarCursor ?? draftPlainDate ?? todayDate;
    const next = days < 0 ? base.subtract({ days: -days }) : base.add({ days });
    setCalendarCursor(next);
    setCalendarMonth(next.toPlainYearMonth());
  };

  const toggleNotes = () => {
    if (openPane === 'calendar') closePane();
    const next = !showNotes;
    setShowNotes(next);
    if (notesFocusTimer.current) {
      clearTimeout(notesFocusTimer.current);
      notesFocusTimer.current = null;
    }
    if (next) {
      notesFocusTimer.current = setTimeout(() => {
        notesFocusTimer.current = null;
        notesInput.current?.focus();
      }, 40);
    } else {
      input.current?.focus();
    }
  };

  const openAiOrganize = () => {
    haptic.tap();
    const memo = text.trim();
    closeSheet();
    router.push({ pathname: AI_ROUTES.organize, params: memo ? { text: memo } : {} });
  };

  const insert = (item: (typeof baseInserts)[number]) => {
    haptic.tap();
    if (item.kind === 'calendar') {
      toggleCalendarPane();
      return;
    }
    if (item.kind === 'priority') {
      setPlainText(false);
      setCalendarCursor(null);
      setCalendarMonth(null);
      setOpenPane((cur) => (cur === 'priority' ? null : 'priority'));
      input.current?.focus();
      return;
    }
    if (item.kind === 'reminder') {
      setCalendarCursor(null);
      setCalendarMonth(null);
      setOpenPane((cur) => (cur === 'reminder' ? null : 'reminder'));
      return;
    }
    if (item.kind === 'notes') {
      toggleNotes();
      return;
    }
    if (item.kind === 'plain') {
      setPlainText((on) => !on);
      closePane();
      input.current?.focus();
      return;
    }
    setPlainText(false);
    closePane();
    if (item.kind === 'date' || item.kind === 'time' || item.kind === 'duration' || item.kind === 'recurrence') {
      if (item.kind === 'date') setUndated(false);
      const scheduleKind = item.kind;
      setText((current) => applyScheduleWord(current, item.text, scheduleKind, tokens));
    } else {
      setText((current) => (current && !/\s$/.test(current) ? current + ' ' : current) + item.text);
    }
    input.current?.focus();
  };

  const pickPriority = (priority: Priority) => {
    haptic.tap();
    setPlainText(false);
    setText((current) => applyPriority(current, priority, tokens));
    closePane();
    input.current?.focus();
  };

  const pickSuggestion = (name: string) => {
    if (!mention) return;
    haptic.tap();
    setText((current) => applyMention(current, mention, name));
    setSuggestionIndex(0);
    input.current?.focus();
  };

  const stripToken = (predicate: (token: (typeof tokens)[number]) => boolean) => {
    haptic.tap();
    setText((current) => removeTokens(current, tokens, predicate));
    input.current?.focus();
  };

  useInputCapture({
    tab: suggestions.length > 0,
    arrows: suggestions.length > 0 || openPane === 'calendar',
    enabled: true,
  });

  useKeyHandler((event) => {
    if (matchesCombo(event, 'escape')) {
      if (openPane !== null) {
        closePane();
        input.current?.focus();
      } else {
        closeSheet();
      }
      return true;
    }
    if (matchesCombo(event, 'mod+shift+enter')) {
      if (isMultiLine && !parent) submitMultiAsChecklist();
      else submit();
      return true;
    }
    if (matchesCombo(event, 'mod+enter')) {
      submit();
      return true;
    }
    if (openPane === 'calendar') {
      if (matchesCombo(event, 'arrowleft')) {
        moveCalendarCursor(-1);
        return true;
      }
      if (matchesCombo(event, 'arrowright')) {
        moveCalendarCursor(1);
        return true;
      }
      if (matchesCombo(event, 'arrowup')) {
        moveCalendarCursor(-7);
        return true;
      }
      if (matchesCombo(event, 'arrowdown')) {
        moveCalendarCursor(7);
        return true;
      }
      if (!event.editing && matchesCombo(event, 'enter')) {
        applyPickedDate(calendarCursor ?? draftPlainDate ?? todayDate);
        return true;
      }
    }
    if (openPane !== 'calendar' && suggestions.length > 0) {
      if (matchesCombo(event, 'arrowdown') || matchesCombo(event, 'ctrl+j')) {
        const next = moveCursor(activeSuggestion, 1, suggestions.length);
        if (next >= 0) setSuggestionIndex(next);
        return true;
      }
      if (matchesCombo(event, 'arrowup')) {
        const next = moveCursor(activeSuggestion, -1, suggestions.length);
        if (next >= 0) setSuggestionIndex(next);
        return true;
      }
      if (matchesCombo(event, 'tab')) {
        const picked = suggestions[activeSuggestion >= 0 ? activeSuggestion : 0];
        if (picked) pickSuggestion(picked);
        return true;
      }
    }
    if (matchesCombo(event, 'alt+1')) { pickPriority(1); return true; }
    if (matchesCombo(event, 'alt+2')) { pickPriority(2); return true; }
    if (matchesCombo(event, 'alt+3')) { pickPriority(3); return true; }
    if (matchesCombo(event, 'alt+4')) { pickPriority(4); return true; }
    if (matchesCombo(event, 'alt+d')) {
      haptic.tap();
      toggleCalendarPane();
      return true;
    }
    if (matchesCombo(event, 'alt+p')) {
      haptic.tap();
      setPlainText(false);
      setCalendarCursor(null);
      setCalendarMonth(null);
      setOpenPane((cur) => (cur === 'priority' ? null : 'priority'));
      input.current?.focus();
      return true;
    }
    if (matchesCombo(event, 'alt+m')) {
      haptic.tap();
      toggleNotes();
      return true;
    }
    if (matchesCombo(event, 'alt+k')) {
      const next: KeepOpen = keepOpen === 'on' ? 'off' : 'on';
      haptic.tap();
      setKeepOpen(next);
      showToast(next === 'on' ? '계속 추가 모드를 켰습니다.' : '계속 추가 모드를 껐습니다.');
      return true;
    }
    if (matchesCombo(event, 'alt+t')) {
      haptic.tap();
      setPlainText((on) => !on);
      closePane();
      input.current?.focus();
      return true;
    }
    if (Platform.OS === 'android' && matchesCombo(event, 'alt+r')) {
      haptic.tap();
      setCalendarCursor(null);
      setCalendarMonth(null);
      setOpenPane((cur) => (cur === 'reminder' ? null : 'reminder'));
      return true;
    }
    if (matchesCombo(event, 'alt+o')) {
      applyPickedDate(todayDate);
      return true;
    }
    if (matchesCombo(event, 'alt+n')) {
      applyPickedDate(todayDate.add({ days: 1 }));
      return true;
    }
    if (!parent && matchesCombo(event, 'alt+i')) {
      openAiOrganize();
      return true;
    }
    if (!event.editing) {
      return true;
    }
    return false;
  }, { priority: KEY_PRIORITY.quickAdd });

  const due = draft?.due_at ? formatDue({ due_at: draft.due_at, timezone, all_day: draft.all_day }) : null;
  const repeat = describeRecurrence(draft?.recurrence_rule ?? null, draft?.recurrence_mode);
  const durationLabel = draft?.duration_minutes ? formatDurationMinutes(draft.duration_minutes) : null;
  const isNewProject = !!draft?.project
    && !projects?.some((project) => project.name.toLowerCase() === draft.project!.toLowerCase());
  const defaultProject = !draft?.project && defaults.projectId
    ? projects?.find((project) => project.id === defaults.projectId)?.name : undefined;
  const selectedSectionName = effectiveSectionId ? availableSections.find((s) => s.id === effectiveSectionId)?.name : undefined;
  const isTimedDraft = !!draft?.due_at && !draft.all_day;
  const quickReminders = isTimedDraft ? timedQuickReminders : allDayQuickReminders;
  const effectiveReminder = normalizeReminderForMode(reminderChoice, isTimedDraft);
  const reminderChipLabel = formatReminderChip(reminderChoice, isTimedDraft);
  const hasChips = !!draft && (due || durationLabel || repeat || draft.project || draft.tags.length > 0 || draft.priority < 4 || reminderChipLabel);
  const canSend = (plainText ? !!text.trim() : !!parsed) || isMultiLine;
  const saturday = todayDate.add({ days: (6 - todayDate.dayOfWeek + 7) % 7 || 7 });
  const nextMonday = todayDate.add({ days: 8 - todayDate.dayOfWeek });
  const keyboardHint = openPane === 'calendar'
    ? '←→↑↓ 날짜 이동 · Enter 적용 · Esc 닫기'
    : suggestions.length > 0
      ? '↑↓ 이동 · Tab 선택 · Esc 닫기'
      : 'Enter 추가 · Ctrl+Enter 저장 · Alt+M 메모 · Alt+1~4 우선순위 · Alt+K 계속 추가 · Esc 닫기';

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
        style={[
          styles.bar, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, space.md) }, elevation(colors, 2),
          frame,
        ]}>
        <View style={styles.topRow}>
          <Txt variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {parent
              ? `하위 작업 · ${parent.title}`
              : activeProject
                ? `#${activeProject.name}${selectedSectionName ? ` · ${selectedSectionName}` : ''}`
                : '새 할 일'}
          </Txt>
          <Pressable
            accessibilityRole="switch" accessibilityState={{ checked: keepOpen === 'on' }}
            accessibilityLabel="계속 추가 모드"
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
            <Icon name="layers" size={12} color={keepOpen === 'on' ? colors.accentText : colors.textMuted} />
            <Txt variant="caption" tone={keepOpen === 'on' ? 'accent' : 'muted'} style={{ fontWeight: '600' }}>계속 추가</Txt>
          </Pressable>
          {parent ? null : (
            <Pressable
              accessibilityRole="button" accessibilityLabel="AI로 정리"
              onPress={openAiOrganize}
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
          onFocus={() => { if (openPane === 'calendar') closePane(); }}
          placeholder={parent ? '하위 작업 입력 · 여러 줄 붙여넣기 가능' : '예: 금요일 3시 30분간 회의 #업무 !!!'}
          accessibilityLabel="할 일 입력" />
        {showNotes ? (
          <TextInput
            ref={notesInput}
            value={notes} onChangeText={setNotes} multiline maxLength={10000}
            onFocus={() => { if (openPane === 'calendar') closePane(); }}
            placeholder="메모나 링크를 입력해 주세요" placeholderTextColor={colors.textFaint} accessibilityLabel="메모"
            style={[type.small, styles.notesInput, { backgroundColor: colors.surfaceMuted, color: colors.text }]} />
        ) : null}
        {plainText ? (
          <View style={[styles.plainHint, { backgroundColor: colors.surfaceMuted }]}>
            <Icon name="type" size={13} color={colors.textMuted} />
            <Txt variant="caption" tone="muted" style={{ flex: 1 }}>입력한 그대로 저장합니다 · 날짜·태그 자동 인식 꺼짐</Txt>
            <Pressable hitSlop={8} onPress={() => setPlainText(false)}>
              <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>해제</Txt>
            </Pressable>
          </View>
        ) : null}
        {isMultiLine ? (
          <View style={[styles.multiBox, { backgroundColor: colors.surfaceMuted }]}>
            <Txt variant="caption" style={{ fontWeight: '700' }}>
              {multiLines.length}줄을 어떻게 추가할까요?
            </Txt>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <Chip icon="layers" label={`할 일 ${multiLines.length}개로 추가`} selected onPress={submitMultiSeparate} />
              {!parent ? (
                <Chip icon="git-merge" label={`체크리스트로 추가 (하위 ${multiLines.length - 1}개)`} onPress={submitMultiAsChecklist} />
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
            {suggestions.map((name, index) => {
              const highlighted = keyboardMode && index === activeSuggestion;
              return (
                <Pressable
                  key={name} accessibilityRole="button" accessibilityLabel={(mention.kind === 'project' ? '목록 ' : '태그 ') + name}
                  accessibilityState={{ selected: highlighted }}
                  onPress={() => pickSuggestion(name)}
                  style={({ pressed }) => [
                    styles.suggestion,
                    highlighted
                      ? { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent }
                      : { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: 'transparent' },
                    { opacity: pressed ? 0.6 : 1 },
                  ]}>
                  <Icon name={mention.kind === 'project' ? 'hash' : 'tag'} size={12} color={highlighted ? colors.accentText : colors.textMuted} />
                  <Txt variant="smallStrong" tone={highlighted ? 'accent' : 'default'}>{name}</Txt>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {!isMultiLine && availableSections.length > 0 ? (
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
            contentContainerStyle={{ gap: 6, paddingTop: space.sm }}>
            <Chip
              icon="minus" label="섹션 없음" selected={!effectiveSectionId}
              onPress={() => setChosenSectionId(null)} />
            {availableSections.map((section) => (
              <Chip
                key={section.id} icon="bookmark" label={section.name}
                selected={effectiveSectionId === section.id}
                onPress={() => setChosenSectionId(section.id)} />
            ))}
          </ScrollView>
        ) : null}

        {openPane === 'calendar' ? (
          <View style={[styles.paneBox, { backgroundColor: colors.surfaceMuted }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6 }}>
              <Chip icon="sun" label="오늘" onPress={() => applyPickedDate(todayDate)} />
              <Chip icon="sunrise" label="내일" onPress={() => applyPickedDate(todayDate.add({ days: 1 }))} />
              <Chip label="모레" onPress={() => applyPickedDate(todayDate.add({ days: 2 }))} />
              <Chip icon="coffee" label="주말" onPress={() => applyPickedDate(saturday)} />
              <Chip icon="arrow-right" label="다음 주" onPress={() => applyPickedDate(nextMonday)} />
              <Chip icon="slash" label="날짜 없음" onPress={() => applyPickedDate(null)} />
            </ScrollView>
            <MonthCalendar
              initial={draftPlainDate ?? todayDate}
              month={calendarMonth ?? (calendarCursor ?? draftPlainDate ?? todayDate).toPlainYearMonth()}
              selected={calendarCursor ?? draftPlainDate}
              today={todayDate}
              onMonthChange={setCalendarMonth}
              onSelect={applyPickedDate} />
          </View>
        ) : null}

        {openPane === 'priority' ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: space.sm }}>
            {priorities.map((priority) => {
              const active = (draft?.priority ?? 4) === priority;
              return (
                <Pressable
                  key={priority} accessibilityRole="button" accessibilityLabel={priorityA11y(priority)} accessibilityState={{ selected: active }}
                  onPress={() => pickPriority(priority)}
                  style={({ pressed }) => [styles.insert, {
                    flex: 1, justifyContent: 'center', borderColor: active ? colors.accent : colors.border,
                    backgroundColor: active ? colors.accentSoft : 'transparent', opacity: pressed ? 0.6 : 1,
                  }]}>
                  <Txt variant="smallStrong" numberOfLines={1} style={{ color: active ? colors.accentText : colors.textMuted }}>
                    {priority < 4 ? priorityMark(priority) : priorityLabel(priority)}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {openPane === 'reminder' ? (
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
            contentContainerStyle={{ gap: 6, paddingTop: space.sm }}>
            {quickReminders.map((option) => (
              <Chip
                key={option.label}
                icon={option.value === 'off' ? 'bell-off' : 'bell'}
                label={option.label}
                selected={effectiveReminder === option.value}
                onPress={() => {
                  setReminderChoice(option.value);
                  setOpenPane(null);
                  input.current?.focus();
                }} />
            ))}
          </ScrollView>
        ) : null}

        {!isMultiLine && (hasChips || defaultProject || reminderChipLabel || (defaultsToToday && !due)) ? (
          <View style={styles.chips}>
            {due ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip
                  icon="calendar" label={due + ' ×'} tone="set"
                  onPress={() => stripToken((token) => token.kind === 'date' || token.kind === 'time')} />
              </Animated.View>
            ) : defaultsToToday ? (
              <Chip
                icon={undated ? 'slash' : 'calendar'} label={undated ? '날짜 없음' : '오늘 ×'}
                tone={undated ? undefined : 'set'}
                onPress={() => {
                  setUndated((current) => !current);
                  input.current?.focus();
                }} />
            ) : null}
            {durationLabel ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip icon="clock" label={durationLabel + ' ×'} tone="set" onPress={() => stripToken((token) => token.kind === 'duration')} />
              </Animated.View>
            ) : null}
            {repeat ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip icon="repeat" label={repeat + ' ×'} tone="set" onPress={() => stripToken((token) => token.kind === 'recurrence')} />
              </Animated.View>
            ) : null}
            {reminderChipLabel ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip
                  icon={effectiveReminder === 'off' ? 'bell-off' : 'bell'}
                  label={reminderChipLabel + ' ×'}
                  tone="set"
                  onPress={() => setReminderChoice(undefined)} />
              </Animated.View>
            ) : null}
            {draft?.project ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip
                  icon="hash" label={draft.project + (selectedSectionName ? ` · ${selectedSectionName}` : '') + (isNewProject ? ' · 새 목록' : '') + ' ×'} tone="set"
                  onPress={() => stripToken((token) => token.kind === 'project')} />
              </Animated.View>
            ) : defaultProject ? (
              <Chip icon="hash" label={selectedSectionName ? `${defaultProject} · ${selectedSectionName}` : defaultProject} />
            ) : null}
            {draft?.tags.map((tag) => (
              <Animated.View key={tag} entering={ZoomIn.duration(140)}>
                <Chip
                  icon="tag" label={tag + ' ×'} tone="set"
                  onPress={() => stripToken((token) => token.kind === 'tag' && token.text.replace(/^@"?|"?$/g, '').toLowerCase() === tag.toLowerCase())} />
              </Animated.View>
            ))}
            {draft && draft.priority < 4 ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <Chip
                  label={priorityOption(draft.priority) + ' ×'} tone="set"
                  onPress={() => stripToken((token) => token.kind === 'priority')} />
              </Animated.View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.tools}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
            {inserts.map((item) => {
              const active = (item.kind === 'calendar' && openPane === 'calendar')
                || (item.kind === 'priority' && openPane === 'priority')
                || (item.kind === 'reminder' && (openPane === 'reminder' || reminderChoice !== undefined))
                || (item.kind === 'notes' && (showNotes || !!notes.trim()))
                || (item.kind === 'plain' && plainText);
              return (
                <Pressable
                  key={item.label} accessibilityRole="button" accessibilityLabel={insertA11yLabel(item)} onPress={() => insert(item)}
                  style={({ pressed }) => [styles.insert, {
                    borderColor: active ? colors.accent : colors.border,
                    backgroundColor: active ? colors.accentSoft : 'transparent', opacity: pressed ? 0.6 : 1,
                  }]}>
                  <Icon name={item.icon} size={13} color={active ? colors.accentText : colors.textFaint} />
                  <Txt variant="small" tone={active ? 'accent' : 'muted'}>{item.label}</Txt>
                </Pressable>
              );
            })}
          </ScrollView>
          {added > 0 ? (
            <Animated.View key={added} entering={ZoomIn.duration(160)} exiting={FadeOut.duration(400)}>
              <Txt variant="small" tone="muted">{added}개 추가됨</Txt>
            </Animated.View>
          ) : null}
          <Pressable
            accessibilityRole="button" accessibilityLabel="할 일 추가" accessibilityState={{ disabled: !canSend }} onPress={submit}
            style={({ pressed }) => [styles.send, { backgroundColor: canSend ? colors.accent : colors.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}>
            <Icon name="arrow-up" size={20} color={canSend ? colors.onAccent : colors.textFaint} />
          </Pressable>
        </View>
        {keyboardMode ? (
          <Txt variant="caption" tone="muted" numberOfLines={1} ellipsizeMode="tail" style={styles.keyboardHint}>
            {keyboardHint}
          </Txt>
        ) : null}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

/** Hosts the floating add button on every signed-in screen and the entry bar it opens. */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { column, twoPane } = useLayout();
  const segments: string[] = useSegments();
  const [active, setActive] = useState<{ key: number; defaults: QuickAddDefaults } | null>(null);
  const [fabHidden, setFabHidden] = useState(false);
  const screenDefaults = useRef<QuickAddDefaults | null>(null);
  const openKey = useRef(0);

  const value = useMemo<QuickAddValue>(() => ({
    open: (defaults) => {
      openKey.current += 1;
      setActive({ key: openKey.current, defaults: defaults ?? screenDefaults.current ?? {} });
    },
    setScreenDefaults: (defaults) => { screenDefaults.current = defaults; },
    setFabHidden: (hidden) => setFabHidden(hidden),
    fabHidden,
  }), [fabHidden]);
  const close = useCallback(() => setActive(null), []);

  const showButton = segments[0] === '(tabs)' && !fabHidden;
  const onHabits = showButton && segments[1] === 'habits';
  const quiet = showButton && segments[1] === 'focus';
  const onToday = segments[0] === '(tabs)' && (segments[1] === undefined || segments[1] === 'index');
  const paneFrame = twoPane && onToday ? twoPane : null;
  const fabRight = space.lg + (paneFrame ? paneFrame.inset + paneFrame.sideWidth : column.inset);
  const barFrame = useMemo<StyleProp<ViewStyle>>(() => (
    paneFrame ? { width: paneFrame.listWidth, marginLeft: paneFrame.inset, alignSelf: 'flex-start' }
      : column.maxWidth === undefined ? null : { width: column.maxWidth, maxWidth: '100%', alignSelf: 'center' }
  ), [paneFrame, column.maxWidth]);

  return (
    <QuickAddContext.Provider value={value}>
      {children}
      {showButton && !active ? (
        <Animated.View
          entering={ZoomIn.duration(160)} pointerEvents="box-none"
          style={[styles.fabWrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + space.lg, right: fabRight }]}>
          <Pressable
            accessibilityRole="button" accessibilityLabel={onHabits ? '습관 추가' : '할 일 빠른 추가'}
            onPress={() => {
              haptic.light();
              if (onHabits) router.push('/habit/new');
              else value.open();
            }}
            style={({ pressed }) => [
              styles.fab, { backgroundColor: quiet ? colors.surface : colors.accent, transform: [{ scale: pressed ? 0.94 : 1 }] },
              quiet && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }, elevation(colors, 2),
            ]}>
            <Icon name="plus" size={26} color={quiet ? colors.textMuted : colors.onAccent} />
          </Pressable>
        </Animated.View>
      ) : null}
      {active ? <QuickAddSheet key={active.key} defaults={active.defaults} frame={barFrame} onClose={close} /> : null}
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
  paneBox: {
    marginTop: space.sm, borderRadius: radius.md, padding: space.sm, gap: space.xs,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  keyboardHint: { marginTop: space.sm },
  insert: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, height: 30,
  },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.sm, paddingHorizontal: 10, height: 30,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  fabWrap: { position: 'absolute' },
  fab: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
});
