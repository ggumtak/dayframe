import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';

import type { Priority } from '@/lib/shared';

const light = {
  background: '#FAFAF8',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F0EC',
  border: '#E7E5E0',
  text: '#1B1B1F',
  textMuted: '#6E6E78',
  textFaint: '#A3A3AD',
  accent: '#5B5BD6',
  accentSoft: '#ECECFB',
  onAccent: '#FFFFFF',
  success: '#2F9E6B',
  successSoft: '#E3F4EC',
  warning: '#D9822B',
  warningSoft: '#FBEFDF',
  danger: '#D6454B',
  dangerSoft: '#FBE7E8',
  info: '#3B82C4',
  infoSoft: '#E4EFF9',
  overlay: 'rgba(15, 15, 20, 0.38)',
  shadow: '#1B1B1F',
};

const dark: typeof light = {
  background: '#0F0F11',
  surface: '#19191C',
  surfaceMuted: '#232327',
  border: '#2C2C31',
  text: '#F2F2F4',
  textMuted: '#A0A0AA',
  textFaint: '#6B6B75',
  accent: '#8E8EF5',
  accentSoft: '#26264A',
  onAccent: '#0F0F11',
  success: '#52C08D',
  successSoft: '#17362A',
  warning: '#E9A050',
  warningSoft: '#3A2A14',
  danger: '#EF6B70',
  dangerSoft: '#3D1C1E',
  info: '#6AAAE6',
  infoSoft: '#16293C',
  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',
};

export type Colors = typeof light;
export type ThemeMode = 'system' | 'light' | 'dark';

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
export const type = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  section: { fontSize: 13, lineHeight: 18, fontWeight: '600', letterSpacing: 0.3 },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  smallStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
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

interface ThemeValue { colors: Colors; isDark: boolean; mode: ThemeMode; setMode: (mode: ThemeMode) => void }

const ThemeContext = createContext<ThemeValue>({ colors: light, isDark: false, mode: 'system', setMode: () => {} });
const STORAGE_KEY = 'dayframe-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') setModeState(stored);
    }).catch(() => {});
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const isDark = mode === 'system' ? system === 'dark' : mode === 'dark';
    return {
      colors: isDark ? dark : light, isDark, mode,
      setMode: (next) => {
        setModeState(next);
        AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      },
    };
  }, [mode, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
