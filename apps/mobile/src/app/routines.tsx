import { router } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, Header, Icon, IconButton, Screen, Txt } from '@/components/ui';
import { useHabitActions, useHabits } from '@/data/habits';
import { HabitAvatar } from '@/features/habits/HabitAvatar';
import { deleteHabitMeta, type HabitTimeOfDay, setHabitMeta } from '@/features/habits/habitMeta';
import { galleryCategories, type Routine, routineGroups, routineKey, routineLabel } from '@/features/habits/routines';
import { KEY_PRIORITY, matchesCombo, useKeyHandler, useListCursor, useScreenContext, useScreenFocused } from '@/features/keyboard';
import { deviceTimeZone } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

const routineName = (routine: Routine) => routine.name;

/** Maps each preset name to its owning category title so 추천 items inherit their natural time of day. */
const groupByRoutineKey: ReadonlyMap<string, string> = new Map(
  routineGroups.flatMap((group) => group.items.map((item) => [routineKey(item.name), group.title] as const)),
);

const AFTERNOON_HINTS = ['오후', '점심', '1시간마다', '20분마다', '바른 자세', '계단'];
const EVENING_HINTS = ['야식', '7시간 이상 자기', '자정 전', '오늘 하루 돌아보기', '저녁', '잠들기'];
const MORNING_HINTS = ['기상', '아침', '출근 전'];

function inferTimeOfDay(routine: Routine): HabitTimeOfDay {
  const groupTitle = groupByRoutineKey.get(routineKey(routine.name));
  if (groupTitle === '아침') return 'morning';
  if (groupTitle === '저녁·마무리') return 'evening';
  if (MORNING_HINTS.some((hint) => routine.name.includes(hint))) return 'morning';
  if (AFTERNOON_HINTS.some((hint) => routine.name.includes(hint))) return 'afternoon';
  if (EVENING_HINTS.some((hint) => routine.name.includes(hint))) return 'evening';
  return 'anytime';
}

const PresetCard = memo(function PresetCard({
  routine, added, focused, onOpen, onQuickAdd,
}: {
  routine: Routine;
  added: boolean;
  focused: boolean;
  onOpen: (routine: Routine) => void;
  onQuickAdd: (routine: Routine) => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ selected: added }}
      accessibilityLabel={`${routine.name}, ${routineLabel(routine)}, ${routine.quote}${added ? ', 이미 추가한 습관' : ', 눌러서 맞춤 추가하기'}`}
      onPress={() => onOpen(routine)}
      style={({ pressed }) => [styles.card, {
        backgroundColor: focused ? colors.accentSoft : colors.surface,
        borderColor: focused ? colors.accent : added ? colors.accentSoft : colors.border,
        opacity: pressed ? 0.78 : 1,
      }]}>
      <HabitAvatar name={routine.name} emoji={routine.emoji} size={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>{routine.name}</Txt>
        <Txt variant="small" tone="muted" numberOfLines={1}>{routine.quote}</Txt>
        <Txt variant="caption" tone="faint">{routineLabel(routine)}</Txt>
      </View>
      {added ? (
        <View style={styles.badge}>
          <Icon name="check" size={11} color={colors.textFaint} />
          <Txt variant="caption" tone="muted" style={{ fontWeight: '600' }}>추가됨</Txt>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${routine.name} 바로 추가`}
          hitSlop={6}
          onPress={() => onQuickAdd(routine)}
          style={({ pressed }) => [
            styles.quickAddBtn,
            {
              backgroundColor: pressed ? colors.border : colors.surfaceMuted,
              borderColor: colors.border,
            },
          ]}>
          <Icon name="plus" size={16} color={colors.accentText} />
        </Pressable>
      )}
    </Pressable>
  );
});

/** 습관 갤러리: ready-made habits by category. Tap `+` to add immediately, or tap a card to customize first. */
export default function Routines() {
  const insets = useSafeAreaInsets();
  const isFocused = useScreenFocused();
  useScreenContext('routines', isFocused);
  const { data: habits } = useHabits();
  const actions = useHabitActions();
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
    const timeOfDay = inferTimeOfDay(routine);
    router.push({
      pathname: '/habit/new',
      params: {
        name: routine.name,
        emoji: routine.emoji,
        color: routine.color,
        quote: routine.quote,
        cadence: routine.cadence ?? 'daily',
        target: String(routine.target ?? 1),
        timeOfDay,
      },
    });
  }, [owned]);

  const quickAdd = useCallback((routine: Routine) => {
    if (owned.has(routineKey(routine.name))) {
      showToast('이미 추가된 습관입니다. 습관 탭에서 확인해 보세요.');
      return;
    }
    const timeOfDay = inferTimeOfDay(routine);
    const id = actions.create({
      name: routine.name,
      cadence: routine.cadence ?? 'daily',
      target_count: routine.target ?? 1,
      timezone: deviceTimeZone(),
    });
    setHabitMeta(id, {
      emoji: routine.emoji,
      color: routine.color,
      quote: routine.quote,
      timeOfDay: timeOfDay !== 'anytime' ? timeOfDay : undefined,
    });
    haptic.success();
    showToast(`‘${routine.name}’ 습관을 추가했습니다.`, {
      actionLabel: '실행 취소',
      onAction: () => {
        haptic.light();
        deleteHabitMeta(id);
        actions.remove(id);
      },
    });
  }, [owned, actions]);

  const cursor = useListCursor(shown.items, routineName, {
    enabled: isFocused,
    scrollRef,
    estimatedRowHeight: 78,
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
        title="습관 갤러리" subtitle="+로 바로 추가하거나 눌러서 맞춤 설정하세요"
        left={<IconButton name="arrow-left" label="뒤로" onPress={() => router.back()} />} />
      <View style={styles.topAction}>
        <Button label="직접 만들기" icon="plus" onPress={() => router.push('/habit/new')} style={{ minHeight: 44 }} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={{ flexGrow: 0, flexShrink: 0 }}>
        {galleryCategories.map((item) => (
          <Chip key={item.title} icon={item.icon} label={item.title} selected={category === item.title} onPress={() => setCategory(item.title)} />
        ))}
      </ScrollView>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, paddingBottom: insets.bottom + space.xl, gap: space.sm }}>
        {shown.items.map((routine) => (
          <PresetCard
            key={routine.name}
            routine={routine}
            added={owned.has(routineKey(routine.name))}
            focused={cursor.focusedId === routine.name}
            onOpen={open}
            onQuickAdd={quickAdd}
          />
        ))}
        <Txt variant="small" tone="faint" style={{ textAlign: 'center', marginTop: space.sm }}>
          추가한 뒤에도 습관 상세 화면에서 아이콘과 응원 문구, 알림 시간을 바꿀 수 있습니다.
        </Txt>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topAction: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  filters: { gap: 6, paddingHorizontal: space.lg, paddingBottom: space.sm, alignItems: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.md,
    borderRadius: radius.lg, borderWidth: 1,
  },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: radius.pill, paddingHorizontal: 7, height: 22 },
  quickAddBtn: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
