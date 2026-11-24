import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon, IconButton, Sheet, Txt } from '@/components/ui';
import { nextPosition, useTaskActions, useTaskIndex } from '@/data/tasks';
import { deviceTimeZone, instantFor, today } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

import { type ChecklistTemplate, deleteCustomTemplate, useChecklistTemplates } from './templates';

/** Reusable checklist templates sheet (Apple Reminders / Todoist / TickTick templates). */
export function TemplatesSheet({
  visible, onClose, projectId, sectionId, dueToday,
}: {
  visible: boolean;
  onClose: () => void;
  projectId?: string | null;
  sectionId?: string | null;
  dueToday?: boolean;
}) {
  const { colors } = useTheme();
  const { tasks } = useTaskIndex();
  const actions = useTaskActions();
  const { custom, builtin } = useChecklistTemplates();

  const applyTemplate = (tpl: ChecklistTemplate) => {
    const timezone = deviceTimeZone();
    const siblings = tasks.filter((task) => !task.parent_task_id && task.project_id === (projectId ?? null));
    const parentId = actions.create({
      input: {
        title: tpl.title,
        notes: tpl.notes ?? null,
        priority: tpl.priority ?? 4,
        timezone,
        position: nextPosition(siblings),
        ...(projectId ? { project_id: projectId } : {}),
        ...(projectId && sectionId ? { section_id: sectionId } : {}),
        ...(dueToday ? { due_at: instantFor(today(timezone), null, timezone), all_day: true } : {}),
      },
    });
    tpl.items.forEach((item, index) => {
      actions.create({
        input: {
          title: item,
          priority: 4,
          timezone,
          position: (index + 1) * 1024,
          parent_task_id: parentId,
        },
      });
    });
    haptic.success();
    onClose();
    showToast(`‘${tpl.title}’ 체크리스트(하위 작업 ${tpl.items.length}개)를 추가했습니다.`, {
      actionLabel: '열기',
      onAction: () => router.push({ pathname: '/task/[id]', params: { id: parentId } }),
    });
  };

  const renderItem = (tpl: ChecklistTemplate) => (
    <Pressable
      key={tpl.id} accessibilityRole="button" accessibilityLabel={tpl.title + ' 템플릿 적용'}
      onPress={() => applyTemplate(tpl)}
      style={({ pressed }) => [styles.card, { borderColor: colors.border, backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}>
      <View style={[styles.iconBox, { backgroundColor: colors.accentSoft }]}>
        <Icon name={tpl.icon} size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>{tpl.title}</Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          하위 작업 {tpl.items.length}개 · {tpl.items.slice(0, 3).join(', ')}
        </Txt>
      </View>
      {!tpl.builtin ? (
        <IconButton
          name="trash-2" label={tpl.title + ' 삭제'} size={15} color={colors.textFaint}
          onPress={() => {
            deleteCustomTemplate(tpl.id);
            showToast('템플릿을 삭제했습니다.');
          }}
          style={{ width: 32, height: 32 }} />
      ) : (
        <Icon name="plus-circle" size={18} color={colors.accent} />
      )}
    </Pressable>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="체크리스트 템플릿">
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.sm }}>
        <Txt variant="small" tone="muted">
          자주 쓰는 체크리스트를 한 번에 만듭니다. 할 일 상세 화면에서 내 템플릿을 저장할 수도 있습니다.
        </Txt>
        {custom.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Txt variant="section" tone="muted">내 템플릿</Txt>
            {custom.map(renderItem)}
          </View>
        ) : null}
        <View style={{ gap: space.sm }}>
          <Txt variant="section" tone="muted">추천 체크리스트</Txt>
          {builtin.map(renderItem)}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
  },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
