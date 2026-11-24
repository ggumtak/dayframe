import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { type AccentId, DEFAULT_ACCENT, parseAccent } from '@/features/settings/palettes';

import { type Colors, colorsFor } from './tokens';

export { ACCENTS, type AccentId, type AccentPalette } from '@/features/settings/palettes';
export type { Colors } from './tokens';

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
  colors: colorsFor(false, DEFAULT_ACCENT), isDark: false, mode: 'system', setMode: () => {}, accent: DEFAULT_ACCENT, setAccent: () => {},
});
const STORAGE_KEY = 'dayframe-theme';
const ACCENT_KEY = 'dayframe-accent';

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
      // A retired accent (주황, 분홍, 초록) reads back as blue; store that so it stays blue.
      if (stored[ACCENT_KEY] && stored[ACCENT_KEY] !== accent) AsyncStorage.setItem(ACCENT_KEY, accent).catch(() => {});
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
