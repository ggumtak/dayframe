import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated';

import { Checkbox } from '@/components/Checkbox';
import { FoldHeader, Icon, Txt } from '@/components/ui';
import type { DoneToday as Done } from '@/data/tasks';
import { deviceTimeZone, formatTime, Temporal } from '@/lib/dates';
import { usePersistentState } from '@/lib/persist';
import { fontFamily, space, type, useTheme } from '@/theme';

import { useTaskFlow } from './useTaskFlow';

type Fold = 'open' | 'closed';
const isFold = (value: string): value is Fold => value === 'open' || value === 'closed';

/**
 * What was finished today, under the open tasks: the day's progress stays visible and a slip of the
 * finger is one tap from being undone. Folded by default, as Todoist keeps it behind a toggle.
 */
export function DoneToday({ items }: { items: Done[] }) {
  const { colors } = useTheme();
  const flow = useTaskFlow();
  const [fold, setFold] = usePersistentState<Fold>('dayframe-today-done', 'closed', isFold);
  if (!items.length) return null;
  const open = fold === 'open';
  const zone = deviceTimeZone();

  return (
    <View>
      <FoldHeader title="완료한 일" count={items.length} open={open} onToggle={() => setFold(open ? 'closed' : 'open')} label="오늘 완료한 일" />
      {/* Fades in when unfolded, not when the screen mounts already unfolded. */}
      <LayoutAnimationConfig skipEntering>
        {open ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(100)}>
          {items.map(({ completion, undoable }) => {
        const { task } = completion;
        const at = Temporal.Instant.from(completion.completed_at).toZonedDateTimeISO(zone);
        return (
          <View key={task.id + completion.completed_at} style={styles.row}>
            <View style={{ opacity: undoable ? 1 : 0.5 }}>
              <Checkbox
                checked done label={task.title + ' 완료 취소'}
                onPress={() => {
                  if (undoable) flow.uncomplete(task, completion.occurrence_due_at);
                }} />
            </View>
            <View style={[styles.body, { borderBottomColor: colors.border }]}>
              <Text numberOfLines={1} style={[type.body as TextStyle, styles.title, { color: colors.textFaint }]}>{task.title}</Text>
              {task.recurrence_rule ? <Icon name="repeat" size={12} color={colors.textFaint} /> : null}
              <Text style={[styles.time, { color: colors.textFaint }]}>{formatTime(at.hour * 60 + at.minute)}</Text>
            </View>
          </View>
        );
          })}
          <Pressable
            accessibilityRole="button" accessibilityLabel="완료한 일 전체 기록 보기"
            onPress={() => router.push('/completed')}
            style={({ pressed }) => [styles.allLink, { opacity: pressed ? 0.6 : 1 }]}>
            <Txt variant="smallStrong" tone="accent">완료 기록 전체 보기</Txt>
            <Icon name="chevron-right" size={14} color={colors.accentText} />
          </Pressable>
        </Animated.View>
        ) : null}
      </LayoutAnimationConfig>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg },
  body: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 46, paddingRight: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, textDecorationLine: 'line-through' },
  time: { fontFamily, fontSize: 12, lineHeight: 16 },
  allLink: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.lg, paddingVertical: space.md,
  },
});
