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
    ['expo-splash-screen', {
      backgroundColor: '#FFFFFF',
      image: './assets/images/splash-icon.png',
      imageWidth: 96,
      dark: { backgroundColor: '#15171A', image: './assets/images/splash-icon.png' },
    }],
    'expo-localization',
    ['expo-notifications', { color: '#3574F0' }],
    ['react-native-android-widget', {
      widgets: [{
        name: 'Today', label: '오늘 할 일', description: '오늘과 지연된 할 일을 보고 바로 완료합니다.',
        minWidth: '180dp', minHeight: '110dp', targetCellWidth: 4, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        // The app redraws the widget whenever tasks change; this only catches the day rolling over.
        updatePeriodMillis: 1800000,
      }, {
        name: 'Upcoming', label: '예정', description: '앞으로 7일의 할 일을 날짜별로 봅니다.',
        minWidth: '180dp', minHeight: '110dp', targetCellWidth: 4, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'Calendar', label: '달력', description: '이번 달 달력에 일정이 있는 날을 표시하고, 누르면 그 날을 엽니다.',
        minWidth: '250dp', minHeight: '250dp', targetCellWidth: 4, targetCellHeight: 4, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'Habits', label: '습관', description: '오늘의 습관을 보고 누르면 바로 기록합니다.',
        minWidth: '180dp', minHeight: '110dp', targetCellWidth: 4, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'Focus', label: '집중', description: '25분·50분 뽀모도로를 홈 화면에서 시작합니다.',
        minWidth: '110dp', minHeight: '110dp', targetCellWidth: 2, targetCellHeight: 2, resizeMode: 'horizontal|vertical',
        updatePeriodMillis: 1800000,
      }, {
        name: 'QuickAdd', label: '빠른 추가', description: '눌러서 바로 할 일을 추가합니다.',
        minWidth: '180dp', minHeight: '40dp', targetCellWidth: 4, targetCellHeight: 1, resizeMode: 'horizontal',
      }],
    }],
  ],
};

export default config;
