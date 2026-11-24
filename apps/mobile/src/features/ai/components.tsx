import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, Header, Icon, type IconName, IconButton, Loading, Screen, Txt } from '@/components/ui';
import { showToast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

import type { AiResult } from './client';
import { AI_ERROR_TEXT, type AiErrorKind } from './errors';
import { useAiKeyStatus } from './keyStore';
import { usageLine } from './models';
import { AI_ROUTES } from './routes';

/**
 * Page frame for the AI screens: back button, title, scrolling body and an optional pinned footer. The
 * footer's buttons all send a request, so it is hidden while no key is saved.
 */
export function AiScreen({ title, subtitle, right, children, footer, scroll = true }: {
  title: string; subtitle?: string; right?: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { hasKey } = useAiKeyStatus();
  return (
    <Screen>
      <Header
        title={title} subtitle={subtitle} right={right}
        left={<IconButton name="arrow-left" label="뒤로" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />} />
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>{children}</ScrollView>
      ) : <View style={{ flex: 1 }}>{children}</View>}
      {footer && hasKey ? <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: space.lg + insets.bottom }]}>{footer}</View> : null}
    </Screen>
  );
}

/** Shown by every feature screen until a key is saved. */
export function NeedKey({ onLeave }: { onLeave?: () => void }) {
  return (
    <EmptyState
      icon="key" title="키가 필요합니다"
      message="AI 비서는 내 Anthropic 키로 동작합니다. 키를 저장하면 바로 쓸 수 있습니다."
      action={<Button label="키 저장하기" icon="key" onPress={() => { onLeave?.(); router.push(AI_ROUTES.key); }} style={{ marginTop: space.sm }} />} />
  );
}

/**
 * Wraps a feature screen's body: a spinner while the key is read, the "키가 필요합니다" state without one,
 * and the feature itself otherwise.
 */
export function KeyGate({ children, onLeave }: { children: ReactNode; onLeave?: () => void }) {
  const { ready, hasKey } = useAiKeyStatus();
  if (!ready) return <Loading />;
  if (!hasKey) return <NeedKey onLeave={onLeave} />;
  return <>{children}</>;
}

export function AiLoading({ message, onCancel }: { message: string; onCancel: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.accent} size="large" />
      <Txt variant="bodyStrong" style={{ textAlign: 'center' }}>{message}</Txt>
      <Txt variant="small" tone="muted" style={{ textAlign: 'center' }}>보통 10~30초 걸립니다.</Txt>
      <Button label="취소" kind="secondary" onPress={onCancel} style={{ marginTop: space.sm, minWidth: 120 }} />
    </View>
  );
}

const KEY_PROBLEMS: AiErrorKind[] = ['no_key', 'bad_key', 'no_credit', 'permission', 'model_unavailable', 'spend_limit'];

/**
 * The technical line behind an error, folded under "자세히" with a copy button, so the owner can send it to
 * the developer. It never holds the key or what was sent (see describeHttpFailure).
 */
export function ErrorDetail({ detail, align = 'center' }: { detail: string | null | undefined; align?: 'center' | 'left' }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  if (!detail) return null;
  const copy = async () => {
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(detail);
      showToast('자세한 내용을 복사했습니다.');
    } catch {
      showToast('복사하지 못했습니다. 글자를 길게 눌러 복사해 주세요.', { tone: 'error' });
    }
  };
  return (
    <View style={{ alignItems: align === 'center' ? 'center' : 'flex-start', gap: space.xs, alignSelf: 'stretch' }}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={open ? '자세히 접기' : '자세히'} accessibilityState={{ expanded: open }}
        hitSlop={8} onPress={() => setOpen((value) => !value)} style={styles.detailToggle}>
        <Txt variant="caption" tone="faint">자세히</Txt>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textFaint} />
      </Pressable>
      {open ? (
        <View style={[styles.detail, { backgroundColor: colors.surfaceMuted }]}>
          <Txt variant="caption" tone="muted" selectable style={{ flex: 1 }}>{detail}</Txt>
          <Pressable accessibilityRole="button" accessibilityLabel="자세한 내용 복사" hitSlop={8} onPress={() => void copy()} style={styles.detailCopy}>
            <Icon name="copy" size={13} color={colors.accent} />
            <Txt variant="caption" tone="accent">복사</Txt>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function AiErrorView({ kind, detail, onRetry, onLeave }: {
  kind: AiErrorKind; detail?: string | null; onRetry: () => void; onLeave?: () => void;
}) {
  const text = AI_ERROR_TEXT[kind];
  const icon: IconName = kind === 'offline' ? 'wifi-off' : KEY_PROBLEMS.includes(kind) ? 'key' : 'alert-circle';
  return (
    <EmptyState
      icon={icon} title={text.title} message={text.message}
      action={(
        <View style={{ gap: space.sm, marginTop: space.sm, alignSelf: 'stretch', paddingHorizontal: space.xl }}>
          {KEY_PROBLEMS.includes(kind) ? <Button label="AI 비서 설정" icon="key" onPress={() => { onLeave?.(); router.push(AI_ROUTES.key); }} /> : null}
          <Button label="다시 시도" icon="refresh-cw" kind={KEY_PROBLEMS.includes(kind) ? 'secondary' : 'primary'} onPress={onRetry} />
          <ErrorDetail detail={detail} />
        </View>
      )} />
  );
}

/** "입력 1,234 · 출력 567 토큰 · 약 $0.02", small and muted under a result. */
export function UsageLine({ result }: { result: Pick<AiResult<unknown>, 'model' | 'usage'> }) {
  return (
    <Txt variant="caption" tone="faint" style={{ textAlign: 'center', marginTop: space.md }}>
      {usageLine(result.model, result.usage)}
    </Txt>
  );
}

/** A tappable row with a checkbox look, used by every preview list. */
export function Toggle({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} hitSlop={8} onPress={onPress}
      style={[styles.toggle, { borderColor: on ? colors.accent : colors.textFaint, backgroundColor: on ? colors.accent : 'transparent' }]}>
      {on ? <Icon name="check" size={14} color={colors.onAccent} /> : null}
    </Pressable>
  );
}

/** The muted card that opens a result: what the AI says about it, in its own words. */
export function NoteCard({ icon = 'message-circle', children }: { icon?: IconName; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: colors.accentSoft }]}>
      <Icon name={icon} size={16} color={colors.accent} />
      <Txt variant="small" style={{ flex: 1 }}>{children}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.md, flexGrow: 1 },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, borderTopWidth: StyleSheet.hairlineWidth, gap: space.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl, minHeight: 320 },
  toggle: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  detailToggle: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 28 },
  detail: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.sm, borderRadius: radius.sm, alignSelf: 'stretch' },
  detailCopy: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  note: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, alignItems: 'flex-start' },
});
