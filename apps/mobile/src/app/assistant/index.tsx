import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName, IconButton, Txt } from '@/components/ui';
import { AiScreen } from '@/features/ai/components';
import { useAiKeyStatus } from '@/features/ai/keyStore';
import { AI_MODELS } from '@/features/ai/models';
import { useAiPrefs } from '@/features/ai/prefs';
import { AI_ROUTES } from '@/features/ai/routes';
import { radius, space, useTheme } from '@/theme';

const FEATURES: { icon: IconName; name: string; description: string; route: string }[] = [
  { icon: 'edit-3', name: '메모 정리', description: '머릿속 메모를 바로 추가할 수 있는 할 일로 바꿉니다.', route: AI_ROUTES.organize },
  { icon: 'clock', name: '하루 계획', description: '오늘 할 일을 남은 시간에 맞춰 배치합니다.', route: AI_ROUTES.plan },
  { icon: 'layers', name: '큰 일 쪼개기', description: '막막한 할 일을 바로 시작할 수 있는 하위 작업으로 나눕니다.', route: AI_ROUTES.breakdown },
  { icon: 'bar-chart-2', name: '주간 돌아보기', description: '지난 7일의 완료, 습관, 집중 기록을 돌아봅니다.', route: AI_ROUTES.review },
];

/**
 * One feature as a plain row (no card, no coloured icon tile): the name carries it. The key prompt, shown while no
 * key is saved, is the one row with an accent mark, because it is the only thing to do first.
 */
function FeatureCard({ icon, name, description, onPress, highlight }: {
  icon: IconName; name: string; description: string; onPress: () => void; highlight?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={name} accessibilityHint={description} onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        highlight ? { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: space.md } : { borderBottomColor: colors.border },
        !highlight && styles.divider, pressed && { opacity: 0.7 },
      ]}>
      <Icon name={icon} size={20} color={highlight ? colors.accentText : colors.textMuted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong">{name}</Txt>
        <Txt variant="small" tone="muted">{description}</Txt>
      </View>
      <Icon name="chevron-right" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

/** AI 비서: the four features, and the way to the key when none is saved. */
export default function AssistantHub() {
  const { ready, hasKey } = useAiKeyStatus();
  const { model } = useAiPrefs();
  const modelName = AI_MODELS.find((item) => item.id === model)?.name ?? model;
  return (
    <AiScreen
      title="AI 비서" subtitle={hasKey ? `${modelName} · 내 Anthropic 키` : undefined}
      right={<IconButton name="settings" label="AI 비서 설정" onPress={() => router.push(AI_ROUTES.key)} />}>
      {ready && !hasKey ? (
        <FeatureCard
          highlight icon="key" name="먼저 키를 저장해 주세요"
          description="AI 비서는 내 Anthropic 키로 동작하고, 쓴 만큼만 요금이 청구됩니다."
          onPress={() => router.push(AI_ROUTES.key)} />
      ) : null}
      {FEATURES.map((feature) => (
        <FeatureCard key={feature.route} {...feature} onPress={() => router.push(feature.route as never)} />
      ))}
      <Txt variant="caption" tone="faint" style={{ textAlign: 'center', marginTop: space.sm }}>
        AI가 제안한 내용은 미리 보고 고른 것만 반영됩니다.
      </Txt>
    </AiScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth },
});
