import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, Icon, Screen, Txt } from '@/components/ui';
import { auth, authMessage } from '@/lib/auth';
import { radius, space, type, useTheme } from '@/theme';

export default function SignIn() {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ready = /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 6;

  // Set after a sign-up that still needs its email confirmed.
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  const credentials = useRef({ email: '', password: '' });

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      credentials.current = { email: email.trim(), password };
      const { data, error: failure } = mode === 'sign-in'
        ? await auth.signInWithPassword(credentials.current) : await auth.signUp(credentials.current);
      if (failure) setError(authMessage(failure));
      else if (!data.session) {
        // The project requires email confirmation before the first sign-in.
        setNotice('확인 메일을 보냈습니다. 메일의 링크를 누르고 이 앱으로 돌아오면 자동으로 로그인됩니다. 링크를 누른 뒤 빈 페이지나 오류 페이지가 보여도 인증은 완료된 것입니다.');
        setMode('sign-in');
        setAwaitingEmail(true);
      }
    } catch (failure) {
      setError(authMessage(failure as Error));
    } finally {
      setBusy(false);
    }
  };

  // Coming back from the mail app after tapping the link signs in without retyping anything.
  useEffect(() => {
    if (!awaitingEmail) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      auth.signInWithPassword(credentials.current).then(({ data }) => {
        if (data.session) setAwaitingEmail(false);
      }).catch(() => {});
    });
    return () => subscription.remove();
  }, [awaitingEmail]);

  const field = [styles.field, type.body, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }];
  return (
    <Screen>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.logo, { backgroundColor: colors.accent }]}>
            <Icon name="check-square" size={30} color={colors.onAccent} />
          </View>
          <Txt variant="title" style={{ textAlign: 'center' }}>Dayframe</Txt>
          <Txt tone="muted" style={{ textAlign: 'center', marginBottom: space.xl }}>할 일, 습관, 집중을 하루 한 장에.</Txt>

          <TextInput
            value={email} onChangeText={setEmail} placeholder="이메일" placeholderTextColor={colors.textFaint}
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress"
            autoComplete="email" returnKeyType="next" accessibilityLabel="이메일" style={field} />
          <TextInput
            value={password} onChangeText={setPassword} placeholder="비밀번호 (6자 이상)" placeholderTextColor={colors.textFaint}
            secureTextEntry textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} returnKeyType="go" onSubmitEditing={submit}
            accessibilityLabel="비밀번호" style={field} />

          {error ? <Txt variant="small" tone="danger" accessibilityLiveRegion="polite">{error}</Txt> : null}
          {notice ? <Txt variant="small" tone="success" accessibilityLiveRegion="polite">{notice}</Txt> : null}

          <Button label={mode === 'sign-in' ? '로그인' : '계정 만들기'} onPress={submit} loading={busy} disabled={!ready} />
          <Button
            kind="ghost" label={mode === 'sign-in' ? '처음이신가요? 계정 만들기' : '이미 계정이 있나요? 로그인'}
            onPress={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setError(null);
            }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.md, maxWidth: 440, width: '100%', alignSelf: 'center' },
  logo: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: space.sm },
  field: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.lg },
});
