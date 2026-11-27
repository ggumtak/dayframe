import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AiIcon } from '@/components/AiIcon';
import { Icon, type IconName, IconButton, Txt } from '@/components/ui';
import { AiScreen } from '@/features/ai/components';
import { useAiKeyStatus } from '@/features/ai/keyStore';
import { AI_MODELS } from '@/features/ai/models';
import { useAiPrefs } from '@/features/ai/prefs';
import { AI_ROUTES } from '@/features/ai/routes';
import { KEY_PRIORITY, matchesCombo, useKeyHandler, useScreenFocused } from '@/features/keyboard';
import { fontFamily, radius, space, useTheme } from '@/theme';

const TOOLS: readonly { icon: IconName; name: string; tag: string; route: string }[] = [
  { icon: 'edit-3', name: '메모 정리', tag: '메모 → 할 일', route: AI_ROUTES.organize },
  { icon: 'clock', name: '하루 계획', tag: '시간 배치', route: AI_ROUTES.plan },
  { icon: 'layers', name: '큰 일 쪼개기', tag: '단계 나누기', route: AI_ROUTES.breakdown },
  { icon: 'bar-chart-2', name: '주간 돌아보기', tag: '7일 요약', route: AI_ROUTES.review },
];

const SHORTCUT_ROUTES = [AI_ROUTES.ask, ...TOOLS.map((tool) => tool.route)] as const;

function ToolTile({ icon, name, tag, onPress }: { icon: IconName; name: string; tag: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityHint={tag}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.72 : 1 },
      ]}>
      <Icon name={icon} size={20} color={colors.textMuted} />
      <View style={styles.tileText}>
        <Txt variant="bodyStrong" numberOfLines={1}>{name}</Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>{tag}</Txt>
      </View>
    </Pressable>
  );
}

/** AI 비서: direct free-form prompt bar and compact 2×2 tool tiles. */
export default function AssistantHub() {
  const { colors } = useTheme();
  const isFocused = useScreenFocused();
  const { ready, hasKey } = useAiKeyStatus();
  const { model } = useAiPrefs();
  const [prompt, setPrompt] = useState('');
  const modelName = AI_MODELS.find((item) => item.id === model)?.name ?? model;

  const submitPrompt = () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      router.push(AI_ROUTES.ask);
      return;
    }
    setPrompt('');
    router.push(`${AI_ROUTES.ask}?q=${encodeURIComponent(trimmed)}` as never);
  };

  useKeyHandler(
    (event) => {
      if (event.editing) return false;
      if (!event.ctrl && !event.alt && !event.meta && !event.shift && ['1', '2', '3', '4', '5'].includes(event.key)) {
        const route = SHORTCUT_ROUTES[Number(event.key) - 1];
        if (route) {
          if (!event.repeat) router.push(route as never);
          return true;
        }
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
    <AiScreen
      title="AI 비서"
      subtitle={hasKey ? modelName : undefined}
      right={<IconButton name="settings" label="AI 비서 설정" onPress={() => router.push(AI_ROUTES.key)} />}>
      {ready && !hasKey ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="먼저 키를 저장해 주세요"
            accessibilityHint="Anthropic API 키 필요"
            onPress={() => router.push(AI_ROUTES.key)}
            style={({ pressed }) => [
              styles.banner,
              { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.75 : 1 },
            ]}>
            <Icon name="key" size={20} color={colors.accentText} />
            <View style={styles.bannerText}>
              <Txt variant="bodyStrong">먼저 키를 저장해 주세요</Txt>
              <Txt variant="small" tone="muted">Anthropic API 키 필요</Txt>
            </View>
            <Icon name="chevron-right" size={18} color={colors.textFaint} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="자유 부탁"
            onPress={() => router.push(AI_ROUTES.ask)}
            style={({ pressed }) => [
              styles.askLink,
              { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.72 : 1 },
            ]}>
            <AiIcon size={18} color={colors.textMuted} />
            <Txt variant="bodyStrong" style={{ flex: 1 }}>자유 부탁</Txt>
            <Icon name="chevron-right" size={16} color={colors.textFaint} />
          </Pressable>
        </>
      ) : null}

      {hasKey ? (
        <View style={[styles.promptBar, { backgroundColor: colors.surfaceMuted }]}>
          <AiIcon size={18} color={colors.accentText} />
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="무엇을 도와드릴까요?"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="무엇을 도와드릴까요?"
            returnKeyType="send"
            onSubmitEditing={submitPrompt}
            style={[styles.promptInput, { color: colors.text, fontFamily }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="자유 부탁"
            onPress={submitPrompt}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
            ]}>
            <Icon name="arrow-up" size={16} color={colors.onAccent} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.grid}>
        {[TOOLS.slice(0, 2), TOOLS.slice(2, 4)].map((pair, rowIndex) => (
          <View key={rowIndex} style={styles.gridRow}>
            {pair.map((tool) => (
              <ToolTile
                key={tool.route}
                icon={tool.icon}
                name={tool.name}
                tag={tool.tag}
                onPress={() => router.push(tool.route as never)}
              />
            ))}
          </View>
        ))}
      </View>
    </AiScreen>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    padding: space.md,
  },
  bannerText: { flex: 1, gap: 2 },
  askLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 48,
  },
  promptBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    paddingLeft: space.md,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 52,
  },
  promptInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 6,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { gap: space.sm },
  gridRow: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.md,
    minHeight: 104,
    justifyContent: 'space-between',
  },
  tileText: { gap: 2 },
});
