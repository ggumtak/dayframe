import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { env, isConfigured } from '@/lib/env';

import { fromGithubRelease, type InstalledApp, isTrustedApkUrl, readableNotes, type ReleaseInfo } from './version';

export function installedApp(): InstalledApp {
  const build = Number(Application.nativeBuildVersion);
  return {
    version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
    // The web build has no Android build number to compare against.
    build: Platform.OS === 'android' && Number.isInteger(build) && build > 0 ? build : null,
  };
}

async function fromBackend(): Promise<ReleaseInfo | null> {
  if (!isConfigured) return null;
  const release = await api.appVersion();
  return {
    version: release.latestVersion, versionCode: release.versionCode, minSupportedVersion: release.minSupportedVersion,
    notes: readableNotes(release.releaseNotes), apkUrl: isTrustedApkUrl(release.apkDownloadUrl, env.githubRepo) ? release.apkDownloadUrl : null,
    source: 'backend',
  };
}

async function fromGithub(): Promise<ReleaseInfo | null> {
  if (!env.githubRepo) return null;
  const response = await fetch('https://api.github.com/repos/' + env.githubRepo + '/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('GitHub releases responded with ' + response.status);
  return fromGithubRelease(await response.json(), env.githubRepo);
}

/**
 * The newest published release. The backend is asked first because it can also state the minimum
 * supported version; GitHub Releases answers when the backend has no release row or is unreachable.
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const release = await fromBackend();
    if (release) return release;
  } catch {
    // Fall through: an unpublished or unreachable backend must not hide a GitHub release.
  }
  return fromGithub();
}
