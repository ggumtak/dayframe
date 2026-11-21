import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';

import type { Priority } from '@/lib/shared';

// One blue carries every interactive element; red, orange and green appear only where they mean something
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
