import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, TextInput, View } from 'react-native';

import { Button, Header, IconButton, Screen, Segmented, Txt } from '@/components/ui';
import { useHabitActions } from '@/data/habits';
import { deviceTimeZone } from '@/lib/dates';
import { haptic } from '@/lib/haptics';
import type { HabitCadence } from '@/lib/shared';
import { radius, space, type, useTheme } from '@/theme';

const ideas = ['물 2L 마시기', '30분 걷기', '독서 20쪽', '스트레칭', '일기 쓰기'];

export default function NewHabit() {
  const { colors } = useTheme();
  const actions = useHabitActions();
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<HabitCadence>('daily');
  const [target, setTarget] = useState(1);
  const max = cadence === 'weekly' ? 7 : 20;
  const ready = name.trim().length > 0;

  const save = () => {
    if (!ready) return;
    actions.create({ name: name.trim(), cadence, target_count: Math.min(target, max), timezone: deviceTimeZone() });
    haptic.success();
    router.back();
  };

  return (
    <Screen>
      <Header title="새 습관" right={<IconButton name="x" label="닫기" onPress={() => router.back()} color={colors.textMuted} />} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <TextInput
            value={name} onChangeText={setName} placeholder="습관 이름" placeholderTextColor={colors.textFaint} autoFocus maxLength={120}
            returnKeyType="done" onSubmitEditing={save} accessibilityLabel="습관 이름"
            style={[type.body, { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: space.lg }]} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {ideas.map((idea) => (
              <Button key={idea} label={idea} kind="secondary" onPress={() => setName(idea)} style={{ minHeight: 34, paddingHorizontal: space.md }} />
            ))}
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
    </Screen>
  );
}
