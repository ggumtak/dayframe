import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';

import release from './release.config.json';

// The release workflow injects these from the git tag (v1.2.3 -> 1.2.3 / 10203).
const version = process.env.APP_VERSION ?? '1.0.0';
const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? 1);

// Over-the-air updates, served by the project's own Supabase (scripts/updates/README.md). The runtime version is
// the native fingerprint, so any change that needs a new APK yields a new runtime and the server never offers it
// an update built for another. Committing certs/certificate.pem switches on code signing; until then updates are
// accepted unsigned, still only over HTTPS from the project's Supabase.
const updatesUrl = release.supabaseUrl.trim().replace(/\/+$/, '') + '/functions/v1/api/v1/updates/manifest';
const signingCertificate = 'certs/certificate.pem';
function codeSigning(): Pick<NonNullable<ExpoConfig['updates']>, 'codeSigningCertificate' | 'codeSigningMetadata'> {
  const file = join(__dirname, signingCertificate);
  if (!existsSync(file)) return {};
  const body = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END/.exec(readFileSync(file, 'utf8'))?.[1];
  if (!body) throw new Error(signingCertificate + ' is not a PEM certificate');
  // Derived from the certificate, so replacing it also changes the fingerprint; publish.mjs signs with this key id.
  const keyid = 'dayframe-' + createHash('sha256').update(Buffer.from(body.replace(/\s+/g, ''), 'base64')).digest('hex').slice(0, 12);
  return { codeSigningCertificate: './' + signingCertificate, codeSigningMetadata: { keyid, alg: 'rsa-v1_5-sha256' } };
}

const config: ExpoConfig = {
  name: 'Dayframe',
  slug: 'dayframe',
  version,
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'dayframe',
  userInterfaceStyle: 'automatic',
  // Android is the only shipped target; the web build exists for development.
  platforms: ['android', 'web'],
  android: {
    package: 'com.ggumtak.dayframe',
    versionCode,
    adaptiveIcon: {
      backgroundColor: '#3574F0',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // Lets the in-app updater hand a downloaded APK to the system installer.
    // The exact-alarm permissions let a focus timer's alert arrive on time while the phone sleeps.
    permissions: [
      'android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.USE_EXACT_ALARM', 'android.permission.SCHEDULE_EXACT_ALARM',
    ],
    // Updates download into the app's own cache, so shared storage and overlay access are never needed.
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    predictiveBackGestureEnabled: false,
  },
  web: { output: 'single', favicon: './assets/images/favicon.png' },
  runtimeVersion: { policy: 'fingerprint' },
  // Checks on every cold start without waiting; a downloaded update applies on the next cold start.
  updates: { url: updatesUrl, enabled: true, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0, ...codeSigning() },
  plugins: [
    'expo-router',
    ['expo-splash-screen', {
      backgroundColor: '#FFFFFF',
      image: './assets/images/splash-icon.png',
      imageWidth: 96,
      dark: { backgroundColor: '#15171A', image: './assets/images/splash-icon.png' },
    }],
    'expo-localization',
    ['expo-font', {
      android: {
        fonts: [{
          fontFamily: 'Pretendard',
          fontDefinitions: [
            { path: './assets/fonts/Pretendard-Regular.otf', weight: 400 },
            { path: './assets/fonts/Pretendard-Medium.otf', weight: 500 },
            { path: './assets/fonts/Pretendard-SemiBold.otf', weight: 600 },
            { path: './assets/fonts/Pretendard-Bold.otf', weight: 700 },
            { path: './assets/fonts/Pretendard-ExtraBold.otf', weight: 800 },
          ],
        }],
      },
    }],
    ['expo-notifications', { color: '#2B66E0' }],
    // Keeps the AI 비서 key (Android Keystore) out of Android Auto Backup, where it could not be decrypted anyway.
    'expo-secure-store',
    // previewImage is what the home screen's widget picker shows; redraw with scripts/widget-previews.mjs.
    ['react-native-android-widget', {
      widgets: [{
        name: 'Today', previewImage: './assets/widgets/today.png', label: '오늘 할 일', description: '오늘 할 일과 지연된 할 일을 보고 바로 완료합니다.',
        minWidth: '180dp', minHeight: '110dp', targetCellWidth: 4, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        // The app redraws the widget whenever tasks change; this only catches the day rolling over.
        updatePeriodMillis: 1800000,
      }, {
        name: 'Upcoming', previewImage: './assets/widgets/upcoming.png', label: '예정', description: '앞으로 7일의 할 일을 날짜별로 봅니다.',
        minWidth: '180dp', minHeight: '110dp', targetCellWidth: 4, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'Calendar', previewImage: './assets/widgets/calendar.png', label: '달력', description: '일정이 있는 날을 이번 달 달력에 표시합니다. 날짜를 누르면 그날을 엽니다.',
        minWidth: '250dp', minHeight: '250dp', targetCellWidth: 4, targetCellHeight: 4, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'Habits', previewImage: './assets/widgets/habits.png', label: '습관', description: '오늘의 습관을 보고 누르면 바로 기록합니다.',
        minWidth: '180dp', minHeight: '110dp', targetCellWidth: 4, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'Focus', previewImage: './assets/widgets/focus.png', label: '집중', description: '25분·50분 뽀모도로를 홈 화면에서 시작합니다.',
        minWidth: '110dp', minHeight: '110dp', targetCellWidth: 2, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'QuickAdd', previewImage: './assets/widgets/quickadd.png', label: '빠른 추가', description: '눌러서 바로 할 일을 추가합니다.',
        minWidth: '180dp', minHeight: '40dp', targetCellWidth: 4, targetCellHeight: 1, resizeMode: 'horizontal',
      }],
    }],
  ],
};

export default config;
