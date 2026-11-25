import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { Platform } from 'react-native';

/** The moments worth interrupting for: a focus round ending and a break ending. */
export type AlertKey = 'focus' | 'rest';

const CHANNEL = 'focus-timer';
const supported = Platform.OS !== 'web';
let prepared: Promise<boolean> | undefined;

async function prepare(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: '집중 타이머', importance: AndroidImportance.HIGH, vibrationPattern: [0, 300, 200, 300],
      lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Asks for permission the first time a timer starts. Resolves false when alerts cannot be shown;
 * the timer itself still works, it just ends silently unless the app is open.
 */
export function prepareAlerts(): Promise<boolean> {
  if (!supported) return Promise.resolve(false);
  prepared ??= prepare()
    .catch(() => false)
    .then((granted) => {
      if (!granted) prepared = undefined;
      return granted;
    });
  return prepared;
}

/** Schedules the alert for `key`, replacing one already waiting. The system delivers it even if the app is closed. */
export async function scheduleAlert(key: AlertKey, at: number, title: string, body: string): Promise<void> {
  if (!supported || at <= Date.now() || !(await prepareAlerts())) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: 'dayframe-' + key,
      content: { title, body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
      },
    });
  } catch {
    // An alert is a convenience; the timer must never fail because of it.
  }
}

export async function cancelAlert(key: AlertKey): Promise<void> {
  if (!supported) return;
  await Notifications.cancelScheduledNotificationAsync('dayframe-' + key).catch(() => {});
}
