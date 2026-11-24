import type { ExpoConfig } from 'expo/config';

// The release workflow injects these from the git tag (v1.2.3 -> 1.2.3 / 10203).
const version = process.env.APP_VERSION ?? '1.0.0';
const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? 1);

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
  plugins: [
    'expo-router',
    ['expo-build-properties', {
      android: {
        // Native libraries are stored compressed in the APK (about a third of their size) and unpacked once at
        // install, which makes the download and the in-app update much smaller. They load the same way after.
        useLegacyPackaging: true,
        // The app shows no GIF or WebP through React Native's <Image> (widget previews and launcher icons are
        // Android drawables, decoded by the system), so Fresco's GIF and WebP decoders are left out.
        gifEnabled: false,
        webpEnabled: false,
      },
    }],
    ['expo-splash-screen', {
      backgroundColor: '#FFFFFF',
      image: './assets/images/splash-icon.png',
      imageWidth: 96,
      // No dark image: the logo is the same, and Android falls back to the light drawables at night
      // instead of shipping a second copy at every density.
      dark: { backgroundColor: '#15171A' },
    }],
    // The UI is Korean only, so the APK keeps only Korean translations of library strings (AndroidX, Material,
    // React Native) next to the default (English) ones: about 0.7 MB less resources.arsc than all 85 languages.
    ['expo-localization', { supportedLocales: { android: ['ko'] } }],
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
        name: 'Today', previewImage: './assets/widgets/today.webp', label: '오늘 할 일', description: '오늘 할 일과 지연된 할 일을 보고 바로 완료합니다.',
        minWidth: '180dp', minHeight: '110dp', targetCellWidth: 4, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        // The app redraws the widget whenever tasks change; this only catches the day rolling over.
        updatePeriodMillis: 1800000,
      }, {
        name: 'Upcoming', previewImage: './assets/widgets/upcoming.webp', label: '예정', description: '앞으로 7일의 할 일을 날짜별로 봅니다.',
        minWidth: '180dp', minHeight: '110dp', targetCellWidth: 4, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'Calendar', previewImage: './assets/widgets/calendar.webp', label: '달력', description: '일정이 있는 날을 이번 달 달력에 표시합니다. 날짜를 누르면 그날을 엽니다.',
        minWidth: '250dp', minHeight: '250dp', targetCellWidth: 4, targetCellHeight: 4, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'Habits', previewImage: './assets/widgets/habits.webp', label: '습관', description: '오늘의 습관을 보고 누르면 바로 기록합니다.',
        minWidth: '180dp', minHeight: '110dp', targetCellWidth: 4, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'Focus', previewImage: './assets/widgets/focus.webp', label: '집중', description: '25분·50분 뽀모도로를 홈 화면에서 시작합니다.',
        minWidth: '110dp', minHeight: '110dp', targetCellWidth: 2, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'QuickAdd', previewImage: './assets/widgets/quickadd.webp', label: '빠른 추가', description: '눌러서 바로 할 일을 추가합니다.',
        minWidth: '180dp', minHeight: '40dp', targetCellWidth: 4, targetCellHeight: 1, resizeMode: 'horizontal',
      }],
    }],
  ],
};

export default config;
