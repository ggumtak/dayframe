import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, type TextStyle, TextInput, type TextInputInstance, View } from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { Button, Chip, EmptyState, Icon, IconButton, Loading, ProgressBar, Row, Screen, Sheet, Txt } from '@/components/ui';
import { attachTagByName, nextPosition, useProjects, useSections, useSubtaskProgress, useTags, useTaskIndex, useTaskTags } from '@/data/tasks';
import { TaskReminderChips } from '@/features/reminders/ReminderChips';
import { useReminderOverrides } from '@/features/reminders/overrides';
import { useReminderSettings } from '@/features/reminders/settings';
import { RepeatSheet } from '@/features/tasks/RepeatSheet';
import { ScheduleSheet } from '@/features/tasks/ScheduleSheet';
import { TaskList } from '@/features/tasks/TaskList';
import { saveCustomTemplate } from '@/features/tasks/templates';
import { localTimeString, toMarkdownChecklist, useTaskFlow } from '@/features/tasks/useTaskFlow';
import { errorMessage } from '@/lib/api';
import { describeRecurrence, deviceTimeZone, dueBucket, dueMinutes, formatDue, formatDurationMinutes, instantFor, isPastDue, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { analyzeTask, type Priority, type RecurrenceMode, type Task, type TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { priorityColor, radius, space, type, useTheme } from '@/theme';

const priorities: { value: Priority; label: string }[] = [
  { value: 1, label: 'P1 · 긴급' },
  { value: 2, label: 'P2 · 높음' },
  { value: 3, label: 'P3 · 보통' },
  { value: 4, label: 'P4 · 없음' },
];

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
          icon="check-circle" title="할 일을 찾을 수 없습니다" message="이미 완료했거나 삭제된 항목입니다."
          action={<Button label="돌아가기" kind="secondary" onPress={() => router.back()} />} />
      </Screen>
    );
  }
  // Keyed by task so the text fields start fresh for each task and are never overwritten while typing.
  return <TaskEditor key={task.id} task={task} />;
}

type ModalKind = null | 'schedule' | 'duration' | 'repeat' | 'reminder' | 'priority' | 'project' | 'tags' | 'more';

const durationPresets = [15, 30, 45, 60, 90, 120, 180] as const;

