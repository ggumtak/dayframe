import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

import ApkInstaller from '../../../modules/apk-installer';
import { isTrustedApkUrl, type ReleaseInfo, UpdateError } from './version';

export { UpdateError };

/** Whether this build can take a downloaded APK through to the system installer. */
export const canSelfUpdate = Platform.OS === 'android';

/** False only when Android will refuse the install until the user allows this app as a source. */
export function hasInstallPermission(): boolean {
  return !canSelfUpdate || !ApkInstaller || ApkInstaller.canInstallPackages();
}

export function openInstallPermissionSettings(): void {
  if (ApkInstaller) ApkInstaller.openInstallPermissionSettings();
  else void IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
    { data: 'package:' + Application.applicationId });
}

/** Downloads the release APK into the cache, reporting progress from 0 to 1 (or null when the size is unknown). */
export async function downloadApk(
  release: ReleaseInfo, onProgress: (fraction: number | null) => void, signal: AbortSignal,
): Promise<File> {
  if (!isTrustedApkUrl(release.apkUrl)) throw new UpdateError('untrusted', 'Release has no trusted APK link');
  const target = new File(Paths.cache, 'dayframe-update.apk');
  try {
    if (target.exists) target.delete();
    return await File.downloadFileAsync(release.apkUrl, target, {
      idempotent: true, signal,
      onProgress: ({ bytesWritten, totalBytes }) => onProgress(totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null),
    });
  } catch (error) {
    if (signal.aborted) throw new UpdateError('cancelled', 'Download cancelled');
    throw new UpdateError('download', error instanceof Error ? error.message : 'Download failed');
  }
}

/**
 * Checks that the file is this app, signed by the same key and actually newer, then opens Android's
 * installer. Android repeats the signature check itself; checking first gives a clear message instead
 * of the system's generic "App not installed".
 */
export async function installApk(file: File): Promise<void> {
  const info = ApkInstaller?.inspect(file.uri);
  if (ApkInstaller) {
    const installed = Number(Application.nativeBuildVersion);
    if (!info) throw new UpdateError('unreadable', 'Downloaded file is not a readable APK');
    if (info.packageName !== Application.applicationId) throw new UpdateError('wrong-app', 'APK belongs to ' + info.packageName);
    if (info.signerMatches === false) throw new UpdateError('wrong-signer', 'APK is signed with a different key');
    if (Number.isInteger(installed) && info.versionCode <= installed) throw new UpdateError('not-newer', 'APK is not newer');
    ApkInstaller.install(file.contentUri);
    return;
  }
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri, type: 'application/vnd.android.package-archive', flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}

/** iOS has no sideloading; send the user to TestFlight or the App Store when a link is published. */
export async function openStore(release: ReleaseInfo): Promise<boolean> {
  if (!release.iosUrl) return false;
  await Linking.openURL(release.iosUrl);
  return true;
}
