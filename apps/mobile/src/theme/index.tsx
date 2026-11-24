import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { accentPalette, type AccentId, DEFAULT_ACCENT, parseAccent } from '@/features/settings/palettes';
import type { Priority } from '@/lib/shared';

export { ACCENTS, type AccentId, type AccentPalette } from '@/features/settings/palettes';

// One accent (blue by default, see 외관) carries every interactive element; red, orange and green appear only where they mean something
// (overdue and P1, P2, done and today), so the screens stay calm and the colours never compete.
const light = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F5F8',
  border: '#E6E9EE',
  text: '#1D2129',
  textMuted: '#667085',
  textFaint: '#A4ACB9',
  accent: '#3574F0',
  accentSoft: '#E8F0FE',
  onAccent: '#FFFFFF',
  success: '#1F9D63',
  successSoft: '#E4F5EC',
  warning: '#E5870B',
  warningSoft: '#FDF0DC',
  danger: '#DC4C3E',
  dangerSoft: '#FCEAE8',
  info: '#3574F0',
  infoSoft: '#E8F0FE',
  schedule: '#3574F0',
  onSchedule: '#FFFFFF',
  overlay: 'rgba(16, 20, 28, 0.42)',
  shadow: '#10141C',
};

const dark: typeof light = {
  background: '#15171A',
  surface: '#1D2024',
  surfaceMuted: '#272B31',
  border: '#31353C',
  text: '#ECEEF1',
  textMuted: '#9BA3AF',
  textFaint: '#687080',
  accent: '#5B8FF7',
  accentSoft: '#1C2A47',
  onAccent: '#FFFFFF',
  success: '#4CC38A',
  successSoft: '#163224',
  warning: '#F0A03C',
  warningSoft: '#3A2A12',
  danger: '#F0685C',
  dangerSoft: '#3E1D1A',
  info: '#5B8FF7',
  infoSoft: '#1C2A47',
  schedule: '#4A82F5',
  onSchedule: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',
};

export type Colors = typeof light;
export type ThemeMode = 'system' | 'light' | 'dark';

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 10, lg: 14, xl: 20, pill: 999 } as const;
/**
 * The app's own typeface, bundled so text looks the same on every phone. Android picks the right file for
 * each fontWeight from the family registered in app.config.ts; the web build falls back to the system font.
 */
export const fontFamily = Platform.OS === 'android' ? 'Pretendard' : undefined;

export const type = {
  title: { fontSize: 26, lineHeight: 32, fontFamily, fontWeight: '800', letterSpacing: -0.3 },
  heading: { fontSize: 20, lineHeight: 26, fontFamily, fontWeight: '700', letterSpacing: -0.2 },
  section: { fontSize: 14, lineHeight: 20, fontFamily, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22, fontFamily, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontFamily, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, fontFamily, fontWeight: '400' },
  smallStrong: { fontSize: 13, lineHeight: 18, fontFamily, fontWeight: '600' },
  caption: { fontSize: 11, lineHeight: 14, fontFamily, fontWeight: '500' },
} as const;

export function priorityColor(colors: Colors, priority: Priority): string {
  return priority === 1 ? colors.danger : priority === 2 ? colors.warning : priority === 3 ? colors.info : colors.textFaint;
}

/** A soft lift for cards and floating controls that reads the same on both platforms. */
export function elevation(colors: Colors, level: 1 | 2 = 1) {
  return Platform.select({
    android: { elevation: level === 1 ? 2 : 8, shadowColor: colors.shadow },
    default: {
      shadowColor: colors.shadow, shadowOpacity: level === 1 ? 0.06 : 0.16,
      shadowRadius: level === 1 ? 6 : 16, shadowOffset: { width: 0, height: level === 1 ? 2 : 6 },
    },
  });
}

interface ThemeValue {
  colors: Colors; isDark: boolean; mode: ThemeMode; setMode: (mode: ThemeMode) => void;
  /** The chosen accent palette (외관 → 강조색); only the interactive colour family changes with it. */
  accent: AccentId; setAccent: (accent: AccentId) => void;
}

const ThemeContext = createContext<ThemeValue>({
  colors: light, isDark: false, mode: 'system', setMode: () => {}, accent: DEFAULT_ACCENT, setAccent: () => {},
});
const STORAGE_KEY = 'dayframe-theme';
const ACCENT_KEY = 'dayframe-accent';

/** One frozen colour object per mode and accent, so a context consumer sees the same object until either changes. */
const colorCache = new Map<string, Colors>();
function colorsFor(isDark: boolean, accent: AccentId): Colors {
  const key = (isDark ? 'dark:' : 'light:') + accent;
  let colors = colorCache.get(key);
  if (!colors) {
    const base = isDark ? dark : light;
    colors = accent === DEFAULT_ACCENT ? base : { ...base, ...accentPalette(accent)[isDark ? 'dark' : 'light'] };
    colorCache.set(key, colors);
  }
  return colors;
}

const isThemeMode = (value: unknown): value is ThemeMode => value === 'light' || value === 'dark' || value === 'system';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  // Mode and accent live in one state so the stored pair arrives in a single repaint at startup.
  const [prefs, setPrefs] = useState<{ mode: ThemeMode; accent: AccentId }>({ mode: 'system', accent: DEFAULT_ACCENT });
  const touched = useRef(false);

  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY, ACCENT_KEY]).then((entries) => {
      if (touched.current) return;
      const stored = Object.fromEntries(entries);
      const mode = isThemeMode(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : 'system';
      const accent = parseAccent(stored[ACCENT_KEY]);
      setPrefs((current) => (current.mode === mode && current.accent === accent ? current : { mode, accent }));
    }).catch(() => {});
  }, []);

  const setMode = useCallback((mode: ThemeMode) => {
    touched.current = true;
    setPrefs((current) => (current.mode === mode ? current : { ...current, mode }));
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  }, []);

  const setAccent = useCallback((accent: AccentId) => {
    touched.current = true;
    setPrefs((current) => (current.accent === accent ? current : { ...current, accent }));
    AsyncStorage.setItem(ACCENT_KEY, accent).catch(() => {});
  }, []);

  const { mode, accent } = prefs;
  const value = useMemo<ThemeValue>(() => {
    const isDark = mode === 'system' ? system === 'dark' : mode === 'dark';
    return { colors: colorsFor(isDark, accent), isDark, mode, setMode, accent, setAccent };
  }, [mode, accent, system, setMode, setAccent]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
