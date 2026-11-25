import { type Href, router, useSegments } from 'expo-router';
import { useCallback } from 'react';

import { useQuickAdd } from '@/features/quick-add/QuickAdd';
import { type TabName, visibleTabs } from '@/features/settings/tabBar';
import { useTabBarConfig } from '@/features/settings/tabBarStore';
import { haptic } from '@/lib/haptics';
import { emitTabReselect } from '@/lib/tabScroll';
import { triggerActiveToastAction } from '@/lib/toast';

import { useKeyboard, useKeyHandler } from './manager';
import { matchesCombo } from './normalize';
import { type HardwareKeyEvent, KEY_PRIORITY } from './types';

function tabRoute(name: TabName): Href {
  switch (name) {
    case 'index':
      return '/';
    case 'inbox':
      return '/inbox';
    case 'upcoming':
      return '/upcoming';
    case 'habits':
      return '/habits';
    case 'focus':
      return '/focus';
  }
}

export function GlobalShortcuts() {
  const segments: string[] = useSegments();
  const quickAdd = useQuickAdd();
  const tabConfig = useTabBarConfig();
  const { togglePalette, toggleHelp, blurActiveInput } = useKeyboard();

  const navigateToTab = useCallback(
    (digit: number) => {
      const name = visibleTabs(tabConfig)[digit - 1];
      if (!name) return;
      haptic.tap();
      if (segments[0] === '(tabs)' && (segments[1] ?? 'index') === name) {
        emitTabReselect(name);
      } else {
        router.navigate(tabRoute(name));
      }
    },
    [segments, tabConfig],
  );

  const handleKey = useCallback(
    (event: HardwareKeyEvent): boolean => {
      const digit =
        event.key.length === 1 && event.key >= '1' && event.key <= '5' ? Number(event.key) : 0;

      // Always active, including while editing inside a text input.
      if (matchesCombo(event, 'mod+k')) {
        if (!event.repeat) togglePalette();
        return true;
      }
      if (matchesCombo(event, 'mod+/') || matchesCombo(event, 'f1')) {
        if (!event.repeat) toggleHelp();
        return true;
      }
      if (matchesCombo(event, 'ctrl+shift+a') || matchesCombo(event, 'ctrl+n')) {
        if (!event.repeat) quickAdd.open();
        return true;
      }
      if (matchesCombo(event, 'mod+f')) {
        if (!event.repeat && segments[0] !== 'search') {
          router.push('/search');
        }
        return true;
      }
      if (digit > 0 && event.alt && !event.ctrl && !event.meta && !event.shift) {
        if (!event.repeat) navigateToTab(digit);
        return true;
      }
      if (event.editing && matchesCombo(event, 'escape')) {
        if (!event.repeat) blurActiveInput();
        return true;
      }

      if (event.editing || event.modal) {
        return false;
      }

      // Single-key and navigation shortcuts when not editing and no modal sheet is open.
      if (matchesCombo(event, '?')) {
        if (!event.repeat) toggleHelp();
        return true;
      }
      if (matchesCombo(event, 'q')) {
        if (!event.repeat) quickAdd.open();
        return true;
      }
      if (matchesCombo(event, 'n')) {
        if (!event.repeat) {
          if (segments[0] === '(tabs)' && segments[1] === 'habits') {
            router.push('/habit/new');
          } else {
            quickAdd.open();
          }
        }
        return true;
      }
      if (matchesCombo(event, 'shift+n')) {
        if (!event.repeat) router.push('/habit/new');
        return true;
      }
      if (matchesCombo(event, '/')) {
        if (!event.repeat && segments[0] !== 'search') {
          router.push('/search');
        }
        return true;
      }
      if (matchesCombo(event, ',')) {
        if (!event.repeat && segments[0] !== 'settings') {
          router.push('/settings');
        }
        return true;
      }
      if (digit > 0 && !event.ctrl && !event.alt && !event.meta && !event.shift) {
        if (!event.repeat) navigateToTab(digit);
        return true;
      }
      if (matchesCombo(event, 'u') || matchesCombo(event, 'mod+z')) {
        if (!event.repeat && triggerActiveToastAction()) {
          haptic.tap();
          return true;
        }
        return false;
      }
      if (matchesCombo(event, 'escape')) {
        if (!router.canGoBack()) return false;
        if (!event.repeat) router.back();
        return true;
      }

      return false;
    },
    [blurActiveInput, navigateToTab, quickAdd, segments, toggleHelp, togglePalette],
  );

  useKeyHandler(handleKey, { priority: KEY_PRIORITY.global });

  return null;
}
