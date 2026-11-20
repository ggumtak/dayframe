const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

// The app reuses the backend's quick-entry parser and the shared wire types from the repo root.
config.watchFolders = [path.join(repoRoot, 'packages/shared'), path.join(repoRoot, 'supabase/functions/api')];

// Those files live outside this package, so pin their one runtime dependency to this app's copy.
const pinned = new Set(['@js-temporal/polyfill']);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (pinned.has(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(__dirname, 'package.json') }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
