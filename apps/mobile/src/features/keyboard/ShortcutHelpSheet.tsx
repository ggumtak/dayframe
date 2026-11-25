import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  BackHandler,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Txt } from '@/components/ui';
import { useLayout } from '@/lib/layoutContext';
import { elevation, radius, space, type, useTheme } from '@/theme';

import { sectionsForContext } from './catalog';
import { useKeyboard, useKeyHandler } from './manager';
import { formatKeyLabel, matchesCombo } from './normalize';
import { type HardwareKeyEvent, KEY_PRIORITY, type ShortcutEntry, type ShortcutSection } from './types';

const SMALL_SCROLL_STEP = 120;
const PAGE_SCROLL_STEP = 320;

function KeycapPill({ combo }: { combo: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.keycap, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
      <Text style={[type.caption as TextStyle, styles.keycapText, { color: colors.text }]}>
        {formatKeyLabel(combo)}
      </Text>
    </View>
  );
}

function ShortcutRow({ entry, showDivider }: { entry: ShortcutEntry; showDivider: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.row,
        showDivider ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null,
      ]}>
      <View style={styles.rowText}>
        <Txt variant="body" numberOfLines={2}>{entry.label}</Txt>
        {entry.detail ? (
          <Txt variant="small" tone="muted" numberOfLines={2}>{entry.detail}</Txt>
        ) : null}
      </View>
      <View style={styles.keycapGroup}>
        {entry.keys.map((key, index) => (
          <KeycapPill key={`${key}-${index}`} combo={key} />
        ))}
      </View>
    </View>
  );
}

function ShortcutSectionBlock({ section, isCurrent }: { section: ShortcutSection; isCurrent: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Txt variant="section" tone="muted" accessibilityRole="header">{section.title}</Txt>
        {isCurrent ? (
          <View style={[styles.currentBadge, { backgroundColor: colors.accentSoft }]}>
            <Text style={[type.caption as TextStyle, styles.currentBadgeText, { color: colors.accentText }]}>
              현재 화면
            </Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {section.items.map((entry, index) => (
          <ShortcutRow key={`${section.id}-${entry.label}-${index}`} entry={entry} showDivider={index > 0} />
        ))}
      </View>
    </View>
  );
}

function ShortcutHelpOverlay() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { sheet } = useLayout();
  const { screenContext, helpOpen, closeHelp } = useKeyboard();

  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);

  const sections = useMemo(() => sectionsForContext(screenContext), [screenContext]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeHelp();
      return true;
    });
    return () => subscription.remove();
  }, [closeHelp]);

  const scrollBy = useCallback((delta: number) => {
    const maxScroll = Math.max(0, contentHeightRef.current - viewportHeightRef.current);
    const unclamped = scrollYRef.current + delta;
    const nextY = contentHeightRef.current > 0
      ? Math.max(0, Math.min(maxScroll, unclamped))
      : Math.max(0, unclamped);
    scrollYRef.current = nextY;
    scrollRef.current?.scrollTo({ y: nextY, animated: true });
  }, []);

  const handleKey = useCallback(
    (event: HardwareKeyEvent): boolean => {
      if (
        matchesCombo(event, 'escape')
        || matchesCombo(event, '?')
        || matchesCombo(event, 'mod+/')
        || matchesCombo(event, 'f1')
      ) {
        closeHelp();
        return true;
      }
      if (matchesCombo(event, 'j') || matchesCombo(event, 'arrowdown')) {
        scrollBy(SMALL_SCROLL_STEP);
        return true;
      }
      if (matchesCombo(event, 'k') || matchesCombo(event, 'arrowup')) {
        scrollBy(-SMALL_SCROLL_STEP);
        return true;
      }
      if (matchesCombo(event, 'pagedown') || matchesCombo(event, 'space')) {
        scrollBy(PAGE_SCROLL_STEP);
        return true;
      }
      if (matchesCombo(event, 'pageup')) {
        scrollBy(-PAGE_SCROLL_STEP);
        return true;
      }
      return true;
    },
    [closeHelp, scrollBy],
  );

  useKeyHandler(handleKey, { priority: KEY_PRIORITY.help, enabled: helpOpen });

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    viewportHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeightRef.current = height;
  }, []);

  const cardMaxHeight = Math.max(280, sheet.maxHeight - space.xl);

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        { paddingTop: insets.top + space.lg, paddingBottom: Math.max(insets.bottom, space.lg) },
      ]}
      pointerEvents="box-none"
      accessibilityViewIsModal>
      <Animated.View entering={FadeIn.duration(140)} style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="키보드 단축키 닫기"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={closeHelp} />
      </Animated.View>

      <Animated.View
        entering={FadeInDown.duration(180)}
        style={[
          styles.dialog,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            maxHeight: cardMaxHeight,
          },
          sheet.maxWidth !== undefined ? { maxWidth: sheet.maxWidth } : null,
          elevation(colors, 2),
        ]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerText}>
            <Txt variant="heading" accessibilityRole="header">키보드 단축키</Txt>
            <Txt variant="small" tone="muted">한글 입력 상태에서도 모든 단축키가 동작합니다</Txt>
          </View>
          <IconButton name="x" label="닫기" size={20} color={colors.textMuted} onPress={closeHelp} />
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          onLayout={handleViewportLayout}
          onContentSizeChange={handleContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator>
          {sections.map((section, index) => (
            <ShortcutSectionBlock
              key={section.id}
              section={section}
              isCurrent={index === 0 && section.id === screenContext && section.id !== 'global'} />
          ))}
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: colors.surfaceMuted, borderTopColor: colors.border }]}>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            ↑↓ / J·K 스크롤 · Esc 또는 ? 닫기
          </Txt>
        </View>
      </Animated.View>
    </View>
  );
}

export function ShortcutHelpSheet() {
  const { helpOpen } = useKeyboard();
  if (!helpOpen) return null;
  return <ShortcutHelpOverlay />;
}

const styles = StyleSheet.create({
  overlay: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    zIndex: 100,
  },
  dialog: {
    width: '100%',
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    padding: space.lg,
    gap: space.lg,
  },
  section: {
    gap: space.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  currentBadge: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  currentBadgeText: {
    fontWeight: '700',
  },
  sectionCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 10,
    minHeight: 44,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  keycapGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
    flexShrink: 0,
  },
  keycap: {
    minWidth: 26,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keycapText: {
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
});
