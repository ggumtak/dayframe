import release from '../../release.config.json';

const trim = (value: string | undefined) => (value ?? '').trim().replace(/\/+$/, '');

// release.config.json holds the public values that are baked into released builds.
// EXPO_PUBLIC_* variables (for example from .env.local) override them during development.
export const env = {
  supabaseUrl: trim(process.env.EXPO_PUBLIC_SUPABASE_URL || release.supabaseUrl),
  supabaseKey: (process.env.EXPO_PUBLIC_SUPABASE_KEY || release.supabaseKey).trim(),
  /** owner/repo whose GitHub Releases carry the APK. Updates are only ever downloaded from here. */
  githubRepo: (process.env.EXPO_PUBLIC_GITHUB_REPO ?? 'ggumtak/dayframe').trim(),
};

/** False until the build is given a Supabase project to talk to. */
export const isConfigured = Boolean(env.supabaseUrl && env.supabaseKey);
export const apiBase = env.supabaseUrl + '/functions/v1/api/v1';
