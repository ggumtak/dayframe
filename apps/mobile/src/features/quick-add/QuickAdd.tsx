import { router, useSegments } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, type StyleProp, StyleSheet,
  TextInput, type TextInputInstance, View, type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiIcon } from '@/components/AiIcon';
import { MonthCalendar } from '@/components/MonthCalendar';
import { Chip, Icon, IconButton, type IconName, Row, Sheet, Txt } from '@/components/ui';
import { useNewTaskDate } from '@/data/session';
import { nextPosition, useProjects, useSections, useSubtaskProgress, useTags, useTaskActions, useTaskIndex } from '@/data/tasks';
import { AI_ROUTES } from '@/features/ai/routes';
import {
  KEY_PRIORITY, matchesCombo, moveCursor, useInputCapture, useKeyboard, useKeyHandler, useScreenContext,
} from '@/features/keyboard';
import { DAY_MINUTES, leadLabel, type TaskReminder } from '@/features/reminders/lead';
import { setTaskReminder } from '@/features/reminders/overrides';
import { setPersonalPrefs, usePersonalPrefs } from '@/features/settings/prefsStore';
import { PlanDaySheet } from '@/features/tasks/PlanDaySheet';
import { priorityA11y, priorityLabel, priorityMark, priorityOption } from '@/features/tasks/priority';
import { TemplatesSheet } from '@/features/tasks/TemplatesSheet';
import {
  describeRecurrence, deviceTimeZone, dueBucket, dueDate, formatDue, formatDurationMinutes, instantFor, logicalToday,
  type PlainDate, type Temporal,
} from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { useLayout } from '@/lib/layoutContext';
import { datePhrase } from '@/lib/occurrences';
import { analyzeTask, type Priority, type TaskAnalysis, type TaskToken } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { elevation, radius, space, type, useTheme } from '@/theme';

import { HighlightInput, type PillPalette } from './HighlightInput';
import { parseErrorMessage } from './messages';
import {
  activeMention, applyMention, applyPriority, applyProject, applyScheduleWord, matchNames, parseChecklistLines,
  removeTokens, toggleTag,
} from './suggest';

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
  /** Opens directly in multi-line checklist capture mode when `'checklist'`. */
  initialMode?: 'default' | 'checklist';
  /** Overrides sticky rapid multi-add state for this session. */
  initialKeepOpen?: boolean;
}

interface QuickAddValue {
  open: (defaults?: QuickAddDefaults) => void;
  setScreenDefaults: (defaults: QuickAddDefaults | null) => void;
  setFabHidden: (hidden: boolean) => void;
  fabHidden: boolean;
}

const QuickAddContext = createContext<QuickAddValue>({ open: () => {}, setScreenDefaults: () => {}, setFabHidden: () => {}, fabHidden: false });
export const useQuickAdd = () => useContext(QuickAddContext);

type OpenPane = null | 'calendar' | 'project' | 'tag' | 'priority' | 'reminder';

const priorities: Priority[] = [1, 2, 3, 4];

const quickTimePresets = [
  { label: '오전 9시', word: '오전 9시' },
  { label: '오후 2시', word: '오후 2시' },
  { label: '저녁 7시', word: '저녁 7시' },
] as const;

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

function presetIconFor(preset: string, timezone: string): IconName {
  if (preset.startsWith('#')) return 'hash';
  if (preset.startsWith('@')) return 'tag';
  try {
    const { tokens } = analyzeTask({ text: '작업 ' + preset, timezone }, { draft: true });
    const kind = tokens[0]?.kind;
    if (kind === 'date') return preset.includes('내일') ? 'sunrise' : preset.includes('주말') ? 'coffee' : 'sun';
    if (kind === 'time') return 'clock';
    if (kind === 'duration') return 'watch';
    if (kind === 'recurrence') return 'repeat';
    if (kind === 'priority') return 'flag';
    if (kind === 'project') return 'hash';
    if (kind === 'tag') return 'tag';
  } catch {
    // Fall back to neutral quick icon.
  }
  return 'zap';
}

