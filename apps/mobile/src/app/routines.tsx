import { router } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, Header, Icon, IconButton, Screen, Txt } from '@/components/ui';
import { useHabits } from '@/data/habits';
import { HabitAvatar } from '@/features/habits/HabitAvatar';
import { galleryCategories, type Routine, routineKey, routineLabel } from '@/features/habits/routines';
import { KEY_PRIORITY, matchesCombo, useKeyHandler, useListCursor, useScreenContext, useScreenFocused } from '@/features/keyboard';
import { haptic } from '@/lib/haptics';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

const routineName = (routine: Routine) => routine.name;

const PresetCard = memo(function PresetCard({
  routine, added, focused, onOpen,
}: {
  routine: Routine; added: boolean; focused: boolean; onOpen: (routine: Routine) => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ selected: added }}
      accessibilityLabel={`${routine.name}, ${routineLabel(routine)}, ${routine.quote}${added ? ', 이미 추가한 습관' : ', 눌러서 추가하기'}`}
      onPress={() => onOpen(routine)}
      style={({ pressed }) => [styles.card, {
        backgroundColor: focused ? colors.accentSoft : colors.surface,
        borderColor: focused ? colors.accent : added ? colors.accentSoft : colors.border,
        opacity: pressed ? 0.7 : 1,
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
  const isFocused = useScreenFocused();
  useScreenContext('routines', isFocused);
  const { data: habits } = useHabits();
  const [category, setCategory] = useState(galleryCategories[0].title);
  const scrollRef = useRef<ScrollViewInstance>(null);
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

  const cursor = useListCursor(shown.items, routineName, {
    enabled: isFocused,
    scrollRef,
    estimatedRowHeight: 74,
  });

  const switchCategory = (delta: -1 | 1) => {
    const idx = galleryCategories.findIndex((item) => item.title === category);
    const current = idx >= 0 ? idx : 0;
    const next = (current + delta + galleryCategories.length) % galleryCategories.length;
    haptic.tap();
    setCategory(galleryCategories[next].title);
    cursor.clear();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  useKeyHandler(
    (event) => {
      if (event.editing) return false;
      if (matchesCombo(event, '[') || matchesCombo(event, 'arrowleft')) {
        switchCategory(-1);
        return true;
      }
      if (matchesCombo(event, ']') || matchesCombo(event, 'arrowright')) {
        switchCategory(1);
        return true;
      }
      if (matchesCombo(event, 'j') || matchesCombo(event, 'arrowdown')) {
        cursor.move(1);
        return true;
      }
      if (matchesCombo(event, 'k') || matchesCombo(event, 'arrowup')) {
        cursor.move(-1);
        return true;
      }
      if (matchesCombo(event, 'enter') || matchesCombo(event, 'space')) {
        if (cursor.focusedItem) {
          if (!event.repeat) open(cursor.focusedItem);
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'n')) {
        if (!event.repeat) router.push('/habit/new');
        return true;
      }
      if (matchesCombo(event, 'escape') || matchesCombo(event, 'backspace')) {
        if (!event.repeat) router.back();
        return true;
      }
      return false;
    },
    { priority: KEY_PRIORITY.screen, enabled: isFocused },
  );

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
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, paddingBottom: space.xl, gap: space.sm }}>
        {shown.items.map((routine) => (
          <PresetCard
            key={routine.name} routine={routine} added={owned.has(routineKey(routine.name))}
            focused={cursor.focusedId === routine.name} onOpen={open} />
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
