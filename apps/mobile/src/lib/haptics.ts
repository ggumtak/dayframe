import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const safely = (run: () => Promise<void>) => {
  if (Platform.OS !== 'web') run().catch(() => {});
};

/** Small tactile cues; silently skipped where the platform has none. */
export const haptic = {
  tap: () => safely(() => Haptics.selectionAsync()),
  light: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
