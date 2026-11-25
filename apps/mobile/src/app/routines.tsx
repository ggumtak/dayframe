import { router } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, Header, Icon, IconButton, Screen, Txt } from '@/components/ui';
import { useHabits } from '@/data/habits';
import { HabitAvatar } from '@/features/habits/HabitAvatar';
import { galleryCategories, type Routine, routineKey, routineLabel } from '@/features/habits/routines';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

const PresetCard = memo(function PresetCard({ routine, added, onOpen }: { routine: Routine; added: boolean; onOpen: (routine: Routine) => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ selected: added }}
      accessibilityLabel={`${routine.name}, ${routineLabel(routine)}, ${routine.quote}${added ? ', 이미 추가한 습관' : ', 눌러서 추가하기'}`}
      onPress={() => onOpen(routine)}
      style={({ pressed }) => [styles.card, {
        backgroundColor: colors.surface, borderColor: added ? colors.accentSoft : colors.border, opacity: pressed ? 0.7 : 1,
      }]}>
      <HabitAvatar name={routine.name} emoji={routine.emoji} size={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>{routine.name}</Txt>
        <Txt variant="small" tone="muted" numberOfLines={1}>{routine.quote}</Txt>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Txt variant="caption" tone="faint">{routineLabel(routine)}</Txt>
        {added ? (
          <View style={styles.badge}>
            <Icon name="check" size={11} color={colors.textFaint} />
            <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>추가됨</Txt>
          </View>
        ) : <Icon name="chevron-right" size={16} color={colors.textFaint} />}
      </View>
    </Pressable>
  );
});

/** 습관 갤러리: ready-made habits by category. A tap opens the new-habit form filled in from the preset. */
export default function Routines() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data: habits } = useHabits();
  const [category, setCategory] = useState(galleryCategories[0].title);
  const owned = useMemo(
    () => new Set((habits ?? []).filter((habit) => !habit.archived_at).map((habit) => routineKey(habit.name))),
    [habits],
  );
  const shown = useMemo(() => galleryCategories.find((item) => item.title === category) ?? galleryCategories[0], [category]);

  const open = useCallback((routine: Routine) => {
    if (owned.has(routineKey(routine.name))) {
      showToast('이미 추가된 습관입니다. 습관 탭에서 확인해 보세요.');
      return;
    }
    router.push({
      pathname: '/habit/new',
      params: {
        name: routine.name, emoji: routine.emoji, color: routine.color, quote: routine.quote,
        cadence: routine.cadence ?? 'daily', target: String(routine.target ?? 1),
      },
    });
  }, [owned]);

  return (
    <Screen>
      <Header
        title="습관 갤러리" subtitle="마음에 드는 습관을 골라 시작해 보세요"
        left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={{ flexGrow: 0, flexShrink: 0 }}>
        {galleryCategories.map((item) => (
          <Chip key={item.title} icon={item.icon} label={item.title} selected={category === item.title} onPress={() => setCategory(item.title)} />
        ))}
      </ScrollView>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, paddingBottom: space.xl, gap: space.sm }}>
        {shown.items.map((routine) => (
          <PresetCard key={routine.name} routine={routine} added={owned.has(routineKey(routine.name))} onOpen={open} />
        ))}
        <Txt variant="small" tone="faint" style={{ textAlign: 'center', marginTop: space.sm }}>
          추가한 뒤에도 습관 상세 화면에서 아이콘과 응원 문구, 알림 시간을 바꿀 수 있습니다.
        </Txt>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <Button label="직접 만들기" icon="plus" onPress={() => router.push('/habit/new')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 6, paddingHorizontal: space.lg, paddingBottom: space.sm, alignItems: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.md,
    borderRadius: radius.lg, borderWidth: 1,
  },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: radius.pill, paddingHorizontal: 7, height: 20 },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
