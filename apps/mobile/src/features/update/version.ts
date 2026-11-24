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

/** Release notes as plain sentences: GitHub's generated headings, author credits and compare links are dropped. */
export function readableNotes(body: string): string {
  return body.split(/\r?\n/)
    .filter((line) => !/^\s*(#+\s*What's Changed|\*\*Full Changelog\*\*|#+\s*New Contributors)/i.test(line) && !/^https?:\/\/\S+$/.test(line.trim()))
    .map((line) => line.replace(/\s+by @\S+ in https?:\/\/\S+/i, '').replace(/^\s*[*-]\s+/, '• ').replace(/^#+\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').trimEnd())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Maps GitHub's "latest release" payload. Null when it is not a usable published version. */
export function fromGithubRelease(payload: unknown, repo: string): ReleaseInfo | null {
  const release = (payload ?? {}) as GithubRelease;
  if (release.draft || release.prerelease || !parseVersion(release.tag_name)) return null;
  const version = parseVersion(release.tag_name)!.join('.');
  const apk = release.assets?.find((asset) => asset.name?.toLowerCase().endsWith('.apk') && isTrustedApkUrl(asset.browser_download_url, repo));
  return {
    version, versionCode: versionCodeOf(version), minSupportedVersion: null, notes: readableNotes(release.body ?? ''),
    apkUrl: apk?.browser_download_url ?? null, source: 'github',
  };
}

/** "11월 24일 업데이트" for the over-the-air update that is running; the year is added once it is not this year's. */
export function updateDateLabel(createdAt: Date | null | undefined, now: Date): string | null {
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null;
  const day = `${createdAt.getMonth() + 1}월 ${createdAt.getDate()}일`;
  return (createdAt.getFullYear() === now.getFullYear() ? day : `${createdAt.getFullYear()}년 ${day}`) + ' 업데이트';
}

/** A downloaded APK left in the cache this long is abandoned: "update now" always downloads afresh. */
export const APK_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the APK an earlier update left in the cache can go. It stays only while it may still be on its way
 * through Android's installer: readable, newer than this build and recent. `versionCode` is null when the file
 * is not a readable package and undefined when this build cannot inspect APKs.
 */
export function isStaleApk(
  cached: { versionCode: number | null | undefined; modifiedAt: number | null | undefined },
  installedBuild: number | null, now: number,
): boolean {
  if (cached.versionCode === null) return true;
  if (cached.versionCode !== undefined && installedBuild !== null && cached.versionCode <= installedBuild) return true;
  return typeof cached.modifiedAt === 'number' && now - cached.modifiedAt > APK_CACHE_MAX_AGE_MS;
}

export type UpdateFailure = 'untrusted' | 'download' | 'wrong-app' | 'wrong-signer' | 'not-newer' | 'unreadable' | 'cancelled' | 'restart';

export class UpdateError extends Error {
  readonly reason: UpdateFailure;

  constructor(reason: UpdateFailure, message: string) {
    super(message);
    this.name = 'UpdateError';
    this.reason = reason;
  }
}