function EditablePill({
  icon, label, active, onEdit, onClear, editLabel, clearLabel,
}: {
  icon?: IconName;
  label: string;
  active?: boolean;
  onEdit: () => void;
  onClear?: () => void;
  editLabel?: string;
  clearLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.editablePill,
        {
          borderColor: active ? colors.accent : colors.border,
          backgroundColor: active ? colors.accentSoft : colors.surfaceMuted,
        },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={editLabel ?? label}
        onPress={() => {
          haptic.tap();
          onEdit();
        }}
        style={({ pressed }) => [styles.editablePillMain, { opacity: pressed ? 0.65 : 1 }]}>
        {icon ? <Icon name={icon} size={12} color={active ? colors.accentText : colors.textMuted} /> : null}
        <Txt variant="caption" tone={active ? 'accent' : 'default'} style={{ fontWeight: '600' }} numberOfLines={1}>
          {label}
        </Txt>
      </Pressable>
      {onClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel ?? `${label} 지우기`}
          hitSlop={6}
          onPress={() => {
            haptic.tap();
            onClear();
          }}
          style={({ pressed }) => [styles.editablePillClose, { opacity: pressed ? 0.5 : 1 }]}>
          <Icon name="x" size={12} color={active ? colors.accentText : colors.textFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

function QuickAddSheet({ defaults, frame, onClose, onOpenTemplates }: {
  defaults: QuickAddDefaults;
  frame: StyleProp<ViewStyle>;
  onClose: () => void;
  onOpenTemplates: (context: { projectId?: string | null; sectionId?: string | null; dueToday?: boolean }) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { keyboardMode, blurActiveInput } = useKeyboard();
  useScreenContext('quick-add');
  const personalPrefs = usePersonalPrefs();

  const input = useRef<TextInputInstance>(null);
  const notesInput = useRef<TextInputInstance>(null);
  const notesFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [text, setText] = useState(defaults.initialText ?? '');
  const [cursor, setCursor] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [plainText, setPlainText] = useState(false);
  const [checklistMode, setChecklistMode] = useState(defaults.initialMode === 'checklist' && !defaults.parentTaskId);
  const [added, setAdded] = useState(0);
  const [lastAdded, setLastAdded] = useState<{ ids: string[]; title: string; count: number } | null>(null);
  const [openPane, setOpenPane] = useState<OpenPane>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [calendarCursor, setCalendarCursor] = useState<PlainDate | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Temporal.PlainYearMonth | null>(null);
  const [chosenSectionId, setChosenSectionId] = useState<string | null | undefined>(defaults.sectionId);
  const [reminderChoice, setReminderChoice] = useState<TaskReminder | undefined>(undefined);
  const [undated, setUndated] = useState(false);
  const [clearedDefaultProject, setClearedDefaultProject] = useState(false);
  const [keepOpenOverride, setKeepOpenOverride] = useState<boolean | null>(defaults.initialKeepOpen ?? null);

  const [newTaskDate] = useNewTaskDate();
  const { tasks, byId } = useTaskIndex();
  const { data: projects } = useProjects();
  const { data: sections } = useSections();
  const { data: tags } = useTags();
  const actions = useTaskActions();
  const [timezone] = useState(deviceTimeZone);

  const parent = defaults.parentTaskId ? byId.get(defaults.parentTaskId) : undefined;
  const isKeepOpenOn = keepOpenOverride ?? personalPrefs.quickAddKeepOpen;
  const defaultsToToday = !parent && (!!defaults.dueToday || newTaskDate === 'today');

  // Resolve personal default project when no explicit projectId was passed by the calling screen.
  const effectiveDefaultProjectId = useMemo(() => {
    if (parent || clearedDefaultProject) return null;
    const candidate = defaults.projectId !== undefined ? defaults.projectId : personalPrefs.quickAddDefaultProjectId;
    if (!candidate) return null;
    if (projects && !projects.some((p) => p.id === candidate)) return null;
    return candidate;
  }, [parent, clearedDefaultProject, defaults.projectId, personalPrefs.quickAddDefaultProjectId, projects]);

  const multiLines = useMemo(() => (text.includes('\n') ? parseChecklistLines(text) : []), [text]);
  const isMultiLine = multiLines.length >= 2;
  const firstLine = useMemo(() => {
    const idx = text.indexOf('\n');
    return idx >= 0 ? text.slice(0, idx) : text;
  }, [text]);

  // In checklist mode, parse line 1 so the parent task still gets full NLP pills & highlighting.
  const analysisSource = checklistMode ? firstLine : text;
  const result = useMemo(
    () => analyzeDraft(analysisSource, timezone, !checklistMode && isMultiLine, plainText),
    [analysisSource, timezone, checklistMode, isMultiLine, plainText],
  );
  const { analysis } = result;
  const parsed = plainText ? undefined : (analysis?.task.title ? analysis.task : undefined);
  const draft = plainText ? undefined : analysis?.task;
  const draftProject = draft?.project;
  const todayDate = useMemo(() => logicalToday(timezone, personalPrefs.dayStartHour), [timezone, personalPrefs.dayStartHour]);
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

  const toggleKeepOpen = () => {
    const next = !isKeepOpenOn;
    haptic.tap();
    setKeepOpenOverride(next);
    if (defaults.initialKeepOpen === undefined) {
      setPersonalPrefs({ quickAddKeepOpen: next });
    }
  };

  // Resolve the effective project (typed #project match or default screen/personal project) so sections can be chosen inline.
  const activeProject = useMemo(() => {
    if (parent) return undefined;
    if (draftProject) {
      return projects?.find((p) => p.name.toLowerCase() === draftProject.toLowerCase());
    }
    if (effectiveDefaultProjectId) {
      return projects?.find((p) => p.id === effectiveDefaultProjectId);
    }
    return undefined;
  }, [parent, draftProject, effectiveDefaultProjectId, projects]);

  const availableSections = useMemo(
    () => (activeProject ? (sections ?? []).filter((s) => s.project_id === activeProject.id).sort((a, b) => a.position - b.position) : []),
    [activeProject, sections],
  );
  const effectiveSectionId = availableSections.some((s) => s.id === chosenSectionId) ? (chosenSectionId ?? null) : null;

  const tokens: TaskToken[] = !plainText && analysis && analysis.text === analysisSource ? analysis.tokens : [];

  const updateAnalysisLine = (updater: (line: string, lineTokens: TaskToken[]) => string) => {
    setCursor(null);
    setText((current) => {
      if (!checklistMode || !current.includes('\n')) return updater(current, tokens);
      const newlineIndex = current.indexOf('\n');
      const head = current.slice(0, newlineIndex);
      const tail = current.slice(newlineIndex);
      return updater(head, tokens).replace(/\s+$/, '') + tail;
    });
  };

  const buildStickyPrefix = (): string => {
    if (plainText) return '';
    const preserved = tokens
      .filter((t) => t.kind === 'date' || t.kind === 'project' || t.kind === 'tag')
      .sort((a, b) => a.start - b.start)
      .map((t) => t.text.trim())
      .filter(Boolean);
    return preserved.length > 0 ? preserved.join(' ') + ' ' : '';
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
    const due_at = fallbackToday ? instantFor(todayDate, null, timezone) : parsedLine?.due_at ?? null;
    const lineAllDay = fallbackToday ? true : (parsedLine?.all_day ?? true);
    const lineTimed = !!due_at && !lineAllDay;
    const matchedProj = parsedLine?.project ? projects?.find((p) => p.name.toLowerCase() === parsedLine!.project!.toLowerCase()) : undefined;
    const projectId = targetParentId ? null : (matchedProj ? matchedProj.id : (parsedLine?.project ? null : effectiveDefaultProjectId));
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

  const afterSubmit = (createdIds: string[], summaryTitle: string, countAdded: number, toastMessage?: string) => {
    haptic.success();
    const stickyPrefix = isKeepOpenOn ? buildStickyPrefix() : '';
    setText(stickyPrefix);
    setCursor(stickyPrefix.length || null);
    setNotes('');
    setShowNotes(false);
    setPlainText(false);
    closePane();
    setSuggestionIndex(0);
    setReminderChoice(undefined);
    if (!isKeepOpenOn) {
      setUndated(false);
      setClearedDefaultProject(false);
      setChosenSectionId(defaults.sectionId);
    }
    if (toastMessage) showToast(toastMessage);
    if (isKeepOpenOn) {
      setAdded((count) => count + countAdded);
      setLastAdded({ ids: createdIds, title: summaryTitle, count: countAdded });
      input.current?.focus();
    } else {
      closeSheet();
    }
  };

  const undoLastAdded = () => {
    if (!lastAdded) return;
    haptic.light();
    for (const id of lastAdded.ids) {
      actions.remove(id);
    }
    setAdded((count) => Math.max(0, count - lastAdded.count));
    setLastAdded(null);
    input.current?.focus();
  };

  const submitMultiSeparate = () => {
    const ids = multiLines.map((line, index) => createSingleLine(line, index));
    afterSubmit(ids, `할 일 ${multiLines.length}개`, multiLines.length, isKeepOpenOn ? undefined : `할 일 ${multiLines.length}개를 추가했습니다.`);
  };

  const submitMultiAsChecklist = () => {
    if (multiLines.length < 2) return;
    const [head, ...rest] = multiLines;
    const parentId = createSingleLine(head, 0, notes.trim() ? notes : null);
    rest.forEach((line, index) => {
      createSingleLine(line, index, null, parentId);
    });
    afterSubmit(
      [parentId],
      head,
      1,
      isKeepOpenOn ? undefined : `‘${head}’${josa(head, '와/과')} 하위 작업 ${rest.length}개를 추가했습니다.`,
    );
  };

  const submit = () => {
    if (isMultiLine) {
      if (checklistMode && !parent) submitMultiAsChecklist();
      else submitMultiSeparate();
      return;
    }
    const singleSource = checklistMode ? firstLine : text;
    const plainTitle = plainText ? singleSource.trim() : '';
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
    const projectId = parent ? null : (matchedProj ? matchedProj.id : (parsed?.project ? null : effectiveDefaultProjectId));
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
    afterSubmit([createdId], title, 1, isKeepOpenOn ? undefined : `‘${title}’${josa(title, '을/를')} 추가했습니다.`);
  };

  const effectiveCursor = cursor === null ? text.length : Math.min(cursor, text.length);
  const mention = useMemo(
    () => (plainText || (!checklistMode && isMultiLine) ? null : activeMention(text, effectiveCursor)),
    [text, effectiveCursor, isMultiLine, checklistMode, plainText],
  );
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
      updateAnalysisLine((current, lineTokens) => removeTokens(current, lineTokens, (t) => t.kind === 'date' || t.kind === 'time'));
      setUndated(true);
    } else {
      setUndated(false);
      const phrase = datePhrase(pickedDate, todayDate);
      updateAnalysisLine((current, lineTokens) => applyScheduleWord(current, phrase, 'date', lineTokens));
    }
    input.current?.focus();
  };

  const applyPickedTime = (word: string | null) => {
    haptic.tap();
    setPlainText(false);
    if (word === null) {
      updateAnalysisLine((current, lineTokens) => removeTokens(current, lineTokens, (t) => t.kind === 'time'));
    } else {
      updateAnalysisLine((current, lineTokens) => applyScheduleWord(current, word, 'time', lineTokens));
    }
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

  const togglePane = (pane: Exclude<OpenPane, null | 'calendar'>) => {
    haptic.tap();
    if (pane !== 'reminder') setPlainText(false);
    setCalendarCursor(null);
    setCalendarMonth(null);
    setOpenPane((cur) => (cur === pane ? null : pane));
    if (pane === 'priority') input.current?.focus();
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

  const toggleChecklistMode = () => {
    haptic.tap();
    closePane();
    setChecklistMode((on) => !on);
    input.current?.focus();
  };

  const appendChecklistLine = () => {
    haptic.tap();
    setText((current) => (current.endsWith('\n') ? current : current + '\n'));
    setCursor(null);
    input.current?.focus();
  };

  const removeChecklistItem = (itemIndex: number) => {
    haptic.tap();
    const rawLines = text.split(/\r?\n/);
    let nonEmptyIdx = -1;
    const nextLines = rawLines.filter((line) => {
      if (line.trim()) nonEmptyIdx += 1;
      return nonEmptyIdx !== itemIndex;
    });
    setText(nextLines.join('\n'));
    setCursor(null);
  };

  const openAiOrganize = () => {
    haptic.tap();
    const memo = text.trim();
    closeSheet();
    router.push({ pathname: AI_ROUTES.organize, params: memo ? { text: memo } : {} });
  };

  const handleOpenTemplates = () => {
    haptic.tap();
    const context = {
      projectId: activeProject?.id ?? effectiveDefaultProjectId,
      sectionId: effectiveSectionId,
      dueToday: defaultsToToday && !undated,
    };
    closeSheet();
    onOpenTemplates(context);
  };

  const applyPresetChip = (preset: string) => {
    haptic.tap();
    setPlainText(false);
    closePane();
    const trimmed = preset.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#') && trimmed.length > 1) {
      setClearedDefaultProject(false);
      updateAnalysisLine((current, lineTokens) => applyProject(current, trimmed.slice(1).replace(/^"|"$/g, ''), lineTokens));
      input.current?.focus();
      return;
    }
    if (trimmed.startsWith('@') && trimmed.length > 1) {
      updateAnalysisLine((current, lineTokens) => toggleTag(current, trimmed.slice(1).replace(/^"|"$/g, ''), lineTokens));
      input.current?.focus();
      return;
    }
    try {
      const probe = analyzeTask({ text: '작업 ' + trimmed, timezone }, { draft: true });
      const firstKind = probe.tokens[0]?.kind;
      if (firstKind === 'date' || firstKind === 'time' || firstKind === 'duration' || firstKind === 'recurrence') {
        if (firstKind === 'date') setUndated(false);
        const lineCursor = !checklistMode && cursor !== null ? cursor : undefined;
        updateAnalysisLine((current, lineTokens) => applyScheduleWord(current, trimmed, firstKind, lineTokens, lineCursor));
        input.current?.focus();
        return;
      }
      if (firstKind === 'priority') {
        updateAnalysisLine((current, lineTokens) => applyPriority(current, probe.task.priority, lineTokens));
        input.current?.focus();
        return;
      }
    } catch {
      // Fall through to plain append.
    }
    updateAnalysisLine((current) => (current && !/\s$/.test(current) ? current + ' ' : current) + trimmed + ' ');
    input.current?.focus();
  };

  const pickProjectFromPane = (name: string | null) => {
    haptic.tap();
    setPlainText(false);
    if (name === null) {
      setClearedDefaultProject(true);
      setChosenSectionId(null);
      updateAnalysisLine((current, lineTokens) => applyProject(current, null, lineTokens));
    } else {
      setClearedDefaultProject(false);
      updateAnalysisLine((current, lineTokens) => applyProject(current, name, lineTokens));
    }
    closePane();
    input.current?.focus();
  };

  const pickTagFromPane = (name: string) => {
    haptic.tap();
    setPlainText(false);
    updateAnalysisLine((current, lineTokens) => toggleTag(current, name, lineTokens));
    input.current?.focus();
  };

  const pickPriority = (priority: Priority) => {
    haptic.tap();
    setPlainText(false);
    updateAnalysisLine((current, lineTokens) => applyPriority(current, priority, lineTokens));
    closePane();
    input.current?.focus();
  };

  const pickSuggestion = (name: string) => {
    if (!mention) return;
    haptic.tap();
    const nextText = applyMention(text, mention, name);
    setText(nextText);
    setCursor(null);
    setSuggestionIndex(0);
    input.current?.focus();
  };

  const stripToken = (predicate: (token: TaskToken) => boolean) => {
    updateAnalysisLine((current, lineTokens) => removeTokens(current, lineTokens, predicate));
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
      if (matchesCombo(event, 'arrowleft')) { moveCalendarCursor(-1); return true; }
      if (matchesCombo(event, 'arrowright')) { moveCalendarCursor(1); return true; }
      if (matchesCombo(event, 'arrowup')) { moveCalendarCursor(-7); return true; }
      if (matchesCombo(event, 'arrowdown')) { moveCalendarCursor(7); return true; }
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
    if (matchesCombo(event, 'alt+d')) { haptic.tap(); toggleCalendarPane(); return true; }
    if (matchesCombo(event, 'alt+p')) { togglePane('priority'); return true; }
    if (matchesCombo(event, 'alt+m')) { haptic.tap(); toggleNotes(); return true; }
    if (matchesCombo(event, 'alt+k')) {
      const next = !isKeepOpenOn;
      toggleKeepOpen();
      showToast(next ? '계속 추가 모드를 켰습니다.' : '계속 추가 모드를 껐습니다.');
      return true;
    }
    if (matchesCombo(event, 'alt+t')) {
      haptic.tap();
      setPlainText((on) => !on);
      closePane();
      input.current?.focus();
      return true;
    }
    if (Platform.OS !== 'web' && matchesCombo(event, 'alt+r')) {
      togglePane('reminder');
      return true;
    }
    if (matchesCombo(event, 'alt+o')) { applyPickedDate(todayDate); return true; }
    if (matchesCombo(event, 'alt+n')) { applyPickedDate(todayDate.add({ days: 1 })); return true; }
    if (!parent && matchesCombo(event, 'alt+i')) { openAiOrganize(); return true; }
    if (!event.editing) return true;
    return false;
  }, { priority: KEY_PRIORITY.quickAdd });

  const due = draft?.due_at ? formatDue({ due_at: draft.due_at, timezone, all_day: draft.all_day }, personalPrefs.timeFormat) : null;
  const repeat = describeRecurrence(draft?.recurrence_rule ?? null, draft?.recurrence_mode);
  const durationLabel = draft?.duration_minutes ? formatDurationMinutes(draft.duration_minutes) : null;
  const isNewProject = !!draft?.project
    && !projects?.some((project) => project.name.toLowerCase() === draft.project!.toLowerCase());
  const defaultProjectName = !draft?.project && effectiveDefaultProjectId
    ? projects?.find((project) => project.id === effectiveDefaultProjectId)?.name
    : undefined;
  const selectedSectionName = effectiveSectionId ? availableSections.find((s) => s.id === effectiveSectionId)?.name : undefined;
  const isTimedDraft = !!draft?.due_at && !draft.all_day;
  const quickReminders = isTimedDraft ? timedQuickReminders : allDayQuickReminders;
  const effectiveReminder = normalizeReminderForMode(reminderChoice, isTimedDraft);
  const reminderChipLabel = formatReminderChip(reminderChoice, isTimedDraft);
  const hasChips = !!draft && (due || durationLabel || repeat || draft.project || draft.tags.length > 0 || draft.priority < 4 || reminderChipLabel);
  const showParsedPills = (checklistMode || !isMultiLine) && (hasChips || defaultProjectName || reminderChipLabel || (defaultsToToday && !due));
  const canSend = (plainText ? !!text.trim() : !!parsed) || isMultiLine;
  const saturday = todayDate.add({ days: (6 - todayDate.dayOfWeek + 7) % 7 || 7 });
  const nextMonday = todayDate.add({ days: 8 - todayDate.dayOfWeek });
  const hasRawTokens = tokens.length > 0 || plainText;
  const presetItems = useMemo(
    () => personalPrefs.quickAddPresets.map((label) => ({ label, icon: presetIconFor(label, timezone) })),
    [personalPrefs.quickAddPresets, timezone],
  );

  const keyboardHint = openPane === 'calendar'
    ? '←→↑↓ 날짜 이동 · Enter 적용 · Esc 닫기'
    : suggestions.length > 0
      ? '↑↓ 이동 · Tab 선택 · Esc 닫기'
      : checklistMode
        ? 'Enter 줄바꿈 · Ctrl+Enter 체크리스트 저장 · Esc 닫기'
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
          styles.bar,
          {
            backgroundColor: colors.surfaceElevated,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, space.md),
          },
          elevation(colors, 2),
          frame,
        ]}>
        <View style={styles.topRow}>
          <Txt variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {parent
              ? `하위 작업 · ${parent.title}`
              : checklistMode
                ? `체크리스트 만들기${activeProject ? ` · #${activeProject.name}` : ''}`
                : activeProject
                  ? `#${activeProject.name}${selectedSectionName ? ` · ${selectedSectionName}` : ''}`
                  : '새 할 일'}
          </Txt>
          {parent ? null : (
            <Pressable
              accessibilityRole="button" accessibilityLabel="AI로 정리"
              onPress={openAiOrganize}
              style={({ pressed }) => [styles.topPill, { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.65 : 1 }]}>
              <AiIcon size={14} color={colors.textMuted} />
              <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>AI로 정리</Txt>
            </Pressable>
          )}
          <IconButton name="x" label="닫기" size={18} color={colors.textMuted} onPress={closeSheet} style={{ width: 32, height: 32 }} />
        </View>

        <HighlightInput
          ref={input}
          value={text}
          onChangeText={(next) => {
            setText(next);
            if (lastAdded && next.trim()) setLastAdded(null);
          }}
          onSelectionChange={(event) => {
            setCursor(event.nativeEvent.selection.end);
          }}
          tokens={checklistMode && text.includes('\n') ? [] : tokens}
          palette={palette}
          disableHighlight={plainText}
          multilineEnter={checklistMode}
          autoFocus
          onSubmitEditing={submit}
          onFocus={() => { if (openPane === 'calendar') closePane(); }}
          placeholder={
            parent
              ? '하위 작업 입력'
              : checklistMode
                ? '제목 입력 후 Enter로 체크리스트 항목 추가'
                : '예: 금요일 3시 30분간 회의 #업무 !!!'
          }
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

        {checklistMode ? (
          <View style={[styles.checklistBox, { backgroundColor: colors.surfaceMuted }]}>
            <View style={styles.checklistHeader}>
              <Icon name="check-square" size={13} color={colors.accentText} />
              <Txt variant="caption" tone="muted" style={{ flex: 1 }} tabular>
                {multiLines.length >= 2
                  ? `제목 1개 · 체크리스트 항목 ${multiLines.length - 1}개`
                  : '첫 줄은 제목 · Enter로 항목을 이어서 입력'}
              </Txt>
              <Pressable hitSlop={6} onPress={appendChecklistLine} accessibilityRole="button" accessibilityLabel="체크리스트 줄 추가">
                <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>+ 항목 줄</Txt>
              </Pressable>
            </View>
            {multiLines.length >= 2 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6 }}>
                {multiLines.slice(1).map((item, idx) => (
                  <View
                    key={`${idx}-${item}`}
                    style={[styles.checklistChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Txt variant="caption" numberOfLines={1} style={{ maxWidth: 150 }}>{item}</Txt>
                    <Pressable
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`${item} 항목 지우기`}
                      onPress={() => removeChecklistItem(idx + 1)}>
                      <Icon name="x" size={11} color={colors.textFaint} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : null}
          </View>
        ) : isMultiLine ? (
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6, paddingTop: 2 }}>
              {quickTimePresets.map((tp) => (
                <Chip key={tp.label} icon="clock" label={tp.label} onPress={() => applyPickedTime(tp.word)} />
              ))}
              {isTimedDraft ? (
                <Chip icon="slash" label="시간 없음" onPress={() => applyPickedTime(null)} />
              ) : null}
              {Platform.OS !== 'web' ? (
                <Chip
                  icon={effectiveReminder === 'off' ? 'bell-off' : 'bell'}
                  label={reminderChipLabel ?? '알림'}
                  selected={reminderChoice !== undefined}
                  onPress={() => togglePane('reminder')} />
              ) : null}
            </ScrollView>
          </View>
        ) : null}

        {openPane === 'project' && !parent ? (
          <View style={[styles.paneBox, { backgroundColor: colors.surfaceMuted }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6 }}>
              <Chip
                icon="inbox" label="미분류" selected={!activeProject && !draft?.project}
                onPress={() => pickProjectFromPane(null)} />
              {(projects ?? []).map((proj) => (
                <Chip
                  key={proj.id}
                  icon="hash"
                  label={proj.name}
                  selected={activeProject?.id === proj.id}
                  onPress={() => pickProjectFromPane(proj.name)} />
              ))}
            </ScrollView>
            {availableSections.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6, paddingTop: 4 }}>
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
          </View>
        ) : null}

        {openPane === 'tag' ? (
          <View style={[styles.paneBox, { backgroundColor: colors.surfaceMuted }]}>
            {tags && tags.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6 }}>
                {tags.map((tag) => {
                  const selectedTag = !!draft?.tags.some((t) => t.toLowerCase() === tag.name.toLowerCase());
                  return (
                    <Chip
                      key={tag.id}
                      icon="tag"
                      label={tag.name}
                      selected={selectedTag}
                      onPress={() => pickTagFromPane(tag.name)} />
                  );
                })}
              </ScrollView>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
                <Pressable
                  hitSlop={6}
                  onPress={() => {
                    closePane();
                    updateAnalysisLine((current) => (current && !/\s$/.test(current) ? current + ' ' : current) + '@');
                    input.current?.focus();
                  }}>
                  <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>@ 입력</Txt>
                </Pressable>
              </View>
            )}
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
                  style={({ pressed }) => [styles.presetChip, {
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

        {showParsedPills ? (
          <View style={styles.chips}>
            {due ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <EditablePill
                  icon="calendar"
                  label={due}
                  active={openPane === 'calendar'}
                  editLabel={`일정 ${due} 수정`}
                  clearLabel="일정 지우기"
                  onEdit={toggleCalendarPane}
                  onClear={() => stripToken((token) => token.kind === 'date' || token.kind === 'time')} />
              </Animated.View>
            ) : defaultsToToday ? (
              <EditablePill
                icon={undated ? 'slash' : 'calendar'}
                label={undated ? '날짜 없음' : '오늘'}
                active={openPane === 'calendar'}
                editLabel={undated ? '날짜 선택' : '오늘 일정 변경'}
                clearLabel="오늘 기본 일정 해제"
                onEdit={toggleCalendarPane}
                onClear={undated ? undefined : () => {
                  setUndated(true);
                  input.current?.focus();
                }} />
            ) : null}

            {durationLabel ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <EditablePill
                  icon="clock"
                  label={durationLabel}
                  onEdit={toggleCalendarPane}
                  onClear={() => stripToken((token) => token.kind === 'duration')} />
              </Animated.View>
            ) : null}

            {repeat ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <EditablePill
                  icon="repeat"
                  label={repeat}
                  onEdit={toggleCalendarPane}
                  onClear={() => stripToken((token) => token.kind === 'recurrence')} />
              </Animated.View>
            ) : null}

            {reminderChipLabel ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <EditablePill
                  icon={effectiveReminder === 'off' ? 'bell-off' : 'bell'}
                  label={reminderChipLabel}
                  active={openPane === 'reminder'}
                  onEdit={() => togglePane('reminder')}
                  onClear={() => setReminderChoice(undefined)} />
              </Animated.View>
            ) : null}

            {draft?.project ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <EditablePill
                  icon="hash"
                  label={draft.project + (selectedSectionName ? ` · ${selectedSectionName}` : '') + (isNewProject ? ' · 새 목록' : '')}
                  active={openPane === 'project'}
                  editLabel={`목록 ${draft.project} 변경`}
                  clearLabel="목록 지우기"
                  onEdit={() => togglePane('project')}
                  onClear={() => stripToken((token) => token.kind === 'project')} />
              </Animated.View>
            ) : defaultProjectName ? (
              <EditablePill
                icon="hash"
                label={selectedSectionName ? `${defaultProjectName} · ${selectedSectionName}` : defaultProjectName}
                active={openPane === 'project'}
                editLabel={`기본 목록 ${defaultProjectName} 변경`}
                clearLabel="기본 목록 해제"
                onEdit={() => togglePane('project')}
                onClear={() => {
                  setClearedDefaultProject(true);
                  setChosenSectionId(null);
                  input.current?.focus();
                }} />
            ) : null}

            {draft?.tags.map((tag) => (
              <Animated.View key={tag} entering={ZoomIn.duration(140)}>
                <EditablePill
                  icon="tag"
                  label={tag}
                  active={openPane === 'tag'}
                  editLabel={`태그 ${tag} 편집`}
                  clearLabel={`태그 ${tag} 지우기`}
                  onEdit={() => togglePane('tag')}
                  onClear={() => stripToken((token) => token.kind === 'tag' && token.text.replace(/^@"?|"?$/g, '').toLowerCase() === tag.toLowerCase())} />
              </Animated.View>
            ))}

            {draft && draft.priority < 4 ? (
              <Animated.View entering={ZoomIn.duration(140)}>
                <EditablePill
                  label={priorityOption(draft.priority)}
                  active={openPane === 'priority'}
                  editLabel="우선순위 변경"
                  clearLabel="우선순위 지우기"
                  onEdit={() => togglePane('priority')}
                  onClear={() => stripToken((token) => token.kind === 'priority')} />
              </Animated.View>
            ) : null}
          </View>
        ) : null}

        {lastAdded ? (
          <Animated.View
            entering={FadeIn.duration(140)}
            exiting={FadeOut.duration(140)}
            style={[styles.undoBanner, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
            <Icon name="check" size={13} color={colors.accentText} />
            <Txt variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              방금 추가함 · {lastAdded.title}
            </Txt>
            <Pressable hitSlop={8} onPress={undoLastAdded} accessibilityRole="button" accessibilityLabel="방금 추가한 할 일 실행 취소">
              <Txt variant="caption" tone="accent" style={{ fontWeight: '700' }}>실행 취소</Txt>
            </Pressable>
          </Animated.View>
        ) : null}

        {presetItems.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={{ gap: 6 }}
            style={styles.presetRow}>
            {presetItems.map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityLabel={item.label + ' 넣기'}
                onPress={() => applyPresetChip(item.label)}
                style={({ pressed }) => [
                  styles.presetChip,
                  { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.65 : 1 },
                ]}>
                <Icon name={item.icon} size={12} color={colors.textFaint} />
                <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>{item.label}</Txt>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.actionBar}>
          <View style={styles.iconGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="일정 선택"
              accessibilityState={{ selected: openPane === 'calendar' || !!due }}
              onPress={() => {
                haptic.tap();
                toggleCalendarPane();
              }}
              style={({ pressed }) => [
                styles.barIcon,
                (openPane === 'calendar' || !!due) && { backgroundColor: colors.accentSoft },
                { opacity: pressed ? 0.65 : 1 },
              ]}>
              <Icon name="calendar" size={18} color={openPane === 'calendar' || !!due ? colors.accentText : colors.textMuted} />
            </Pressable>

            {!parent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="목록 선택"
                accessibilityState={{ selected: openPane === 'project' || !!activeProject }}
                onPress={() => togglePane('project')}
                style={({ pressed }) => [
                  styles.barIcon,
                  (openPane === 'project' || !!draft?.project) && { backgroundColor: colors.accentSoft },
                  { opacity: pressed ? 0.65 : 1 },
                ]}>
                <Icon name="hash" size={18} color={openPane === 'project' || !!draft?.project ? colors.accentText : colors.textMuted} />
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="태그 선택"
              accessibilityState={{ selected: openPane === 'tag' || !!draft?.tags.length }}
              onPress={() => togglePane('tag')}
              style={({ pressed }) => [
                styles.barIcon,
                (openPane === 'tag' || !!draft?.tags.length) && { backgroundColor: colors.accentSoft },
                { opacity: pressed ? 0.65 : 1 },
              ]}>
              <Icon name="tag" size={18} color={openPane === 'tag' || !!draft?.tags.length ? colors.accentText : colors.textMuted} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="우선순위 선택"
              accessibilityState={{ selected: openPane === 'priority' || (!!draft && draft.priority < 4) }}
              onPress={() => togglePane('priority')}
              style={({ pressed }) => [
                styles.barIcon,
                (openPane === 'priority' || (!!draft && draft.priority < 4)) && { backgroundColor: colors.accentSoft },
                { opacity: pressed ? 0.65 : 1 },
              ]}>
              <Icon name="flag" size={18} color={openPane === 'priority' || (!!draft && draft.priority < 4) ? colors.accentText : colors.textMuted} />
            </Pressable>

            {!parent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="체크리스트 모드"
                accessibilityState={{ selected: checklistMode }}
                onPress={toggleChecklistMode}
                style={({ pressed }) => [
                  styles.barIcon,
                  checklistMode && { backgroundColor: colors.accentSoft },
                  { opacity: pressed ? 0.65 : 1 },
                ]}>
                <Icon name="check-square" size={18} color={checklistMode ? colors.accentText : colors.textMuted} />
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="메모 입력"
              accessibilityState={{ selected: showNotes || !!notes.trim() }}
              onPress={() => {
                haptic.tap();
                toggleNotes();
              }}
              style={({ pressed }) => [
                styles.barIcon,
                (showNotes || !!notes.trim()) && { backgroundColor: colors.accentSoft },
                { opacity: pressed ? 0.65 : 1 },
              ]}>
              <Icon name="align-left" size={18} color={showNotes || !!notes.trim() ? colors.accentText : colors.textMuted} />
            </Pressable>

            {!parent ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="템플릿 불러오기"
                onPress={handleOpenTemplates}
                style={({ pressed }) => [styles.barIcon, { opacity: pressed ? 0.65 : 1 }]}>
                <Icon name="bookmark" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}

            {hasRawTokens ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="그대로 저장 전환"
                accessibilityState={{ selected: plainText }}
                onPress={() => {
                  haptic.tap();
                  setPlainText((on) => !on);
                  closePane();
                  input.current?.focus();
                }}
                style={({ pressed }) => [
                  styles.barIcon,
                  plainText && { backgroundColor: colors.accentSoft },
                  { opacity: pressed ? 0.65 : 1 },
                ]}>
                <Icon name="type" size={18} color={plainText ? colors.accentText : colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.sendGroup}>
            {added > 0 && !lastAdded ? (
              <Txt variant="caption" tone="muted" tabular>{added}개</Txt>
            ) : null}
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: isKeepOpenOn }}
              accessibilityLabel="계속 추가 모드"
              onPress={toggleKeepOpen}
              style={({ pressed }) => [
                styles.keepToggle,
                {
                  borderColor: isKeepOpenOn ? colors.accent : colors.border,
                  backgroundColor: isKeepOpenOn ? colors.accentSoft : 'transparent',
                  opacity: pressed ? 0.65 : 1,
                },
              ]}>
              <Icon name="plus" size={14} color={isKeepOpenOn ? colors.accentText : colors.textMuted} />
              <Txt variant="caption" tone={isKeepOpenOn ? 'accent' : 'muted'} style={{ fontWeight: '600' }}>계속</Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="할 일 추가"
              accessibilityState={{ disabled: !canSend }}
              onPress={submit}
              style={({ pressed }) => [
                styles.send,
                { backgroundColor: canSend ? colors.accent : colors.surfaceMuted, opacity: pressed ? 0.8 : 1 },
              ]}>
              <Icon name="arrow-up" size={20} color={canSend ? colors.onAccent : colors.textFaint} />
            </Pressable>
          </View>
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

/** Floating quick-add button: tap opens QuickAdd immediately; long-press opens quick actions. */
export function QuickAddFab({
  onPress, onLongPress, label = '할 일 빠른 추가', quiet = false, bottom, right,
}: {
  onPress: () => void;
  onLongPress?: () => void;
  label?: string;
  quiet?: boolean;
  bottom: number;
  right: number;
}) {
  const { colors } = useTheme();
  return (
    <Animated.View
      entering={ZoomIn.duration(160)} pointerEvents="box-none"
      style={[styles.fabWrap, { bottom, right }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={320}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: quiet ? colors.surface : colors.accent, transform: [{ scale: pressed ? 0.94 : 1 }] },
          quiet && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
          elevation(colors, 2),
        ]}>
        <Icon name="plus" size={26} color={quiet ? colors.textMuted : colors.onAccent} />
      </Pressable>
    </Animated.View>
  );
}

/** Hosts the floating add button on every signed-in screen and the entry bar it opens. */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { column, twoPane } = useLayout();
  const segments: string[] = useSegments();
  const [active, setActive] = useState<{ key: number; defaults: QuickAddDefaults } | null>(null);
  const [fabHidden, setFabHidden] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const [templatesContext, setTemplatesContext] = useState<null | { projectId?: string | null; sectionId?: string | null; dueToday?: boolean }>(null);
  const [planDayOpen, setPlanDayOpen] = useState(false);
  const screenDefaults = useRef<QuickAddDefaults | null>(null);
  const openKey = useRef(0);

  const { tasks, roots } = useTaskIndex();
  const { progress: subtaskProgress } = useSubtaskProgress();
  const overdueTasks = useMemo(
    () => (planDayOpen ? tasks.filter((t) => !t.parent_task_id && dueBucket(t) === 'overdue') : []),
    [planDayOpen, tasks],
  );

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

  const openFromMenu = (extra: Partial<QuickAddDefaults>) => {
    setFabMenuOpen(false);
    value.open({ ...(screenDefaults.current ?? {}), ...extra });
  };

  return (
    <QuickAddContext.Provider value={value}>
      {children}
      {showButton && !active ? (
        <QuickAddFab
          label={onHabits ? '습관 추가' : '할 일 빠른 추가'}
          quiet={quiet}
          bottom={insets.bottom + TAB_BAR_HEIGHT + space.lg}
          right={fabRight}
          onPress={() => {
            haptic.light();
            if (onHabits) router.push('/habit/new');
            else value.open();
          }}
          onLongPress={onHabits ? undefined : () => {
            haptic.medium();
            setFabMenuOpen(true);
          }} />
      ) : null}

      {active ? (
        <QuickAddSheet
          key={active.key}
          defaults={active.defaults}
          frame={barFrame}
          onClose={close}
          onOpenTemplates={(ctx) => setTemplatesContext(ctx)} />
      ) : null}

      <Sheet visible={fabMenuOpen} onClose={() => setFabMenuOpen(false)} title="빠른 실행">
        <Row
          icon="check-square"
          label="체크리스트 빠르게 만들기"
          detail="Enter로 항목 연속 입력"
          onPress={() => openFromMenu({ initialMode: 'checklist' })} />
        <Row
          icon="bookmark"
          label="템플릿 불러오기"
          detail="자주 쓰는 체크리스트"
          onPress={() => {
            setFabMenuOpen(false);
            const cur = screenDefaults.current;
            setTemplatesContext({
              projectId: cur?.projectId,
              sectionId: cur?.sectionId,
              dueToday: cur?.dueToday,
            });
          }} />
        <Row
          icon="layers"
          label="연속 추가 모드"
          detail="목록·태그·날짜 유지"
          onPress={() => openFromMenu({ initialKeepOpen: true })} />
        <Row
          icon="compass"
          label="오늘 하루 정리"
          detail="밀린 일정 · 추천 작업"
          onPress={() => {
            setFabMenuOpen(false);
            setPlanDayOpen(true);
          }} />
      </Sheet>

      <TemplatesSheet
        visible={templatesContext !== null}
        onClose={() => setTemplatesContext(null)}
        projectId={templatesContext?.projectId}
        sectionId={templatesContext?.sectionId}
        dueToday={templatesContext?.dueToday} />

      <PlanDaySheet
        visible={planDayOpen}
        onClose={() => setPlanDayOpen(false)}
        overdue={overdueTasks}
        allOpen={tasks}
        openRoots={roots}
        subtaskProgress={subtaskProgress} />
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
  topPill: {
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
  checklistBox: {
    marginTop: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8, gap: 6,
  },
  checklistHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  checklistChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 26,
    borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
  },
  multiBox: {
    marginTop: space.sm, borderRadius: radius.md, padding: space.md, gap: space.sm,
  },
  paneBox: {
    marginTop: space.sm, borderRadius: radius.md, padding: space.sm, gap: space.xs,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm },
  editablePill: {
    flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, height: 30, overflow: 'hidden',
  },
  editablePillMain: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8, paddingRight: 6, height: '100%',
  },
  editablePillClose: {
    paddingRight: 7, paddingLeft: 2, height: '100%', justifyContent: 'center', alignItems: 'center',
  },
  undoBanner: {
    marginTop: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  presetRow: {
    marginTop: space.sm,
  },
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: 10, height: 28,
  },
  actionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs, marginTop: space.sm,
  },
  iconGroup: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 1,
  },
  barIcon: {
    flex: 1, maxWidth: 36, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
  },
  sendGroup: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  keepToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 3, height: 34, paddingHorizontal: 9,
    borderRadius: radius.pill, borderWidth: 1,
  },
  keyboardHint: { marginTop: space.sm },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.sm, paddingHorizontal: 10, height: 30,
  },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  fabWrap: { position: 'absolute' },
  fab: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
});
