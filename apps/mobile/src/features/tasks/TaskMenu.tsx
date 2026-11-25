import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Chip, Icon, type IconName, Row, Sheet, Txt } from '@/components/ui';
import { useProjects, useSections, useSubtaskProgress, useTagNames, useTaskActions, useTaskIndex } from '@/data/tasks';
import { KEY_PRIORITY, matchesCombo, useKeyHandler } from '@/features/keyboard';
import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { usePersonalPrefs } from '@/features/settings/prefsStore';
import { describeRecurrence, deviceTimeZone, formatDue, formatDurationMinutes, logicalToday, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { josa } from '@/lib/josa';
import type { Priority, Task } from '@/lib/shared';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

import { listColor } from './listColors';
import { useDailyFocus } from './mitStore';
import { priorityA11y, priorityOption } from './priority';
import { useProjectMetaMap } from './projectMeta';
import { toMarkdownChecklist, useTaskFlow } from './useTaskFlow';

/** A neutral quick action: no action here outranks the others, so none takes a colour. */
function Action({ icon, label, accessibilityLabel, onPress }: {
  icon: IconName; label: string; accessibilityLabel?: string; onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={icon} size={20} color={colors.textMuted} />
      <Txt variant="caption">{label}</Txt>
    </Pressable>
  );
}

/**
 * What a long press on a task offers: the common changes in one sheet, without opening the task.
 * `onSchedule` opens the full date picker the list already has.
 */
export function TaskMenu({
  task, onClose, onSchedule, onStartSelect, onBreakdown,
}: {
  task: Task | null; onClose: () => void; onSchedule: (task: Task) => void; onStartSelect?: (task: Task) => void;
  /** Opens AI로 쪼개기 from the host after this sheet has closed, so two sheets never stack. */
  onBreakdown?: (task: Task) => void;
}) {
  if (!task) return null;
  return (
    <TaskMenuContent
      key={task.id} task={task} onClose={onClose} onSchedule={onSchedule} onStartSelect={onStartSelect} onBreakdown={onBreakdown} />
  );
}

function TaskMenuContent({
  task: opened, onClose, onSchedule, onStartSelect, onBreakdown,
}: {
  task: Task; onClose: () => void; onSchedule: (task: Task) => void; onStartSelect?: (task: Task) => void;
  onBreakdown?: (task: Task) => void;
}) {
  const { colors, isDark } = useTheme();
  const prefs = usePersonalPrefs();
  const projectMeta = useProjectMetaMap();
  const flow = useTaskFlow();
  const actions = useTaskActions();
  const { byId, children } = useTaskIndex();
  const task = byId.get(opened.id) ?? opened;
  const { completedChildren } = useSubtaskProgress();
  const { data: projects } = useProjects();
  const { data: sections } = useSections();
  const tagNames = useTagNames();
  const quickAdd = useQuickAdd();
  const [movingProject, setMovingProject] = useState(false);

  const logicalDate = logicalToday(deviceTimeZone(), prefs.dayStartHour).toString();
  const dailyFocus = useDailyFocus(logicalDate);
  const isMit = dailyFocus.isMit(task.id);
  const isEvening = dailyFocus.isEvening(task.id);

  const now = today(task.timezone);
  const due = formatDue(task, prefs.timeFormat);
  const repeat = describeRecurrence(task.recurrence_rule, task.recurrence_mode);
  const durationLabel = task.duration_minutes ? formatDurationMinutes(task.duration_minutes) : null;
  const projectName = task.project_id ? projects?.find((item) => item.id === task.project_id)?.name : undefined;
  const projectSections = task.project_id ? (sections ?? []).filter((section) => section.project_id === task.project_id) : [];
  const openSubs = children.get(task.id) ?? [];
  const doneSubs = completedChildren.get(task.id) ?? [];
  const run = (action: () => void) => {
    onClose();
    action();
  };

  const openFocus = () => run(() => router.navigate({
    pathname: '/focus',
    params: {
      taskId: task.id,
      title: task.title,
      autostart: '1',
      at: String(Date.now()),
      ...(task.duration_minutes ? { duration: String(task.duration_minutes), minutes: String(task.duration_minutes) } : {}),
    },
  }));

  const toggleMit = () => {
    const result = dailyFocus.toggleMit(task.id);
    if (result.full) {
      haptic.warning();
      showToast('오늘의 핵심은 최대 3개까지 고정할 수 있습니다.');
      return;
    }
    haptic.tap();
    showToast(isMit ? '오늘의 핵심에서 해제했습니다.' : '오늘의 핵심으로 고정했습니다.');
  };

  const toggleEvening = () => {
    dailyFocus.toggleEvening(task.id);
    haptic.tap();
    showToast(isEvening ? '오늘 저녁에서 해제했습니다.' : '오늘 저녁으로 옮겼습니다.');
  };

  const copyTask = () => run(() => {
    const payload = openSubs.length + doneSubs.length > 0
      ? toMarkdownChecklist(task, openSubs, doneSubs)
      : task.title;
    void Clipboard.setStringAsync(payload)
      .then(() => showToast(openSubs.length + doneSubs.length > 0 ? '체크리스트를 복사했습니다.' : '제목을 복사했습니다.'))
      .catch(() => {});
  });

  useKeyHandler(
    (event) => {
      if (matchesCombo(event, 'escape')) {
        onClose();
        return true;
      }

      if (event.editing) return false;

      if (matchesCombo(event, 'x') || matchesCombo(event, 'space')) {
        run(() => flow.complete(task));
        return true;
      }
      if (matchesCombo(event, 't')) {
        run(() => flow.reschedule(task, now));
        return true;
      }
      if (matchesCombo(event, 'w')) {
        run(() => flow.reschedule(task, now.add({ days: 1 })));
        return true;
      }
      if (matchesCombo(event, 's') || matchesCombo(event, 'd')) {
        run(() => onSchedule(task));
        return true;
      }
      if (
        matchesCombo(event, '1')
        || matchesCombo(event, '2')
        || matchesCombo(event, '3')
        || matchesCombo(event, '4')
      ) {
        haptic.tap();
        actions.update(task.id, { priority: Number(event.key) as Priority });
        return true;
      }
      if (matchesCombo(event, 'u') && !task.parent_task_id) {
        run(() => quickAdd.open({ parentTaskId: task.id }));
        return true;
      }
      if (matchesCombo(event, 'f')) {
        openFocus();
        return true;
      }
      if (matchesCombo(event, 'c')) {
        copyTask();
        return true;
      }
      if (matchesCombo(event, 'enter') || matchesCombo(event, 'o')) {
        run(() => router.push({ pathname: '/task/[id]', params: { id: task.id } }));
        return true;
      }
      if (matchesCombo(event, 'delete') || matchesCombo(event, 'backspace')) {
        run(() => flow.remove(task));
        return true;
      }

      return true;
    },
    { priority: KEY_PRIORITY.sheet },
  );

  return (
    <Sheet visible onClose={onClose}>
      <View style={{ gap: 2, marginBottom: space.md }}>
        <Txt variant="heading" numberOfLines={2}>{task.title}</Txt>
        <Txt variant="small" tone="muted">
          {[due ?? '날짜 없음', durationLabel, repeat, projectName ? '#' + projectName : null].filter(Boolean).join(' · ')}
        </Txt>
      </View>

      <View style={styles.actions}>
        <Action icon="play" label="집중" accessibilityLabel="집중 시작" onPress={openFocus} />
        <Action icon="sun" label="오늘" onPress={() => run(() => flow.reschedule(task, now))} />
        <Action icon="sunrise" label="내일" onPress={() => run(() => flow.reschedule(task, now.add({ days: 1 })))} />
        <Action icon="calendar" label="일정" accessibilityLabel="날짜·시간" onPress={() => run(() => onSchedule(task))} />
      </View>

      <View style={styles.priorities}>
        {([1, 2, 3, 4] as Priority[]).map((priority) => {
          const active = task.priority === priority;
          return (
            <Pressable
              key={priority} accessibilityRole="button" accessibilityLabel={priorityA11y(priority)} accessibilityState={{ selected: active }}
              onPress={() => {
                haptic.tap();
                actions.update(task.id, { priority });
              }}
              style={[styles.priority, { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accentSoft : 'transparent' }]}>
              {active ? <Icon name="check" size={11} color={colors.accentText} /> : null}
              <Txt
                variant="caption" numberOfLines={1} maxFontSizeMultiplier={1.25}
                style={{ color: active ? colors.accentText : colors.textMuted, fontWeight: active ? '700' : '600', flexShrink: 1 }}>
                {priorityOption(priority)}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.durations}>
        {([15, 30, 60, null] as (number | null)[]).map((mins) => {
          const active = task.duration_minutes === mins;
          return (
            <Chip
              key={mins === null ? 'none' : String(mins)}
              icon={mins === null ? 'slash' : 'clock'}
              label={mins === null ? '없음' : formatDurationMinutes(mins)}
              selected={active}
              onPress={() => run(() => {
                actions.update(task.id, { duration_minutes: mins });
                showToast(mins ? `소요 시간을 ${formatDurationMinutes(mins)}${josa(formatDurationMinutes(mins), '으로/로')} 설정했습니다.` : '소요 시간을 지웠습니다.');
              })}
              style={{ flex: 1, justifyContent: 'center' }} />
          );
        })}
      </View>

      <ScrollView style={{ maxHeight: 320, marginTop: space.sm }}>
        <Row icon="check" label="완료" onPress={() => run(() => flow.complete(task))} />
        {!task.parent_task_id ? (
          <>
            <Row
              icon="star"
              label={isMit ? '오늘의 핵심 해제' : '오늘의 핵심 고정'}
              detail={`${dailyFocus.mitIds.length}/3`}
              trailing={isMit ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
              onPress={toggleMit} />
            <Row
              icon="moon"
              label={isEvening ? '오늘 저녁 해제' : '오늘 저녁으로'}
              trailing={isEvening ? <Icon name="check" size={18} color={colors.accentText} /> : undefined}
              onPress={toggleEvening} />
          </>
        ) : null}
        {task.recurrence_rule ? (
          <Row
            icon="skip-forward"
            label="이번 반복 건너뛰기"
            detail={repeat ?? undefined}
            onPress={() => run(() => flow.skipOccurrence(task))} />
        ) : null}
        {!task.parent_task_id && projects?.length ? (
          <>
            <Row
              icon="folder" label="목록 옮기기" detail={projectName ? '#' + projectName : '미분류'}
              trailing={<Icon name={movingProject ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textFaint} />}
              onPress={() => setMovingProject((open) => !open)} />
            {movingProject ? (
              <ScrollView
                horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingBottom: space.sm }}>
                <Chip
                  icon="inbox" label="미분류" selected={!task.project_id}
                  onPress={() => run(() => {
                    actions.update(task.id, { project_id: null, section_id: null });
                    showToast('미분류로 옮겼습니다.');
                  })} />
                {projects.map((project) => (
                  <Chip
                    key={project.id} icon={projectMeta[project.id]?.icon ?? 'hash'} color={listColor(projectMeta[project.id]?.color, isDark)}
                    label={project.name} selected={task.project_id === project.id}
                    onPress={() => run(() => {
                      actions.update(task.id, { project_id: project.id, section_id: null });
                      showToast(`#${project.name} 목록으로 옮겼습니다.`);
                    })} />
                ))}
              </ScrollView>
            ) : null}
          </>
        ) : null}
        {!task.parent_task_id && projectSections.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: space.sm }}>
            <Chip
              icon="minus" label="섹션 없음" selected={!task.section_id}
              onPress={() => run(() => {
                actions.update(task.id, { section_id: null });
                showToast('섹션 지정을 해제했습니다.');
              })} />
            {projectSections.map((section) => (
              <Chip
                key={section.id} icon="bookmark" label={section.name} selected={task.section_id === section.id}
                onPress={() => run(() => {
                  actions.update(task.id, { section_id: section.id });
                  showToast(`‘${section.name}’ 섹션으로 옮겼습니다.`);
                })} />
            ))}
          </ScrollView>
        ) : null}
        {onStartSelect && !task.parent_task_id ? (
          <Row icon="check-square" label="여러 개 선택" detail="한 번에 변경" onPress={() => run(() => onStartSelect(task))} />
        ) : null}
        {task.parent_task_id ? null : (
          <Row icon="corner-down-right" label="하위 작업 추가" onPress={() => run(() => quickAdd.open({ parentTaskId: task.id }))} />
        )}
        {onBreakdown && !task.parent_task_id ? (
          <Row icon="layers" label="AI로 쪼개기" onPress={() => run(() => onBreakdown(task))} />
        ) : null}
        {doneSubs.length > 0 ? (
          <Row
            icon="rotate-ccw" label="하위 작업 체크 초기화" detail={`${doneSubs.length}개 완료 해제`}
            onPress={() => run(() => flow.resetChecklist(doneSubs))} />
        ) : null}
        <Row
          icon="copy" label="할 일 복제" detail={openSubs.length + doneSubs.length > 0 ? `하위 ${openSubs.length + doneSubs.length}개 포함` : undefined}
          onPress={() => run(() => flow.duplicate(task, { openSubtasks: openSubs, completedSubtasks: doneSubs, tagNames: tagNames.get(task.id) }))} />
        <Row icon="clipboard" label={openSubs.length + doneSubs.length > 0 ? '체크리스트 복사' : '제목 복사'} onPress={copyTask} />
        <Row icon="maximize-2" label="자세히 보기" onPress={() => run(() => router.push({ pathname: '/task/[id]', params: { id: task.id } }))} />
        <Row icon="trash-2" label="삭제" tone="danger" onPress={() => run(() => flow.remove(task))} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, height: 64, borderRadius: radius.md },
  priorities: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  // Four across on a 360dp screen: "가장 높음" at caption size with an active checkmark fits in a quarter of the row.
  priority: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, height: 38, paddingHorizontal: 3,
    borderRadius: radius.md, borderWidth: 1,
  },
  durations: { flexDirection: 'row', gap: 6, marginTop: space.sm },
});
