import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APK_CACHE_MAX_AGE_MS, compareVersions, fromGithubRelease, isNewer, isRequired, isStaleApk, isTrustedApkUrl, parseVersion,
  readableNotes, updateDateLabel, versionCodeOf,
} from './version.ts';

test('versions parse and compare numerically', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.10.0-beta.1'), [1, 10, 0]);
  assert.equal(parseVersion('nightly'), null);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.equal(compareVersions('v2.0.0', '2.0.0'), 0);
  assert.ok(compareVersions(null, '0.0.1') < 0);
});

test('the build number matches the release workflow', () => {
  assert.equal(versionCodeOf('1.2.3'), 10203);
  assert.equal(versionCodeOf('v12.0.45'), 120045);
  assert.equal(versionCodeOf('1.100.0'), null);
  assert.equal(versionCodeOf('latest'), null);
});

test('an update is offered only for a strictly newer release', () => {
  const release = { version: '1.2.0', versionCode: 10200 };
  assert.equal(isNewer(release, { version: '1.1.9', build: 10109 }), true);
  assert.equal(isNewer(release, { version: '1.2.0', build: 10200 }), false);
  assert.equal(isNewer(release, { version: '1.3.0', build: 10300 }), false);
  // Without a build number on either side, fall back to the version string.
  assert.equal(isNewer({ version: '1.2.0', versionCode: null }, { version: '1.1.0', build: 99999 }), true);
  assert.equal(isNewer(release, { version: '1.2.0', build: null }), false);
  assert.equal(isNewer(release, { version: null, build: null }), true);
});

test('a release below the minimum supported version is required', () => {
  assert.equal(isRequired({ minSupportedVersion: '1.1.0' }, { version: '1.0.5', build: 10005 }), true);
  assert.equal(isRequired({ minSupportedVersion: '1.1.0' }, { version: '1.1.0', build: 10100 }), false);
  assert.equal(isRequired({ minSupportedVersion: null }, { version: '0.0.1', build: 1 }), false);
  assert.equal(isRequired({ minSupportedVersion: '1.1.0' }, { version: null, build: null }), false);
});

const repo = 'ggumtak/dayframe';

test('only APK assets of the app\'s own repository are trusted for download', () => {
  assert.equal(isTrustedApkUrl('https://github.com/ggumtak/dayframe/releases/download/v1.2.0/dayframe.apk', repo), true);
  assert.equal(isTrustedApkUrl('http://github.com/ggumtak/dayframe/releases/download/v1.2.0/dayframe.apk', repo), false);
  assert.equal(isTrustedApkUrl('https://github.com/someone/else/releases/download/v1.2.0/dayframe.apk', repo), false);
  assert.equal(isTrustedApkUrl('https://github.com/ggumtak/dayframe-evil/releases/download/v1/x.apk', repo), false);
  assert.equal(isTrustedApkUrl('https://github.com.evil.example/ggumtak/dayframe/releases/download/v1/x.apk', repo), false);
  assert.equal(isTrustedApkUrl('https://github.com/ggumtak/dayframe/releases/download/v1/x.apk?next=https://evil.example', repo), false);
  assert.equal(isTrustedApkUrl('https://github.com/ggumtak/dayframe/releases/download/v1/../../x.apk', repo), false);
  assert.equal(isTrustedApkUrl('https://example.com/dayframe.apk', repo), false);
  assert.equal(isTrustedApkUrl(null, repo), false);
  assert.equal(isTrustedApkUrl('https://github.com/ggumtak/dayframe/releases/download/v1/x.apk', ''), false);
});

test('GitHub latest-release payloads map to release info', () => {
  const release = fromGithubRelease({
    tag_name: 'v1.4.2', body: ' Faster sync\n', assets: [
      { name: 'dayframe.apk.sha256', browser_download_url: 'https://github.com/ggumtak/dayframe/releases/download/v1.4.2/dayframe.apk.sha256' },
      { name: 'dayframe.apk', browser_download_url: 'https://github.com/ggumtak/dayframe/releases/download/v1.4.2/dayframe.apk' },
    ],
  }, repo);
  assert.deepEqual(release, {
    version: '1.4.2', versionCode: 10402, minSupportedVersion: null, notes: 'Faster sync', source: 'github',
    apkUrl: 'https://github.com/ggumtak/dayframe/releases/download/v1.4.2/dayframe.apk',
  });
  assert.equal(fromGithubRelease({ tag_name: 'v1.5.0', assets: [{ name: 'x.apk', browser_download_url: 'https://github.com/other/repo/releases/download/v1.5.0/x.apk' }] }, repo)?.apkUrl, null);
  assert.equal(fromGithubRelease({ tag_name: 'v1.5.0', assets: [] }, repo)?.apkUrl, null);
  assert.equal(fromGithubRelease({ tag_name: 'v1.5.0', prerelease: true }, repo), null);
  assert.equal(fromGithubRelease({ tag_name: 'weekly' }, repo), null);
  assert.equal(fromGithubRelease(null, repo), null);
});

test('release notes lose GitHub scaffolding and keep what was written', () => {
  const generated = "## What's Changed\n* Sign in automatically by @someone in https://github.com/o/r/pull/4\n\n\n**Full Changelog**: https://github.com/o/r/compare/v1.0.0...v1.0.1";
  assert.equal(readableNotes(generated), '• Sign in automatically');
  assert.equal(readableNotes('- 시간 인식 개선\n- **뽀모도로** 추가\n'), '• 시간 인식 개선\n• 뽀모도로 추가');
  assert.equal(readableNotes(''), '');
});

test('the running over-the-air update is labelled with its local date', () => {
  const now = new Date(2026, 10, 24, 9, 0);
  assert.equal(updateDateLabel(new Date(2026, 10, 24, 3, 0), now), '11월 24일 업데이트');
  assert.equal(updateDateLabel(new Date(2025, 11, 31, 23, 0), now), '2025년 12월 31일 업데이트');
  assert.equal(updateDateLabel(null, now), null);
  assert.equal(updateDateLabel(new Date(Number.NaN), now), null);
});

test('a cached APK is deleted once installed, unreadable or abandoned, and kept while it may be installing', () => {
  const now = Date.UTC(2026, 10, 24);
  const fresh = now - 60_000;
  // Installed (same build) or older than the installed build.
  assert.equal(isStaleApk({ versionCode: 10900, modifiedAt: fresh }, 10900, now), true);
  assert.equal(isStaleApk({ versionCode: 10800, modifiedAt: fresh }, 10900, now), true);
  // Not a readable package.
  assert.equal(isStaleApk({ versionCode: null, modifiedAt: fresh }, 10900, now), true);
  // Newer and recent: the system installer may still be reading it.
  assert.equal(isStaleApk({ versionCode: 11000, modifiedAt: fresh }, 10900, now), false);
  // Newer but left for over a day: "update now" downloads afresh anyway.
  assert.equal(isStaleApk({ versionCode: 11000, modifiedAt: now - APK_CACHE_MAX_AGE_MS - 1 }, 10900, now), true);
  // A build that cannot inspect APKs decides by age alone.
  assert.equal(isStaleApk({ versionCode: undefined, modifiedAt: fresh }, 10900, now), false);
  assert.equal(isStaleApk({ versionCode: undefined, modifiedAt: now - APK_CACHE_MAX_AGE_MS - 1 }, 10900, now), true);
  assert.equal(isStaleApk({ versionCode: 11000, modifiedAt: undefined }, null, now), false);
});
