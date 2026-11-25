import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, type TextStyle, TextInput, type TextInputInstance, View } from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { Button, Chip, EmptyState, Icon, IconButton, Loading, Row, Screen, Sheet, Txt } from '@/components/ui';
import {
  attachTagByName, nextDueAfterComplete, nextPosition, useProjects, useSections, useSubtaskProgress, useTags, useTaskIndex, useTaskTags,
} from '@/data/tasks';
import { AiBreakdownSheet } from '@/features/ai';
import { KEY_PRIORITY, matchesCombo, useKeyboard, useKeyHandler, useScreenContext, useScreenFocused } from '@/features/keyboard';
import { reminderSummary } from '@/features/reminders/lead';
import { TaskReminderPicker } from '@/features/reminders/ReminderChips';
import { useReminderOverrides } from '@/features/reminders/overrides';
import { useReminderSettings } from '@/features/reminders/settings';
import { useProjectMetaMap } from '@/features/tasks/projectMeta';
import { priorityA11y, priorityLabel, priorityMark } from '@/features/tasks/priority';
import { RepeatSheet, repeatPatch } from '@/features/tasks/RepeatSheet';
import { ScheduleSheet } from '@/features/tasks/ScheduleSheet';
import { TaskList } from '@/features/tasks/TaskList';
import { saveCustomTemplate } from '@/features/tasks/templates';
import { toMarkdownChecklist, useTaskFlow } from '@/features/tasks/useTaskFlow';
import { errorMessage } from '@/lib/api';
import { describeRecurrence, deviceTimeZone, formatDue, formatDurationMinutes, isPastDue, Temporal } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import { analyzeTask, type Priority, type RecurrenceMode, type Task, type TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, type, useTheme } from '@/theme';

