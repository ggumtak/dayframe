/** Pure release-comparison logic for the in-app updater. No platform imports, so it runs under node:test. */

export interface ReleaseInfo {
  version: string;
  /** Android build number; null when the source does not state one. */
  versionCode: number | null;
  minSupportedVersion: string | null;
  notes: string;
  apkUrl: string | null;
  source: 'backend' | 'github';
}

export interface InstalledApp { version: string | null; build: number | null }

export function parseVersion(value: string | null | undefined): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec((value ?? '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when `a` is older than `b`. Unparseable versions sort as oldest. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const [left, right] = [parseVersion(a) ?? [-1, -1, -1], parseVersion(b) ?? [-1, -1, -1]];
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** The build number the release workflow derives from a tag: v1.2.3 -> 10203. */
export function versionCodeOf(version: string | null | undefined): number | null {
  const parts = parseVersion(version);
  return parts && parts[1] < 100 && parts[2] < 100 ? parts[0] * 10000 + parts[1] * 100 + parts[2] : null;
}

export function isNewer(release: Pick<ReleaseInfo, 'version' | 'versionCode'>, installed: InstalledApp): boolean {
  if (release.versionCode !== null && installed.build !== null) return release.versionCode > installed.build;
  return compareVersions(release.version, installed.version) > 0;
}

/** True when the installed build is older than the oldest one the server still supports. */
export function isRequired(release: Pick<ReleaseInfo, 'minSupportedVersion'>, installed: InstalledApp): boolean {
  return !!release.minSupportedVersion && !!parseVersion(installed.version)
    && compareVersions(installed.version, release.minSupportedVersion) < 0;
}

/** Only APK assets of the app's own GitHub repository (`owner/name`) are ever downloaded and offered for install. */
export function isTrustedApkUrl(url: string | null | undefined, repo: string): url is string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return false;
  const prefix = 'https://github.com/' + repo + '/releases/download/';
  return !!url && url.startsWith(prefix) && /^[\w.%-]+\/[\w.%-]+\.apk$/.test(url.slice(prefix.length));
}

interface GithubRelease {
  tag_name?: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

/** Maps GitHub's "latest release" payload. Null when it is not a usable published version. */
export function fromGithubRelease(payload: unknown, repo: string): ReleaseInfo | null {
  const release = (payload ?? {}) as GithubRelease;
  if (release.draft || release.prerelease || !parseVersion(release.tag_name)) return null;
  const version = parseVersion(release.tag_name)!.join('.');
  const apk = release.assets?.find((asset) => asset.name?.toLowerCase().endsWith('.apk') && isTrustedApkUrl(asset.browser_download_url, repo));
  return {
    version, versionCode: versionCodeOf(version), minSupportedVersion: null, notes: (release.body ?? '').trim(),
    apkUrl: apk?.browser_download_url ?? null, source: 'github',
  };
}

export type UpdateFailure = 'untrusted' | 'download' | 'wrong-app' | 'wrong-signer' | 'not-newer' | 'unreadable' | 'cancelled';

export class UpdateError extends Error {
  readonly reason: UpdateFailure;

  constructor(reason: UpdateFailure, message: string) {
    super(message);
    this.name = 'UpdateError';
    this.reason = reason;
  }
}
