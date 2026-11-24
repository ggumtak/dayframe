import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';

import { Button, Chip, Header, Icon, IconButton, Screen, Segmented, Sheet, Txt } from '@/components/ui';
import { useHabitActions } from '@/data/habits';
import { HabitAvatar } from '@/features/habits/HabitAvatar';
import { type HabitLook, HabitLookPicker, QuoteField } from '@/features/habits/HabitLookPicker';
import { HABIT_TIME_GROUPS, type HabitTimeOfDay, setHabitMeta } from '@/features/habits/habitMeta';
import { isHabitColor } from '@/features/habits/palette';
import { deviceTimeZone } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { HabitCadence } from '@/lib/shared';
import { radius, space, type, useTheme } from '@/theme';

const ideas = ['물 2L 마시기', '30분 걷기', '독서 20쪽', '스트레칭', '일기 쓰기'];

/** What the gallery passes in when a preset is tapped; every field is optional and checked before use. */
type Prefill = { name?: string; emoji?: string; color?: string; quote?: string; cadence?: string; target?: string };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default function NewHabit() {
  const { colors } = useTheme();
  const actions = useHabitActions();
  const params = useLocalSearchParams<Prefill>();
  const initialCadence: HabitCadence = one(params.cadence) === 'weekly' ? 'weekly' : 'daily';
  const initialTarget = Math.max(1, Math.min(initialCadence === 'weekly' ? 7 : 20, Math.floor(Number(one(params.target)) || 1)));
  const [name, setName] = useState(() => one(params.name)?.slice(0, 120) ?? '');
  const [cadence, setCadence] = useState<HabitCadence>(initialCadence);
  const [target, setTarget] = useState(initialTarget);
  const [timeOfDay, setTimeOfDay] = useState<HabitTimeOfDay>('anytime');
  const [look, setLook] = useState<HabitLook>(() => {
    const color = one(params.color);
    return { emoji: one(params.emoji) || undefined, color: isHabitColor(color) ? color : undefined };
  });
  const [quote, setQuote] = useState(() => one(params.quote)?.slice(0, 40) ?? '');
  const [picking, setPicking] = useState(false);
  const fromGallery = !!one(params.name);
  const max = cadence === 'weekly' ? 7 : 20;
  const ready = name.trim().length > 0;

  const save = () => {
    if (!ready) return;
    const id = actions.create({ name: name.trim(), cadence, target_count: Math.min(target, max), timezone: deviceTimeZone() });
    const meta = {
      timeOfDay: timeOfDay !== 'anytime' ? timeOfDay : undefined, emoji: look.emoji, color: look.color, quote: quote.trim() || undefined,
    };
    if (Object.values(meta).some(Boolean)) setHabitMeta(id, meta);
    haptic.success();
    router.back();
  };

  return (
    <Screen>
      <Header title="새 습관" right={<IconButton name="x" label="닫기" onPress={() => router.back()} color={colors.textMuted} />} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Pressable
              accessibilityRole="button" accessibilityLabel="아이콘과 색 고르기" hitSlop={4} onPress={() => setPicking(true)}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <HabitAvatar name={name || '습관'} emoji={look.emoji} color={look.color} size={52} />
              <View style={{ position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="edit-2" size={10} color={colors.textMuted} />
              </View>
            </Pressable>
            <TextInput
              value={name} onChangeText={setName} placeholder="습관 이름" placeholderTextColor={colors.textFaint} autoFocus={!fromGallery} maxLength={120}
              returnKeyType="done" onSubmitEditing={save} accessibilityLabel="습관 이름"
              style={[type.body, { flex: 1, minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: space.lg }]} />
          </View>
          {fromGallery ? null : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {ideas.map((idea) => (
                <Button key={idea} label={idea} kind="secondary" onPress={() => setName(idea)} style={{ minHeight: 34, paddingHorizontal: space.md }} />
              ))}
            </View>
          )}

          <View style={{ gap: space.sm }}>
            <Txt variant="section" tone="muted">응원 문구</Txt>
            <QuoteField value={quote} onChange={setQuote} />
          </View>

          <View style={{ gap: space.sm }}>
            <Txt variant="section" tone="muted">주기</Txt>
            <Segmented
              value={cadence} onChange={(value) => {
                setCadence(value);
                setTarget((current) => Math.min(current, value === 'weekly' ? 7 : 20));
              }}
              options={[{ value: 'daily', label: '매일' }, { value: 'weekly', label: '매주' }]} />
          </View>

          <View style={{ gap: space.sm }}>
            <Txt variant="section" tone="muted">실천 시간대</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {HABIT_TIME_GROUPS.map((group) => (
                <Chip
                  key={group.key} icon={group.icon} label={group.label}
                  selected={timeOfDay === group.key}
                  onPress={() => setTimeOfDay(group.key)} />
              ))}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Txt variant="section" tone="muted">{cadence === 'daily' ? '하루 목표 횟수' : '주간 목표 일수'}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
              <IconButton name="minus" label="목표 줄이기" onPress={() => setTarget(Math.max(1, target - 1))} style={{ backgroundColor: colors.surfaceMuted }} />
              <Txt variant="heading" style={{ minWidth: 56, textAlign: 'center' }} accessibilityLiveRegion="polite">
                {target}{cadence === 'daily' ? '회' : '일'}
              </Txt>
              <IconButton name="plus" label="목표 늘리기" onPress={() => setTarget(Math.min(max, target + 1))} style={{ backgroundColor: colors.surfaceMuted }} />
            </View>
            <Txt variant="small" tone="faint">주기와 목표는 기록의 일관성을 위해 만든 뒤에는 바꿀 수 없습니다.</Txt>
          </View>

          <Button label="습관 만들기" onPress={save} disabled={!ready} />
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="아이콘과 색">
        <View style={{ gap: space.lg }}>
          <HabitLookPicker name={name} look={look} onChange={setLook} />
          <Button label="완료" onPress={() => setPicking(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