function TaskEditor({ task }: { task: Task }) {
  const { colors } = useTheme();
  const { byId, children } = useTaskIndex();
  const { completedChildren } = useSubtaskProgress();
  const { data: projects } = useProjects();
  const { data: sections } = useSections();
  const { data: tags } = useTags();
  const { data: links } = useTaskTags();
  const reminderSettings = useReminderSettings();
  const reminderOverrides = useReminderOverrides();
  const flow = useTaskFlow();

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [subtaskText, setSubtaskText] = useState('');
  const [newTag, setNewTag] = useState('');
  const [sheet, setSheet] = useState<ModalKind>(null);
  const [showCompletedSubs, setShowCompletedSubs] = useState(true);
  const [done, setDone] = useState(false);
  const subtaskInput = useRef<TextInputInstance>(null);

  const parent = task.parent_task_id ? byId.get(task.parent_task_id) : undefined;
  const subtasks = children.get(task.id) ?? [];
  const completedSubtasks = completedChildren.get(task.id) ?? [];
  const totalSubtasks = subtasks.length + completedSubtasks.length;
  const subRatio = totalSubtasks > 0 ? completedSubtasks.length / totalSubtasks : 0;

  const attachedIds = new Set((links ?? []).filter((link) => link.task_id === task.id).map((link) => link.tag_id));
  const attachedTags = (tags ?? []).filter((tag) => attachedIds.has(tag.id));
  const projectName = task.project_id ? projects?.find((item) => item.id === task.project_id)?.name : undefined;
  const sectionName = task.section_id ? sections?.find((item) => item.id === task.section_id)?.name : undefined;
  const due = formatDue(task);
  const repeat = describeRecurrence(task.recurrence_rule, task.recurrence_mode);
  const durationLabel = task.duration_minutes ? formatDurationMinutes(task.duration_minutes) : null;

  // Compact reminder summary for the metadata pill.
  const ownReminder = reminderOverrides.tasks[task.id];
  const reminderOff = !reminderSettings.enabled || ownReminder === 'off' || (task.all_day && reminderSettings.allDayHour === null);
  const reminderLabel = !reminderSettings.enabled ? '알림 꺼짐'
    : ownReminder === 'off' ? '알림 끄기'
      : task.all_day ? (reminderSettings.allDayHour === null ? '알림 없음' : `오전 ${reminderSettings.allDayHour}시`)
        : (() => {
          const lead = typeof ownReminder === 'number' ? ownReminder : reminderSettings.leadMinutes;
          return lead === 0 ? '정시 알림' : lead === 60 ? '1시간 전' : `${lead}분 전`;
        })();

  const saveTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) flow.update(task.id, { title: next });
    else setTitle(task.title);
  };
  const saveNotes = () => {
    if (notes !== (task.notes ?? '')) flow.update(task.id, { notes: notes.trim() ? notes : null });
  };
  // Leaving the screen does not blur a focused field on a phone, so unsaved text is also saved on the way out.
  const unsaved = useRef({ title, notes, task, update: flow.update });
  useEffect(() => {
    unsaved.current = { title, notes, task, update: flow.update };
  });
  useEffect(() => () => {
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
    flow.create({ input, projectName: null, tagNames });
    haptic.success();
    setSubtaskText('');
    subtaskInput.current?.focus();
  };

  const applyRepeat = (rule: string | null, mode: RecurrenceMode) => {
    setSheet(null);
    if (rule === task.recurrence_rule && mode === task.recurrence_mode) return;
    if (!rule) {
      flow.update(task.id, { recurrence_rule: null, recurrence_mode: 'schedule', recurrence_local_time: null });
      return;
    }
    const minutes = dueMinutes(task);
    const patch: TaskPatch = task.due_at
      ? { recurrence_rule: rule, recurrence_mode: mode, recurrence_local_time: task.all_day || minutes === null ? null : localTimeString(minutes) }
      : {
        due_at: instantFor(today(task.timezone), null, task.timezone), all_day: true,
        recurrence_rule: rule, recurrence_mode: mode, recurrence_local_time: null,
      };
    flow.update(task.id, patch);
    haptic.tap();
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
    showToast(`‘${title.trim() || task.title}’을 체크리스트 템플릿으로 저장했습니다.`);
  };

  const copyMarkdown = () => {
    setSheet(null);
    const md = toMarkdownChecklist(task, subtasks, completedSubtasks);
    void Clipboard.setStringAsync(md)
      .then(() => showToast('체크리스트를 마크다운으로 복사했습니다.'))
      .catch(() => {});
  };

  const pColor = priorityColor(colors, task.priority);

  return (
    <Screen>
      <View style={styles.bar}>
        <IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />
        {parent ? (
          <Pressable
            accessibilityRole="button" accessibilityLabel={'상위 작업 ' + parent.title + ' 열기'}
            onPress={() => router.replace({ pathname: '/task/[id]', params: { id: parent.id } })}
            style={({ pressed }) => [styles.crumb, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="corner-left-up" size={14} color={colors.textMuted} />
            <Txt variant="smallStrong" tone="muted" numberOfLines={1}>{parent.title}</Txt>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button" accessibilityLabel="프로젝트·섹션 변경"
            onPress={() => setSheet('project')}
            style={({ pressed }) => [styles.crumb, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name={projectName ? 'hash' : 'inbox'} size={14} color={colors.textMuted} />
            <Txt variant="smallStrong" tone="muted" numberOfLines={1}>
              {projectName ? (sectionName ? `${projectName} · ${sectionName}` : projectName) : '미분류'}
            </Txt>
            <Icon name="chevron-down" size={13} color={colors.textFaint} />
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button" accessibilityLabel={'우선순위 P' + task.priority}
          onPress={() => setSheet('priority')} hitSlop={8}
          style={({ pressed }) => [styles.priorityBtn, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon name="flag" size={17} color={pColor} />
          {task.priority < 4 ? <Txt variant="caption" style={{ color: pColor, fontWeight: '700' }}>P{task.priority}</Txt> : null}
        </Pressable>
        <IconButton
          name="clock" label="이 할 일로 집중 시작" color={colors.textMuted}
          onPress={() => router.navigate({
            pathname: '/focus',
            params: {
              taskId: task.id, at: String(Date.now()),
              ...(task.duration_minutes ? { duration: String(task.duration_minutes) } : {}),
            },
          })} />
        <IconButton name="more-horizontal" label="더 보기" color={colors.textMuted} onPress={() => setSheet('more')} />
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: space.xxl * 2 }} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.titleRow}>
              <View style={{ paddingTop: 4 }}>
                <Checkbox
                  checked={done} size={24} color={pColor} tinted={task.priority < 4} onPress={complete} label="완료" />
              </View>
              <TextInput
                value={title} onChangeText={setTitle} onBlur={saveTitle} multiline submitBehavior="blurAndSubmit" maxLength={500}
                accessibilityLabel="제목" placeholder="제목" placeholderTextColor={colors.textFaint}
                style={[type.heading, { flex: 1, color: colors.text, padding: 0, textAlignVertical: 'top' }]} />
            </View>
            <TextInput
              value={notes} onChangeText={setNotes} onBlur={saveNotes} multiline maxLength={10000}
              placeholder="메모 추가..." placeholderTextColor={colors.textFaint} accessibilityLabel="메모"
              style={[type.body, styles.notes, { color: colors.textMuted }]} />
          </View>

          <View style={[styles.pills, { borderBottomColor: colors.border }]}>
            <Chip
              icon="calendar" label={due ?? '일정'}
              color={!due ? undefined : isPastDue(task) ? colors.danger : dueBucket(task) === 'today' ? colors.success : colors.accent}
              onPress={() => setSheet('schedule')} />
            <Chip
              icon="clock" label={durationLabel ?? '소요시간'}
              selected={!!durationLabel} color={durationLabel ? colors.accent : undefined}
              onPress={() => setSheet('duration')} />
            {repeat || due ? (
              <Chip
                icon="repeat" label={repeat ?? '반복'} color={repeat ? colors.info : undefined}
                selected={!!repeat} onPress={() => setSheet('repeat')} />
            ) : null}
            {Platform.OS === 'android' && task.due_at ? (
              <Chip
                icon={reminderOff ? 'bell-off' : 'bell'} label={reminderLabel}
                onPress={() => setSheet('reminder')} />
            ) : null}
            {attachedTags.map((tag) => (
              <Chip key={tag.id} icon="tag" label={tag.name} selected onPress={() => setSheet('tags')} />
            ))}
            <Chip icon="tag" label={attachedTags.length ? '+' : '태그'} onPress={() => setSheet('tags')} />
          </View>

          <View style={styles.subtaskHeader}>
            <Txt variant="section" tone="muted">체크리스트 · 하위 작업</Txt>
            {totalSubtasks ? (
              <Txt variant="smallStrong" tone={completedSubtasks.length === totalSubtasks ? 'success' : 'faint'}>
                {completedSubtasks.length}/{totalSubtasks}
              </Txt>
            ) : null}
            <View style={{ flex: 1 }} />
            {completedSubtasks.length > 0 ? (
              <Pressable
                accessibilityRole="button" accessibilityLabel="완료한 하위 작업 모두 초기화" hitSlop={8}
                onPress={() => {
                  haptic.tap();
                  flow.resetChecklist(completedSubtasks);
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}>
                <Icon name="rotate-ccw" size={12} color={colors.accent} />
                <Txt variant="caption" tone="accent" style={{ fontWeight: '600' }}>모두 초기화</Txt>
              </Pressable>
            ) : subtasks.length > 1 ? (
              <Txt variant="caption" tone="faint">길게 눌러 순서 변경</Txt>
            ) : null}
          </View>

          {totalSubtasks > 0 ? (
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
              <ProgressBar value={subRatio} color={subRatio === 1 ? colors.success : colors.accent} height={5} />
            </View>
          ) : null}

          {subtasks.length ? <TaskList tasks={subtasks} sortable /> : null}

          <View style={[styles.inlineAdd, { borderBottomColor: colors.border }]}>
            <Icon name="plus" size={18} color={colors.accent} />
            <TextInput
              ref={subtaskInput} value={subtaskText} onChangeText={setSubtaskText}
              placeholder="하위 작업 추가..." placeholderTextColor={colors.textFaint}
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

          {completedSubtasks.length > 0 ? (
            <View style={{ marginTop: space.md }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`완료한 하위 작업 ${completedSubtasks.length}개 ${showCompletedSubs ? '접기' : '보기'}`}
                onPress={() => {
                  haptic.tap();
                  setShowCompletedSubs((open) => !open);
                }}
                style={({ pressed }) => [styles.completedToggle, { opacity: pressed ? 0.6 : 1 }]}>
                <Icon name={showCompletedSubs ? 'chevron-down' : 'chevron-right'} size={15} color={colors.textFaint} />
                <Txt variant="smallStrong" tone="muted">완료됨 {completedSubtasks.length}</Txt>
              </Pressable>
              {showCompletedSubs ? completedSubtasks.map((sub) => (
                <View key={sub.id} style={styles.completedSubRow}>
                  <Checkbox
                    checked size={20} color={colors.success}
                    onPress={() => {
                      haptic.tap();
                      flow.reopen(sub);
                    }}
                    label={sub.title + ' 다시 열기'} />
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
        </ScrollView>
      </KeyboardAvoidingView>

      <ScheduleSheet task={sheet === 'schedule' ? task : null} onClose={() => setSheet(null)} onPick={flow.reschedule} />
      <RepeatSheet
        visible={sheet === 'repeat'} currentRule={task.recurrence_rule} currentMode={task.recurrence_mode}
        onClose={() => setSheet(null)} onSelect={applyRepeat} />

      <Sheet visible={sheet === 'duration'} onClose={() => setSheet(null)} title="예상 소요시간">
        <View style={{ gap: space.md }}>
          <Txt variant="small" tone="muted">
            타임라인 블록 크기에 반영되며, 이 할 일로 집중 타이머를 열면 자동으로 시간이 맞춰집니다.
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
              onPress={() => applyDuration(Math.max(5, (task.duration_minutes ?? 30) - 5))}
              style={{ backgroundColor: colors.surfaceMuted, width: 36, height: 36 }} />
            <Txt variant="bodyStrong" style={{ minWidth: 82, textAlign: 'center' }}>
              {task.duration_minutes ? formatDurationMinutes(task.duration_minutes) : '30분'}
            </Txt>
            <IconButton
              name="plus" label="5분 늘리기" size={18}
              onPress={() => applyDuration(Math.min(1440, (task.duration_minutes ?? 25) + 5))}
              style={{ backgroundColor: colors.surfaceMuted, width: 36, height: 36 }} />
          </View>
          <Button label="완료" onPress={() => setSheet(null)} />
        </View>
      </Sheet>

      <Sheet visible={sheet === 'reminder'} onClose={() => setSheet(null)} title="알림">
        <TaskReminderChips taskId={task.id} allDay={task.all_day} />
      </Sheet>

      <Sheet visible={sheet === 'priority'} onClose={() => setSheet(null)} title="우선순위">
        {priorities.map((item) => {
          const active = task.priority === item.value;
          const tint = priorityColor(colors, item.value);
          return (
            <Pressable
              key={item.value} accessibilityRole="button" accessibilityLabel={item.label}
              onPress={() => {
                haptic.tap();
                flow.update(task.id, { priority: item.value });
                setSheet(null);
              }}
              style={({ pressed }) => [styles.sheetRow, { opacity: pressed ? 0.6 : 1 }]}>
              <Icon name="flag" size={18} color={tint} />
              <Txt style={{ flex: 1 }}>{item.label}</Txt>
              {active ? <Icon name="check" size={18} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </Sheet>

      <Sheet visible={sheet === 'project'} onClose={() => setSheet(null)} title="프로젝트 · 섹션">
        <ScrollView style={{ maxHeight: 380 }}>
          <Row
            icon="inbox" label="미분류"
            trailing={!task.project_id ? <Icon name="check" size={18} color={colors.accent} /> : undefined}
            onPress={() => {
              flow.update(task.id, { project_id: null, section_id: null });
              setSheet(null);
            }} />
          {(projects ?? []).map((project) => {
            const projSections = (sections ?? []).filter((s) => s.project_id === project.id);
            return (
              <View key={project.id}>
                <Row
                  icon="hash" label={project.name}
                  trailing={task.project_id === project.id && !task.section_id ? <Icon name="check" size={18} color={colors.accent} /> : undefined}
                  onPress={() => {
                    flow.update(task.id, { project_id: project.id, section_id: null });
                    setSheet(null);
                  }} />
                {projSections.map((section) => (
                  <View key={section.id} style={{ paddingLeft: space.xl }}>
                    <Row
                      icon="bookmark" label={section.name}
                      trailing={task.section_id === section.id ? <Icon name="check" size={18} color={colors.accent} /> : undefined}
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
          ) : <Txt variant="small" tone="muted">아직 만든 태그가 없습니다. 아래에서 바로 추가할 수 있습니다.</Txt>}
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <TextInput
              value={newTag} onChangeText={setNewTag} placeholder="새 태그 이름" placeholderTextColor={colors.textFaint} maxLength={120}
              autoCapitalize="none" returnKeyType="done" onSubmitEditing={addTag} accessibilityLabel="새 태그 이름"
              style={[type.body, styles.tagInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, flex: 1 }]} />
            <Button label="추가" kind="secondary" onPress={addTag} disabled={!newTag.trim()} style={{ minHeight: 46 }} />
          </View>
        </View>
      </Sheet>

      <Sheet visible={sheet === 'more'} onClose={() => setSheet(null)} title="할 일 작업">
        <Row
          icon="copy" label="할 일 복제" detail={totalSubtasks > 0 ? `하위 작업 ${totalSubtasks}개 포함` : undefined}
          onPress={() => {
            setSheet(null);
            flow.duplicate(task, { openSubtasks: subtasks, completedSubtasks, tagNames: attachedTags.map((t) => t.name) });
          }} />
        <Row icon="clipboard" label="체크리스트 복사 (Markdown)" onPress={copyMarkdown} />
        <Row
          icon="bookmark" label="체크리스트 템플릿으로 저장" detail="재사용 목록"
          onPress={saveAsTemplate} />
        {completedSubtasks.length > 0 ? (
          <Row
            icon="rotate-ccw" label="완료한 하위 작업 모두 초기화"
            onPress={() => {
              setSheet(null);
              flow.resetChecklist(completedSubtasks);
            }} />
        ) : null}
        <Row
          icon="trash-2" label="할 일 삭제" tone="danger"
          onPress={() => {
            setSheet(null);
            flow.remove(task);
            router.back();
          }} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, minHeight: 48, gap: 2 },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: space.sm, paddingVertical: 6, maxWidth: 200 },
  priorityBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 40, paddingHorizontal: 8 },
  hero: { paddingHorizontal: space.lg, paddingTop: space.xs, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  notes: { paddingLeft: 36, paddingVertical: 2, minHeight: 28, textAlignVertical: 'top' },
  pills: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subtaskHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: 6,
  },
  inlineAdd: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inlineSend: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
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
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  tagInput: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
});
