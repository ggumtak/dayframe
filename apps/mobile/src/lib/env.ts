const trim = (value: string | undefined) => (value ?? '').trim().replace(/\/+$/, '');

export const env = {
  supabaseUrl: trim(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseKey: (process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '').trim(),
  githubRepo: (process.env.EXPO_PUBLIC_GITHUB_REPO ?? 'ggumtak/dayframe').trim(),
};

/** False until the build is given a Supabase project to talk to. */
export const isConfigured = Boolean(env.supabaseUrl && env.supabaseKey);
export const apiBase = env.supabaseUrl + '/functions/v1/api/v1';
