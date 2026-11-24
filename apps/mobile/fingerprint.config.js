// Inputs of the native fingerprint, which is the runtime version of over-the-air updates (scripts/updates/README.md).
// This is Expo's "balanced" preset plus two skips for files that never reach a prebuilt (CNG) APK, so editing
// them does not demand a new one: npm scripts, and .gitignore files. Read by both the Gradle build and
// `npx expo-updates fingerprint:generate`, so the two always agree.
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: [
    'ExpoConfigVersions',
    'ExpoConfigRuntimeVersionIfString',
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    'PackageJsonScriptsAll',
    'GitIgnore',
    'EasJson',
    'Easignore',
    'AutolinkingConfigPaths',
  ],
};
