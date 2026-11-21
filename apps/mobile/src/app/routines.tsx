import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Chip, Header, Icon, IconButton, Screen, Txt } from '@/components/ui';
import { useHabitActions, useHabits } from '@/data/habits';
import { type Routine, routineGroups, routineLabel, sameRoutine } from '@/features/habits/routines';
import { deviceTimeZone } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

/** A dense board of everyday routines; a tap adds one as a habit. */
export default function Routines() {
  const { colors } = useTheme();
  const { data: habits } = useHabits();
  const actions = useHabitActions();
  const [group, setGroup] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const active = (habits ?? []).filter((habit) => !habit.archived_at);
  const has = (routine: Routine) => added.includes(routine.name) || active.some((habit) => sameRoutine(habit.name, routine.name));
  const shown = routineGroups.filter((item) => !group || item.title === group);

  const add = (routine: Routine) => {
    if (has(routine)) {
      showToast('이미 습관에 있습니다. 습관 탭에서 관리할 수 있습니다.');
      return;
    }
    haptic.success();
    actions.create({ name: routine.name, cadence: routine.cadence ?? 'daily', target_count: routine.target ?? 1, timezone: deviceTimeZone() });
    setAdded((current) => [...current, routine.name]);
    showToast(`‘${routine.name}’을 습관에 추가했습니다.`);
  };

  return (
    <Screen>
      <Header
        title="추천 루틴" subtitle={added.length ? `${added.length}개 추가함` : '누르면 바로 습관에 추가됩니다'}
        left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={{ flexGrow: 0, flexShrink: 0 }}>
        <Chip label="전체" selected={!group} onPress={() => setGroup(null)} />
        {routineGroups.map((item) => <Chip key={item.title} label={item.title} selected={group === item.title} onPress={() => setGroup(item.title)} />)}
      </ScrollView>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, paddingBottom: space.xxl * 2, gap: space.xl }}>
        {shown.map((item) => (
          <View key={item.title} style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={item.icon} size={16} color={colors.accent} />
              <Txt variant="section">{item.title}</Txt>
            </View>
            <View style={styles.board}>
              {item.items.map((routine) => {
                const done = has(routine);
                return (
                  <Pressable
                    key={routine.name} accessibilityRole="button" accessibilityState={{ selected: done }}
                    accessibilityLabel={routine.name + ', ' + routineLabel(routine) + (done ? ', 추가됨' : ', 습관에 추가')}
                    onPress={() => add(routine)}
                    style={({ pressed }) => [styles.routine, {
                      backgroundColor: done ? colors.accentSoft : colors.surface, borderColor: done ? colors.accentSoft : colors.border,
                      opacity: pressed ? 0.7 : 1,
                    }]}>
                    <View style={{ flexShrink: 1 }}>
                      <Txt variant="smallStrong" numberOfLines={2} style={{ color: done ? colors.accent : colors.text }}>{routine.name}</Txt>
                      <Txt variant="caption" tone="faint">{routineLabel(routine)}</Txt>
                    </View>
                    <Icon name={done ? 'check' : 'plus'} size={16} color={done ? colors.accent : colors.textFaint} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        <Txt variant="small" tone="faint" style={{ textAlign: 'center' }}>
          원하는 게 없으면 습관 탭의 + 로 직접 만들 수 있습니다. 추가한 습관은 상세 화면에서 알림 시각도 정할 수 있습니다.
        </Txt>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 6, paddingHorizontal: space.lg, paddingBottom: space.sm, alignItems: 'center' },
  board: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  routine: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 9, paddingHorizontal: space.md,
    borderRadius: radius.md, borderWidth: 1, maxWidth: '100%',
  },
});