const priorities: { value: Priority; label: string }[] = ([1, 2, 3, 4] as Priority[]).map((value) => ({ value, label: priorityLabel(value) }));

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { byId, isLoading } = useTaskIndex();
  const task = byId.get(id);
  // Completing or deleting from here removes the task before the screen has finished closing;
  // show a blank page for that moment instead of a "not found" message.
  const [seen, setSeen] = useState(false);
  if (task && !seen) setSeen(true);
  if (isLoading) return <Screen><Loading /></Screen>;
  if (!task && seen) return <Screen>{null}</Screen>;
  if (!task) {
    return (
      <Screen>
        <EmptyState
          icon="check-circle" title="이미 없어진 할 일입니다" message="완료 처리했거나 삭제된 할 일입니다."
          action={<Button label="돌아가기" kind="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }
  // Keyed by task so the text fields start fresh for each task and are never overwritten while typing.
  return <TaskEditor key={task.id} task={task} />;
}

type ModalKind = null | 'schedule' | 'duration' | 'repeat' | 'reminder' | 'priority' | 'project' | 'tags' | 'more' | 'breakdown';

const durationPresets = [15, 30, 45, 60, 90, 120, 180] as const;

function shortStamp(iso: string, zone: string): string {
  const dt = Temporal.Instant.from(iso).toZonedDateTimeISO(zone);
  return `${dt.year}.${String(dt.month).padStart(2, '0')}.${String(dt.day).padStart(2, '0')}`;
}

function TaskEditor({ task }: { task: Task }) {
  const { colors } = useTheme();
  const isFocused = useScreenFocused();
  useScreenContext('task-detail', isFocused);
  const { blurActiveInput } = useKeyboard();
  const { byId, children } = useTaskIndex();
  const { completedChildren } = useSubtaskProgress();
  const { data: projects } = useProjects();
  const projectMeta = useProjectMetaMap();
  const { data: sections } = useSections();
  const { data: tags } = useTags();
  const { data: links } = useTaskTags();
  const reminderSettings = useReminderSettings();
  const reminderOverrides = useReminderOverrides();
  const flow = useTaskFlow();

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [subtaskText, setSubtaskText] = useState('');
  const [subtaskPlain, setSubtaskPlain] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [sheet, setSheet] = useState<ModalKind>(null);
  const [showCompletedSubs, setShowCompletedSubs] = useState(true);
  const [done, setDone] = useState(false);
  const titleInput = useRef<TextInputInstance>(null);
  const notesInput = useRef<TextInputInstance>(null);
  const subtaskInput = useRef<TextInputInstance>(null);
  // Prevents unmount auto-save from firing a stale PATCH after the user explicitly deleted or completed a one-off task.
  const skipSave = useRef(false);

  const parent = task.parent_task_id ? byId.get(task.parent_task_id) : undefined;
  const subtasks = children.get(task.id) ?? [];
  const completedSubtasks = completedChildren.get(task.id) ?? [];
  const totalSubtasks = subtasks.length + completedSubtasks.length;

  const attachedIds = new Set((links ?? []).filter((link) => link.task_id === task.id).map((link) => link.tag_id));
  const attachedTags = (tags ?? []).filter((tag) => attachedIds.has(tag.id));
  const projectName = task.project_id ? projects?.find((item) => item.id === task.project_id)?.name : undefined;
  const projMeta = task.project_id ? projectMeta[task.project_id] : undefined;
  const sectionName = task.section_id ? sections?.find((item) => item.id === task.section_id)?.name : undefined;
  const due = formatDue(task);
  const repeat = describeRecurrence(task.recurrence_rule, task.recurrence_mode);
  const durationLabel = task.duration_minutes ? formatDurationMinutes(task.duration_minutes) : null;
  const nextRepeatPreview = useMemo(() => {
    if (!task.recurrence_rule) return null;
    const next = nextDueAfterComplete(task);
    return next ? formatDue({ due_at: next, timezone: task.timezone, all_day: task.all_day }) : null;
  }, [task]);

  const subtaskPreview = useMemo(() => {
    const raw = subtaskText.trim();
    if (!raw || subtaskPlain) return null;
    try {
      const tz = deviceTimeZone();
      const { task: parsed, tokens } = analyzeTask({ text: raw, timezone: tz });
      if (!parsed.title || tokens.length === 0) return null;
      const summary = [
        parsed.due_at ? formatDue({ due_at: parsed.due_at, timezone: tz, all_day: parsed.all_day }) : null,
        parsed.duration_minutes ? formatDurationMinutes(parsed.duration_minutes) : null,
        parsed.priority < 4 ? 'P' + parsed.priority : null,
      ].filter(Boolean).join(' · ');
      return summary ? { parsed, summary } : null;
    } catch {
      return null;
    }
  }, [subtaskText, subtaskPlain]);

  // Compact reminder summary for the metadata pill.
  const { label: reminderLabel, off: reminderOff } = reminderSummary(reminderOverrides.tasks[task.id], reminderSettings, task.all_day);

  const saveTitle = () => {
    if (skipSave.current) return;
    const next = title.trim();
    if (next && next !== task.title) flow.update(task.id, { title: next });
    else setTitle(task.title);
  };
  const saveNotes = () => {
    if (skipSave.current) return;
    if (notes !== (task.notes ?? '')) flow.update(task.id, { notes: notes.trim() ? notes : null });
  };
  // Leaving the screen does not blur a focused field on a phone, so unsaved text is also saved on the way out.
  const unsaved = useRef({ title, notes, task, update: flow.update });
  useEffect(() => {
    unsaved.current = { title, notes, task, update: flow.update };
  });
  useEffect(() => () => {
    if (skipSave.current) return;
    const { title: lastTitle, notes: lastNotes, task: last, update } = unsaved.current;
    const patch: TaskPatch = {};
    if (lastTitle.trim() && lastTitle.trim() !== last.title) patch.title = lastTitle.trim();
    if (lastNotes !== (last.notes ?? '')) patch.notes = lastNotes.trim() ? lastNotes : null;
    if (Object.keys(patch).length) update(last.id, patch);
  }, []);

  const addSubtask = () => {
    const raw = subtaskText.trim();
    if (!raw) return;
    const timezone = deviceTimeZone();
    let input: Parameters<typeof flow.create>[0]['input'] = {
      title: raw, priority: 4, timezone, position: nextPosition(subtasks), parent_task_id: task.id,
    };
    let tagNames: string[] = [];
    if (!subtaskPlain) {
      try {
        const { task: parsed } = analyzeTask({ text: raw, timezone });
        if (parsed.title) {
          input = {
            title: parsed.title, priority: parsed.priority, timezone, position: nextPosition(subtasks),
            parent_task_id: task.id,
            ...(parsed.due_at ? { due_at: parsed.due_at, all_day: parsed.all_day } : {}),
            ...(parsed.recurrence_rule ? { recurrence_rule: parsed.recurrence_rule, recurrence_mode: parsed.recurrence_mode } : {}),
            ...(parsed.recurrence_local_time ? { recurrence_local_time: parsed.recurrence_local_time } : {}),
            ...(parsed.duration_minutes ? { duration_minutes: parsed.duration_minutes } : {}),
          };
          tagNames = parsed.tags;
        }
      } catch {
        // Plain title fallback when the text is not a special schedule phrase.
      }
    }
    flow.create({ input, projectName: null, tagNames });
    haptic.success();
    setSubtaskText('');
    setSubtaskPlain(false);
    subtaskInput.current?.focus();
  };

  const applyRepeat = (rule: string | null, mode: RecurrenceMode) => {
    setSheet(null);
    const patch = repeatPatch(task, rule, mode);
    if (!patch) return;
    flow.update(task.id, patch);
    if (rule) haptic.tap();
  };

  const applyDuration = (minutes: number | null) => {
    haptic.tap();
    flow.update(task.id, { duration_minutes: minutes });
  };

  const addTag = async () => {
    const name = newTag.trim().replace(/^@/, '');
    if (!name) return;
    setNewTag('');
    try {
      await attachTagByName(task.id, name);
    } catch (error) {
      showToast(errorMessage(error), { tone: 'error' });
    }
  };

  const complete = () => {
    if (done) return;
    if (!task.recurrence_rule) skipSave.current = true;
    setDone(true);
    setTimeout(() => {
      flow.complete(task);
      if (task.recurrence_rule) setDone(false);
      else router.back();
    }, 240);
  };

  const saveAsTemplate = () => {
    const items = [...subtasks, ...completedSubtasks].map((sub) => sub.title);
    saveCustomTemplate({
      title: title.trim() || task.title,
      icon: 'check-square',
      notes: notes.trim() || undefined,
      priority: task.priority,
      items,
    });
    setSheet(null);
    haptic.success();
    showToast(`‘${title.trim() || task.title}’${josa(title.trim() || task.title, '을/를')} 체크리스트 템플릿으로 저장했습니다.`);
  };

  const copyMarkdown = () => {
    setSheet(null);
    const md = toMarkdownChecklist(task, subtasks, completedSubtasks);
    void Clipboard.setStringAsync(md)
      .then(() => showToast('체크리스트를 복사했습니다.'))
      .catch(() => {});
  };

  const openFocus = () => router.navigate({
    pathname: '/focus',
    params: {
      taskId: task.id, at: String(Date.now()),
      ...(task.duration_minutes ? { duration: String(task.duration_minutes) } : {}),
    },
  });

  const duplicateTask = () => {
    setSheet(null);
    flow.duplicate(task, { openSubtasks: subtasks, completedSubtasks, tagNames: attachedTags.map((t) => t.name) });
  };

  const deleteTask = () => {
    skipSave.current = true;
    setSheet(null);
    flow.remove(task);
    router.back();
  };

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'mod+enter')) {
        if (event.editing) {
          saveTitle();
          saveNotes();
          blurActiveInput();
        } else if (!event.repeat) {
          complete();
        }
        return true;
      }
      if (matchesCombo(event, 'escape')) {
        if (event.repeat) return true;
        if (event.editing) {
          saveTitle();
          saveNotes();
          blurActiveInput();
        } else {
          router.back();
        }
        return true;
      }
      if (event.editing) return false;

      if (matchesCombo(event, 'e')) {
        titleInput.current?.focus();
        return true;
      }
      if (matchesCombo(event, 'shift+e')) {
        notesInput.current?.focus();
        return true;
      }
      if (matchesCombo(event, 'a')) {
        subtaskInput.current?.focus();
        return true;
      }
      if (matchesCombo(event, 'x') || matchesCombo(event, 'space')) {
        if (!event.repeat) complete();
        return true;
      }
      if (matchesCombo(event, 's') || matchesCombo(event, 'd')) {
        setSheet('schedule');
        return true;
      }
      if (matchesCombo(event, 'p')) {
        setSheet('priority');
        return true;
      }
      if (event.shift && !event.ctrl && !event.alt && !event.meta && ['1', '2', '3', '4'].includes(event.key)) {
        haptic.tap();
        flow.update(task.id, { priority: Number(event.key) as Priority });
        return true;
      }
      if (matchesCombo(event, 'l')) {
        if (!parent) {
          setSheet('project');
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 't')) {
        setSheet('tags');
        return true;
      }
      if (matchesCombo(event, 'r')) {
        if (repeat || due) {
          setSheet('repeat');
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'u')) {
        setSheet('duration');
        return true;
      }
      if (matchesCombo(event, 'f')) {
        if (!event.repeat) openFocus();
        return true;
      }
      if (matchesCombo(event, 'm')) {
        setSheet('more');
        return true;
      }
      if (matchesCombo(event, 'delete')) {
        if (!event.repeat) {
          skipSave.current = true;
          flow.remove(task);
          router.back();
        }
        return true;
      }
      if (matchesCombo(event, 'backspace')) {
        if (!event.repeat) router.back();
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.screen, enabled: isFocused && sheet === null },
  );

  useKeyHandler(
    (event) => {
      if (event.editing) return false;
      if (sheet === 'priority') {
        if (!event.ctrl && !event.alt && !event.meta && !event.shift && ['1', '2', '3', '4'].includes(event.key)) {
          haptic.tap();
          flow.update(task.id, { priority: Number(event.key) as Priority });
          setSheet(null);
          return true;
        }
        return false;
      }
      if (sheet === 'duration') {
        if (matchesCombo(event, '-')) {
          applyDuration(task.duration_minutes === null ? 15 : Math.max(5, task.duration_minutes - 5));
          return true;
        }
        if (matchesCombo(event, '+') || matchesCombo(event, '=')) {
          applyDuration(task.duration_minutes === null ? 15 : Math.min(1440, task.duration_minutes + 5));
          return true;
        }
        if (matchesCombo(event, '0')) {
          applyDuration(null);
          return true;
        }
        if (matchesCombo(event, 'enter')) {
          if (!event.repeat) setSheet(null);
          return true;
        }
        return false;
      }
      if (sheet === 'more') {
        if (matchesCombo(event, 'c')) {
          if (!event.repeat) copyMarkdown();
          return true;
        }
        if (matchesCombo(event, 'd')) {
          if (!event.repeat) duplicateTask();
          return true;
        }
        if (matchesCombo(event, 'delete')) {
          if (!event.repeat) deleteTask();
          return true;
        }
        return false;
      }
      return false;
    },
    { priority: KEY_PRIORITY.sheet, enabled: isFocused && (sheet === 'priority' || sheet === 'duration' || sheet === 'more') },
  );

  return (
    <Screen>
      <View style={styles.bar}>
        <IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />
        {parent ? (
          <Pressable
            accessibilityRole="button" accessibilityLabel={'상위 할 일 ' + parent.title + ' 열기'}
            onPress={() => router.replace({ pathname: '/task/[id]', params: { id: parent.id } })}
            style={({ pressed }) => [styles.crumb, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="corner-left-up" size={14} color={colors.textMuted} />
            <Txt variant="smallStrong" tone="muted" numberOfLines={1}>{parent.title}</Txt>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button" accessibilityLabel="목록·섹션 바꾸기"
            onPress={() => setSheet('project')}
            style={({ pressed }) => [styles.crumb, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name={projectName ? (projMeta?.icon ?? 'hash') : 'inbox'} size={14} color={colors.textFaint} />
            <Txt variant="smallStrong" tone="muted" numberOfLines={1}>
              {projectName ? (sectionName ? `${projectName} · ${sectionName}` : projectName) : '미분류'}
            </Txt>
            <Icon name="chevron-down" size={13} color={colors.textFaint} />
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button" accessibilityLabel={priorityA11y(task.priority)}
          onPress={() => setSheet('priority')} hitSlop={8}
          style={({ pressed }) => [styles.priorityBtn, { opacity: pressed ? 0.6 : 1 }]}>
          {task.priority < 4 ? (
            <>
              <Txt variant="bodyStrong" style={{ fontWeight: '700' }}>{priorityMark(task.priority)}</Txt>
              <Txt variant="caption" tone="muted">{priorityLabel(task.priority)}</Txt>
            </>
          ) : <Icon name="flag" size={17} color={colors.textMuted} />}
        </Pressable>
        <IconButton
          name="clock" label="이 할 일로 집중 시작" color={colors.textMuted}
          onPress={openFocus} />
        <IconButton name="more-horizontal" label="더 보기" color={colors.textMuted} onPress={() => setSheet('more')} />
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: space.xxl * 2 }} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.titleRow}>
              <View style={{ paddingTop: 4 }}>
                <Checkbox checked={done} size={24} onPress={complete} label="완료" />
              </View>
              <TextInput
                ref={titleInput}
                value={title} onChangeText={setTitle} onBlur={saveTitle} multiline submitBehavior="blurAndSubmit" maxLength={500}
                accessibilityLabel="제목" placeholder="제목" placeholderTextColor={colors.textFaint}
                style={[type.heading, { flex: 1, color: colors.text, padding: 0, textAlignVertical: 'top' }]} />
            </View>
            <TextInput
              ref={notesInput}
              value={notes} onChangeText={setNotes} onBlur={saveNotes} multiline maxLength={10000}
              placeholder="메모 추가" placeholderTextColor={colors.textFaint} accessibilityLabel="메모"
              style={[type.body, styles.notes, { color: colors.textMuted }]} />
          </View>

          <View style={[styles.pills, { borderBottomColor: colors.border }]}>
            <Chip
              icon="calendar" label={due ?? '일정'}
              tone={!due ? undefined : isPastDue(task) ? 'danger' : 'set'}
              onPress={() => setSheet('schedule')} />
            <Chip
              icon="clock" label={durationLabel ?? '소요 시간'}
              tone={durationLabel ? 'set' : undefined}
              onPress={() => setSheet('duration')} />
            {repeat || due ? (
              <Chip
                icon="repeat" label={repeat ?? '반복'} tone={repeat ? 'set' : undefined} onPress={() => setSheet('repeat')} />
            ) : null}
            {Platform.OS === 'android' && task.due_at ? (
              <Chip
                icon={reminderOff ? 'bell-off' : 'bell'} label={reminderLabel}
                onPress={() => setSheet('reminder')} />
            ) : null}
            {attachedTags.map((tag) => (
              <Chip key={tag.id} label={'#' + tag.name} tone="set" onPress={() => setSheet('tags')} />
            ))}
            <Chip icon="tag" label={attachedTags.length ? '+' : '태그'} onPress={() => setSheet('tags')} />
            {nextRepeatPreview ? (
              <View style={styles.nextRepeatRow}>
                <Icon name="corner-down-right" size={12} color={colors.textFaint} />
                <Txt variant="caption" tone="faint">
                  완료하면 다음 일정은 {nextRepeatPreview}
                </Txt>
              </View>
            ) : null}
          </View>

          <View style={styles.subtaskHeader}>
            <Txt variant="section" tone="muted">하위 작업</Txt>
            {totalSubtasks ? (
              <Txt variant="smallStrong" tone="faint">
                {completedSubtasks.length}/{totalSubtasks}
              </Txt>
            ) : null}
            <View style={{ flex: 1 }} />
            {completedSubtasks.length > 0 ? (
              <Pressable
                accessibilityRole="button" accessibilityLabel="완료한 하위 작업 체크 모두 해제" hitSlop={8}
                onPress={() => {
                  haptic.tap();
                  flow.resetChecklist(completedSubtasks);
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}>
                <Icon name="rotate-ccw" size={12} color={colors.accentText} />
                <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>체크 해제</Txt>
              </Pressable>
            ) : subtasks.length > 1 ? (
              <Txt variant="caption" tone="faint">길게 눌러 순서 변경</Txt>
            ) : null}
          </View>

          {subtasks.length ? <TaskList tasks={subtasks} sortable /> : null}

          <View style={[styles.inlineAdd, { borderBottomColor: colors.border }]}>
            <Icon name="plus" size={18} color={colors.textMuted} />
            <TextInput
              ref={subtaskInput} value={subtaskText}
              onChangeText={(next) => {
                setSubtaskText(next);
                if (!next) setSubtaskPlain(false);
              }}
              placeholder="하위 작업 추가" placeholderTextColor={colors.textFaint}
              returnKeyType="done" submitBehavior="submit" onSubmitEditing={addSubtask}
              maxLength={500} accessibilityLabel="하위 작업 추가"
              style={[type.body, { flex: 1, color: colors.text, paddingVertical: 12 }]} />
            {subtaskText.trim() ? (
              <Pressable
                accessibilityRole="button" accessibilityLabel="하위 작업 저장" onPress={addSubtask} hitSlop={8}
                style={({ pressed }) => [styles.inlineSend, { backgroundColor: colors.accent, opacity: pressed ? 0.7 : 1 }]}>
                <Icon name="arrow-up" size={16} color={colors.onAccent} />
              </Pressable>
            ) : null}
          </View>
          {subtaskPreview ? (
            <View style={[styles.subPreview, { backgroundColor: colors.surfaceMuted }]}>
              <Txt variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                자동 인식 · {subtaskPreview.summary}
              </Txt>
              <Pressable hitSlop={8} onPress={() => setSubtaskPlain(true)}>
                <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>그대로 입력</Txt>
              </Pressable>
            </View>
          ) : null}

          {completedSubtasks.length > 0 ? (
            <View style={{ marginTop: space.md }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`완료한 하위 작업 ${completedSubtasks.length}개 ${showCompletedSubs ? '접기' : '펼치기'}`}
                onPress={() => {
                  haptic.tap();
                  setShowCompletedSubs((open) => !open);
                }}
                style={({ pressed }) => [styles.completedToggle, { opacity: pressed ? 0.6 : 1 }]}>
                <Icon name={showCompletedSubs ? 'chevron-down' : 'chevron-right'} size={15} color={colors.textFaint} />
                <Txt variant="smallStrong" tone="muted">완료한 작업 {completedSubtasks.length}</Txt>
              </Pressable>
              {showCompletedSubs ? completedSubtasks.map((sub) => (
                <View key={sub.id} style={styles.completedSubRow}>
                  <Checkbox
                    checked done size={20}
                    onPress={() => {
                      haptic.tap();
                      flow.reopen(sub);
                    }}
                    label={sub.title + ' 완료 취소'} />
                  <View style={[styles.completedSubBody, { borderBottomColor: colors.border }]}>
                    <Text numberOfLines={2} style={[type.body as TextStyle, { color: colors.textFaint, textDecorationLine: 'line-through', flex: 1 }]}>
                      {sub.title}
                    </Text>
                    <IconButton
                      name="trash-2" label={sub.title + ' 삭제'} size={15} color={colors.textFaint}
                      onPress={() => flow.remove(sub)} style={{ width: 32, height: 32 }} />
                  </View>
                </View>
              )) : null}
            </View>
          ) : null}

          <View style={styles.footerMeta}>
            <Txt variant="caption" tone="faint">
              {shortStamp(task.created_at, task.timezone)} 추가 · {shortStamp(task.updated_at, task.timezone)} 수정
            </Txt>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ScheduleSheet task={sheet === 'schedule' ? task : null} onClose={() => setSheet(null)} onPick={flow.reschedule} />
      <RepeatSheet
        visible={sheet === 'repeat'} currentRule={task.recurrence_rule} currentMode={task.recurrence_mode}
        onClose={() => setSheet(null)} onSelect={applyRepeat} />

      <Sheet visible={sheet === 'duration'} onClose={() => setSheet(null)} title="예상 소요 시간">
        <View style={{ gap: space.md }}>
          <Txt variant="small" tone="muted">
            타임라인에 이 시간만큼 표시되고, 집중 타이머도 이 시간으로 맞춰집니다.
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Chip
              icon="slash" label="없음" selected={task.duration_minutes === null}
              onPress={() => {
                applyDuration(null);
                setSheet(null);
              }} />
            {durationPresets.map((mins) => (
              <Chip
                key={mins} icon="clock" label={formatDurationMinutes(mins)} selected={task.duration_minutes === mins}
                onPress={() => {
                  applyDuration(mins);
                  setSheet(null);
                }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Txt variant="bodyStrong" style={{ flex: 1 }}>직접 조정</Txt>
            <IconButton
              name="minus" label="5분 줄이기" size={18}
              onPress={() => applyDuration(task.duration_minutes === null ? 15 : Math.max(5, task.duration_minutes - 5))}
              style={{ backgroundColor: colors.surfaceMuted, width: 36, height: 36 }} />
            <Txt variant="bodyStrong" tone={task.duration_minutes === null ? 'faint' : 'default'} style={{ minWidth: 82, textAlign: 'center' }}>
              {task.duration_minutes !== null ? formatDurationMinutes(task.duration_minutes) : '없음'}
            </Txt>
            <IconButton
              name="plus" label="5분 늘리기" size={18}
              onPress={() => applyDuration(task.duration_minutes === null ? 15 : Math.min(1440, task.duration_minutes + 5))}
              style={{ backgroundColor: colors.surfaceMuted, width: 36, height: 36 }} />
          </View>
          <Button label="완료" onPress={() => setSheet(null)} />
        </View>
      </Sheet>

      <Sheet visible={sheet === 'reminder'} onClose={() => setSheet(null)} title="알림">
        <TaskReminderPicker
          taskId={task.id} allDay={task.all_day} dueAt={task.due_at} timezone={task.timezone}
          repeats={!!task.recurrence_rule} onPicked={() => setSheet(null)} />
      </Sheet>

      <Sheet visible={sheet === 'priority'} onClose={() => setSheet(null)} title="우선순위">
        {priorities.map((item) => {
          const active = task.priority === item.value;
          return (
            <Pressable
              key={item.value} accessibilityRole="button" accessibilityLabel={item.label}
              onPress={() => {
                haptic.tap();
                flow.update(task.id, { priority: item.value });
                setSheet(null);
              }}
              style={({ pressed }) => [styles.sheetRow, { opacity: pressed ? 0.6 : 1 }]}>
              <Txt style={styles.markCell}>{priorityMark(item.value)}</Txt>
              <Txt style={{ flex: 1 }}>{item.label}</Txt>
              {active ? <Icon name="check" size={18} color={colors.accentText} /> : null}
            </Pressable>
          );
        })}
      </Sheet>

      <Sheet visible={sheet === 'project'} onClose={() => setSheet(null)} title="목록 · 섹션">
        <ScrollView style={{ maxHeight: 380 }}>
          <Row
            icon="inbox" label="미분류"
            trailing={!task.project_id ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
            onPress={() => {
              flow.update(task.id, { project_id: null, section_id: null });
              setSheet(null);
            }} />
          {(projects ?? []).map((project) => {
            const projSections = (sections ?? []).filter((s) => s.project_id === project.id);
            const meta = projectMeta[project.id];
            return (
              <View key={project.id}>
                <Row
                  icon={meta?.icon ?? 'hash'} label={project.name}
                  trailing={task.project_id === project.id && !task.section_id ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
                  onPress={() => {
                    flow.update(task.id, { project_id: project.id, section_id: null });
                    setSheet(null);
                  }} />
                {projSections.map((section) => (
                  <View key={section.id} style={{ paddingLeft: space.xl }}>
                    <Row
                      icon="bookmark" label={section.name}
                      trailing={task.section_id === section.id ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
                      onPress={() => {
                        flow.update(task.id, { project_id: project.id, section_id: section.id });
                        setSheet(null);
                      }} />
                  </View>
                ))}
              </View>
            );
          })}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === 'tags'} onClose={() => setSheet(null)} title="태그">
        <View style={{ gap: space.md }}>
          {tags?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {tags.map((tag) => {
                const on = attachedIds.has(tag.id);
                return (
                  <Chip
                    key={tag.id} icon="tag" label={tag.name} selected={on}
                    onPress={() => flow.setTags({ taskId: task.id, attach: on ? [] : [tag.id], detach: on ? [tag.id] : [] })} />
                );
              })}
            </View>
          ) : <Txt variant="small" tone="muted">아직 등록된 태그가 없습니다. 아래에서 새 태그를 추가해 보세요.</Txt>}
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <TextInput
              value={newTag} onChangeText={setNewTag} placeholder="새 태그 이름" placeholderTextColor={colors.textFaint} maxLength={120}
              autoCapitalize="none" returnKeyType="done" onSubmitEditing={addTag} accessibilityLabel="새 태그 이름"
              style={[type.body, styles.tagInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, flex: 1 }]} />
            <Button label="추가" kind="secondary" onPress={addTag} disabled={!newTag.trim()} style={{ minHeight: 46 }} />
          </View>
        </View>
      </Sheet>

      <Sheet visible={sheet === 'more'} onClose={() => setSheet(null)} title="더 보기">
        <Row
          icon="copy" label="할 일 복제" detail={totalSubtasks > 0 ? `하위 작업 ${totalSubtasks}개 포함` : undefined}
          onPress={duplicateTask} />
        {task.parent_task_id ? null : (
          // Swapping `sheet` closes 더 보기 as AI로 쪼개기 opens, so the two never stack.
          <Row icon="layers" label="AI로 쪼개기" onPress={() => setSheet('breakdown')} />
        )}
        <Row icon="clipboard" label="체크리스트 복사" onPress={copyMarkdown} />
        <Row
          icon="bookmark" label="체크리스트 템플릿으로 저장" detail="다음에도 바로 불러오기"
          onPress={saveAsTemplate} />
        {completedSubtasks.length > 0 ? (
          <Row
            icon="rotate-ccw" label="하위 작업 체크 모두 해제"
            onPress={() => {
              setSheet(null);
              flow.resetChecklist(completedSubtasks);
            }} />
        ) : null}
        <Row
          icon="trash-2" label="할 일 삭제" tone="danger"
          onPress={deleteTask} />
      </Sheet>
      {sheet === 'breakdown' ? <AiBreakdownSheet task={task} visible onClose={() => setSheet(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, minHeight: 48, gap: 2 },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: space.sm, paddingVertical: 6, maxWidth: 200 },
  priorityBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingHorizontal: 8 },
  markCell: { width: 28, fontWeight: '700' },
  hero: { paddingHorizontal: space.lg, paddingTop: space.xs, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  notes: { paddingLeft: 36, paddingVertical: 2, minHeight: 28, textAlignVertical: 'top' },
  pills: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nextRepeatRow: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 2,
  },
  subtaskHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: 6,
  },
  inlineAdd: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inlineSend: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  subPreview: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginTop: 6, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.sm,
  },
  completedToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingVertical: space.sm,
  },
  completedSubRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg,
  },
  completedSubBody: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 10, paddingRight: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  footerMeta: {
    paddingHorizontal: space.lg, paddingTop: space.xl, alignItems: 'center',
  },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  tagInput: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
});
