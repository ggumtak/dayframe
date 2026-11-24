import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

/**
 * Over-the-air updates: new JavaScript and assets from the project's Supabase (scripts/updates/README.md).
 * expo-updates itself checks on every cold start and downloads in the background; a downloaded update applies on
 * the next cold start, or at once through `restartIntoUpdate`. Off in development, on the web and in builds
 * without expo-updates, where only the APK path below remains.
 */
export const otaEnabled = Platform.OS === 'android' && !__DEV__ && Updates.isEnabled;

/** When the running update was published; null for the code that came inside the APK. */
export function runningUpdateDate(): Date | null {
  return otaEnabled && !Updates.isEmbeddedLaunch ? Updates.createdAt : null;
}

/** Asks the server for a newer update built for this APK's runtime. False also means "a new APK is needed". */
export async function isOtaAvailable(): Promise<boolean> {
  if (!otaEnabled) return false;
  const result = await Updates.checkForUpdateAsync();
  return result.isAvailable || result.isRollBackToEmbedded;
}

/** Downloads it. True when something new now waits for a restart. */
export async function downloadOta(): Promise<boolean> {
  const result = await Updates.fetchUpdateAsync();
  return result.isNew || result.isRollBackToEmbedded;
}

/** True when an update downloaded in the background (at launch) is waiting for a restart. */
export function useOtaPending(): boolean {
  const { isUpdatePending } = Updates.useUpdates();
  return otaEnabled && isUpdatePending;
}

export function restartIntoUpdate(): Promise<void> {
  return Updates.reloadAsync();
}
