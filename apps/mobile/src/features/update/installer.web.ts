import { type ReleaseInfo, UpdateError } from './version';

/** The web build is for development only: it can show a release but never installs one. */
export { UpdateError };

export const canSelfUpdate = false;
export const hasInstallPermission = () => true;
export const openInstallPermissionSettings = () => {};
export const cleanUpDownloadedApk = () => {};
export async function downloadApk(_release: ReleaseInfo, _onProgress: (fraction: number | null) => void, _signal: AbortSignal): Promise<never> {
  throw new UpdateError('download', 'Updates install on Android only');
}
export async function installApk(_file: unknown): Promise<void> {}
