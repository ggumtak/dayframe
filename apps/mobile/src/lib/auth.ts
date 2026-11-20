import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthClient } from '@supabase/auth-js';
import { AppState } from 'react-native';

import { env } from './env';

/** Supabase Auth without the rest of the SDK: the app talks to its own REST API for data. */
export const auth = new AuthClient({
  url: (env.supabaseUrl || 'http://localhost') + '/auth/v1',
  headers: { apikey: env.supabaseKey, Authorization: 'Bearer ' + env.supabaseKey },
  storageKey: 'dayframe-auth',
  storage: AsyncStorage,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: false,
});

// Token refresh timers only make sense while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') void auth.startAutoRefresh();
  else void auth.stopAutoRefresh();
});

/** A valid access token, refreshed first when it is close to expiry. */
export async function accessToken(): Promise<string | null> {
  const { data } = await auth.getSession();
  return data.session?.access_token ?? null;
}

/** Korean copy for the Supabase Auth failures a user can act on. */
export function authMessage(error: { message?: string; code?: string; status?: number }): string {
  const code = error.code ?? '';
  const text = (error.message ?? '').toLowerCase();
  if (code === 'invalid_credentials' || text.includes('invalid login')) return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (code === 'email_not_confirmed' || text.includes('not confirmed')) return '이메일 인증이 필요합니다. 받은 메일의 링크를 눌러 주세요.';
  if (code === 'user_already_exists' || text.includes('already registered')) return '이미 가입된 이메일입니다. 로그인해 주세요.';
  if (code === 'weak_password' || text.includes('password should')) return '비밀번호는 6자 이상이어야 합니다.';
  if (code === 'over_email_send_rate_limit' || error.status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (code === 'validation_failed' || text.includes('invalid format')) return '이메일 형식을 확인해 주세요.';
  if (text.includes('network') || text.includes('fetch')) return '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.';
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
