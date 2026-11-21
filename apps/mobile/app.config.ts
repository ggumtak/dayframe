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
  ],
};

export default config;
