import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Checkbox } from '@/components/Checkbox';
import { Button, Chip, EmptyState, Icon, IconButton, Loading, Row, Screen, SectionTitle, Sheet, Txt } from '@/components/ui';
import { attachTagByName, useProjects, useTags, useTaskIndex, useTaskTags } from '@/data/tasks';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { parseErrorMessage } from '@/features/quick-add/messages';
import { TaskReminderChips } from '@/features/reminders/ReminderChips';
import { ScheduleSheet } from '@/features/tasks/ScheduleSheet';
import { TaskList } from '@/features/tasks/TaskList';
import { localTimeString, useTaskFlow } from '@/features/tasks/useTaskFlow';
import { errorMessage } from '@/lib/api';
import { describeRecurrence, dueMinutes, formatDue, instantFor, isPastDue, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { analyzeTask, type Priority, type Task, type TaskPatch } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { priorityColor, radius, space, type, useTheme } from '@/theme';

const PLACEHOLDER = '⁣';
const priorities: Priority[] = [1, 2, 3, 4];
const repeatOptions: { rule: string | null; label: string; detail?: string }[] = [
  { rule: null, label: '반복 없음' },
  { rule: 'FREQ=DAILY', label: '매일' },
  { rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: '평일', detail: '월–금' },
  { rule: 'FREQ=WEEKLY;BYDAY=SA,SU', label: '주말', detail: '토–일' },
  { rule: 'FREQ=WEEKLY', label: '매주' },
  { rule: 'FREQ=WEEKLY;INTERVAL=2', label: '격주' },
  { rule: 'FREQ=MONTHLY', label: '매월' },
  { rule: 'FREQ=MONTHLY;BYMONTHDAY=-1', label: '매월 말일' },
  { rule: 'FREQ=YEARLY', label: '매년' },
];

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { byId, isLoading } = useTaskIndex();
  const task = byId.get(id);
  if (isLoading) return <Screen><Loading /></Screen>;
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

function TaskEditor({ task }: { task: Task }) {
  const { colors } = useTheme();
  const { byId, children } = useTaskIndex();
  const { data: projects } = useProjects();
  const { data: tags } = useTags();
  const { data: links } = useTaskTags();
  const flow = useTaskFlow();
  const quickAdd = useQuickAdd();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [when, setWhen] = useState('');
  const [newTag, setNewTag] = useState('');
  const [calendar, setCalendar] = useState(false);
  const [pickingRepeat, setPickingRepeat] = useState(false);
  const [done, setDone] = useState(false);

  const schedule = useMemo(() => {
    if (!when.trim()) return null;
    try {
      // The parser needs a title, so lend it an invisible one and see what is left over.
      const { task: parsed } = analyzeTask({ text: when + ' ' + PLACEHOLDER, timezone: task.timezone });
      const leftover = parsed.title.replace(PLACEHOLDER, '').trim();
      if (leftover) return { error: `‘${leftover}’ 부분을 이해하지 못했습니다.` };
      if (!parsed.due_at) return { error: '날짜나 시간을 찾지 못했습니다.' };
      const patch: TaskPatch = {
        due_at: parsed.due_at, all_day: parsed.all_day, recurrence_rule: parsed.recurrence_rule,
        recurrence_local_time: parsed.recurrence_local_time ?? null,
      };
      const label = [formatDue({ due_at: parsed.due_at, all_day: parsed.all_day, timezone: task.timezone }),
        describeRecurrence(parsed.recurrence_rule)].filter(Boolean).join(' · ');
      return { patch, label };
    } catch (error) {
      return { error: parseErrorMessage(error) ?? '날짜나 시간을 입력해 주세요.' };
    }
  }, [when, task]);

  const parent = task.parent_task_id ? byId.get(task.parent_task_id) : undefined;
  const subtasks = children.get(task.id) ?? [];
  const attached = new Set((links ?? []).filter((link) => link.task_id === task.id).map((link) => link.tag_id));
  const due = formatDue(task);
  const repeat = describeRecurrence(task.recurrence_rule);

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
  const applySchedule = () => {
    if (!schedule?.patch) return;
    flow.update(task.id, schedule.patch);
    haptic.success();
    setWhen('');
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
  const applyRepeat = (rule: string | null) => {
    setPickingRepeat(false);
    if (rule === task.recurrence_rule) return;
    if (!rule) {
      flow.update(task.id, { recurrence_rule: null, recurrence_local_time: null });
      return;
    }
    const minutes = dueMinutes(task);
    const patch: TaskPatch = task.due_at
      ? { recurrence_rule: rule, recurrence_local_time: task.all_day || minutes === null ? null : localTimeString(minutes) }
      : { due_at: instantFor(today(task.timezone), null, task.timezone), all_day: true, recurrence_rule: rule, recurrence_local_time: null };
    flow.update(task.id, patch);
    haptic.tap();
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

  const field = { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text };
  return (
    <Screen>
      <View style={styles.bar}>
        <IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />
        <View style={{ flex: 1 }} />
        <IconButton
          name="clock" label="이 할 일로 집중 시작" color={colors.textMuted}
          onPress={() => router.navigate({ pathname: '/focus', params: { taskId: task.id, at: String(Date.now()) } })} />
        <IconButton
          name="trash-2" label="삭제" color={colors.danger}
          onPress={() => {
            flow.remove(task);
            router.back();
          }} />
      </View>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: space.xxl * 2 }} keyboardShouldPersistTaps="handled">
          {parent ? (
            <Pressable
              accessibilityRole="button" accessibilityLabel={'상위 작업 ' + parent.title + ' 열기'}
              onPress={() => router.replace({ pathname: '/task/[id]', params: { id: parent.id } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
              <Icon name="corner-left-up" size={13} color={colors.textMuted} />
              <Txt variant="small" tone="muted" numberOfLines={1}>{parent.title}</Txt>
            </Pressable>
          ) : null}

          <View style={styles.title}>
            <View style={{ paddingTop: 5 }}>
              <Checkbox checked={done} size={26} color={priorityColor(colors, task.priority)} onPress={complete} label="완료" />
            </View>
            <TextInput
              value={title} onChangeText={setTitle} onBlur={saveTitle} multiline submitBehavior="blurAndSubmit" maxLength={500}
              accessibilityLabel="제목" placeholder="제목" placeholderTextColor={colors.textFaint}
              style={[type.heading, { flex: 1, color: colors.text, padding: 0, textAlignVertical: 'top' }]} />
          </View>

          {subtasks.length ? (
            <>
              <SectionTitle
                title="하위 작업" count={subtasks.length}
                action={(
                  <Button
                    label="추가" kind="ghost" icon="plus" onPress={() => quickAdd.open({ parentTaskId: task.id })}
                    style={{ minHeight: 30, paddingHorizontal: space.sm }} />
                )} />
              <TaskList tasks={subtasks} sortable />
            </>
          ) : (
            <Pressable
              accessibilityRole="button" accessibilityLabel="하위 작업 추가"
              onPress={() => quickAdd.open({ parentTaskId: task.id })}
              style={({ pressed }) => [styles.addSubtask, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}>
              <Icon name="plus" size={16} color={colors.accent} />
              <Txt variant="smallStrong" tone="accent">하위 작업 추가</Txt>
            </Pressable>
          )}

          <SectionTitle title="메모" />
          <View style={styles.block}>
            <TextInput
              value={notes} onChangeText={setNotes} onBlur={saveNotes} multiline maxLength={10000} placeholder="메모를 남겨 보세요"
              placeholderTextColor={colors.textFaint} accessibilityLabel="메모"
              style={[type.body, styles.input, field, { minHeight: 68, paddingVertical: space.sm, textAlignVertical: 'top' }]} />
          </View>

          <SectionTitle title="일정" />
          <View style={styles.block}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Chip
                icon="calendar" label={due ?? '날짜 없음'} color={due ? (isPastDue(task) ? colors.danger : colors.success) : undefined}
                onPress={() => setCalendar(true)} />
              <Chip
                icon="repeat" label={repeat ?? '반복 추가'} color={repeat ? colors.info : undefined}
                selected={!!repeat} onPress={() => setPickingRepeat(true)} />
              {due ? <Chip icon="x" label="일정 지우기" onPress={() => flow.reschedule(task, null)} /> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <TextInput
                value={when} onChangeText={setWhen} placeholder="예: 내일 오후 3시, 매주 월수금 저녁 7시" placeholderTextColor={colors.textFaint}
                autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={applySchedule}
                accessibilityLabel="일정을 글로 입력" style={[type.body, styles.input, field, { flex: 1 }]} />
              <Button label="적용" onPress={applySchedule} disabled={!schedule?.patch} style={{ minHeight: 46 }} />
            </View>
            {schedule?.label ? <Txt variant="small" tone="success">{schedule.label}</Txt> : null}
            {schedule?.error ? <Txt variant="small" tone="danger">{schedule.error}</Txt> : null}
          </View>

          {task.due_at ? (
            <>
              <SectionTitle title="알림" />
              <View style={styles.block}>
                <TaskReminderChips taskId={task.id} allDay={task.all_day} />
              </View>
            </>
          ) : null}

          <SectionTitle title="우선순위" />
          <View style={[styles.block, { flexDirection: 'row', gap: space.sm }]}>
            {priorities.map((priority) => {
              const active = task.priority === priority;
              const tint = priorityColor(colors, priority);
              return (
                <Pressable
                  key={priority} accessibilityRole="button" accessibilityLabel={'우선순위 ' + priority} accessibilityState={{ selected: active }}
                  onPress={() => {
                    haptic.tap();
                    flow.update(task.id, { priority });
                  }}
                  style={[styles.priority, { borderColor: active ? tint : colors.border, backgroundColor: active ? colors.surface : 'transparent' }]}>
                  <Icon name="flag" size={14} color={tint} />
                  <Txt variant="smallStrong" style={{ color: active ? colors.text : colors.textMuted }}>P{priority}</Txt>
                </Pressable>
              );
            })}
          </View>

          {parent ? null : (
            <>
              <SectionTitle title="프로젝트" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
                <Chip icon="inbox" label="미분류" selected={!task.project_id} onPress={() => flow.update(task.id, { project_id: null, section_id: null })} />
                {(projects ?? []).map((project) => (
                  <Chip
                    key={project.id} icon="hash" label={project.name} selected={task.project_id === project.id}
                    onPress={() => flow.update(task.id, { project_id: project.id, section_id: null })} />
                ))}
              </ScrollView>
            </>
          )}

          <SectionTitle title="태그" />
          <View style={styles.block}>
            {tags?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {tags.map((tag) => {
                  const on = attached.has(tag.id);
                  return (
                    <Chip
                      key={tag.id} icon="tag" label={tag.name} selected={on}
                      onPress={() => flow.setTags({ taskId: task.id, attach: on ? [] : [tag.id], detach: on ? [tag.id] : [] })} />
                  );
                })}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <TextInput
                value={newTag} onChangeText={setNewTag} placeholder="새 태그" placeholderTextColor={colors.textFaint} maxLength={120}
                autoCapitalize="none" returnKeyType="done" onSubmitEditing={addTag} accessibilityLabel="새 태그 이름"
                style={[type.body, styles.input, field, { flex: 1 }]} />
              <Button label="추가" kind="secondary" onPress={addTag} disabled={!newTag.trim()} style={{ minHeight: 46 }} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ScheduleSheet task={calendar ? task : null} onClose={() => setCalendar(false)} onPick={flow.reschedule} />
      <Sheet visible={pickingRepeat} onClose={() => setPickingRepeat(false)} title="반복">
        <ScrollView style={{ maxHeight: 380 }}>
          {repeatOptions.map((item) => {
            const active = task.recurrence_rule === item.rule;
            return (
              <Row
                key={item.label} icon={item.rule ? 'repeat' : 'slash'} label={item.label} detail={item.detail}
                trailing={active ? <Icon name="check" size={18} color={colors.accent} /> : undefined}
                onPress={() => applyRepeat(item.rule)} />
            );
          })}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, minHeight: 48 },
  title: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  addSubtask: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: space.lg, marginTop: space.xs,
    paddingHorizontal: space.md, minHeight: 40, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed',
  },
  block: { paddingHorizontal: space.lg, gap: space.sm },
  input: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md },
  priority: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, borderRadius: radius.md,
    borderWidth: 1.5,
  },
});
