import { requireOptionalNativeModule } from 'expo';

export interface ApkInfo {
  packageName: string;
  versionCode: number;
  versionName: string | null;
  /** Whether the file is signed by the installed app's key; null when the platform could not tell. */
  signerMatches: boolean | null;
}

interface ApkInstaller {
  canInstallPackages(): boolean;
  openInstallPermissionSettings(): void;
  /** Reads a downloaded APK. Null when the file is not a readable package. */
  inspect(fileUri: string): ApkInfo | null;
  install(contentUri: string): void;
}

/** Android only. Null on iOS, on the web, and in builds made before the module was added. */
export default requireOptionalNativeModule<ApkInstaller>('DayframeApkInstaller');
