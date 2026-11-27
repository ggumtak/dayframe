import * as Clipboard from 'expo-clipboard';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AiIcon } from '@/components/AiIcon';
import { Button, Card, Icon, IconButton, Sheet, Txt } from '@/components/ui';
import { type CheckResult, checkConnection } from '@/features/ai/client';
import { AiScreen, ErrorDetail } from '@/features/ai/components';
import { AI_ERROR_TEXT } from '@/features/ai/errors';
import { deleteKey, saveKey, useAiKeyStatus } from '@/features/ai/keyStore';
import { AI_MODELS, cleanKey, looksLikeKey, PRICING } from '@/features/ai/models';
import { setAiPrefs, useAiPrefs } from '@/features/ai/prefs';
import { showToast } from '@/lib/toast';
import { fontFamily, radius, space, useTheme } from '@/theme';

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm, marginTop: space.md }}>
      <Txt variant="section" accessibilityRole="header">{title}</Txt>
      {children}
    </View>
  );
}

function KeyEditor({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const paste = async () => {
    try {
      const value = cleanKey(await Clipboard.getStringAsync());
      if (value) {
        setText(value);
        setProblem(null);
      } else showToast('복사된 내용이 없습니다.');
    } catch {
      showToast('붙여넣기에 실패했습니다. 입력란을 길게 눌러 직접 붙여 넣어 주세요.', { tone: 'error' });
    }
  };

  const save = async () => {
    const key = cleanKey(text);
    if (!looksLikeKey(key)) {
      setProblem('sk-ant-로 시작하는 API 키를 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      await saveKey(key);
      setText('');
      showToast('API 키를 저장했습니다.');
      onDone();
    } catch {
      setProblem('API 키를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <View style={[styles.field, { backgroundColor: colors.surfaceMuted, borderColor: problem ? colors.danger : 'transparent' }]}>
        <TextInput
          value={text} onChangeText={(value) => { setText(value); setProblem(null); }}
          placeholder="sk-ant-로 시작하는 API 키" placeholderTextColor={colors.textFaint} accessibilityLabel="Anthropic 키"
          secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" importantForAutofill="no"
          spellCheck={false} textContentType="password" returnKeyType="done" onSubmitEditing={() => void save()}
          style={[styles.input, { color: colors.text, fontFamily }]} />
        <Pressable accessibilityRole="button" accessibilityLabel="붙여넣기" onPress={() => void paste()} hitSlop={6} style={styles.paste}>
          <Icon name="clipboard" size={16} color={colors.accentText} />
          <Txt variant="smallStrong" tone="accent">붙여넣기</Txt>
        </Pressable>
      </View>
      {problem ? <Txt variant="small" tone="danger">{problem}</Txt> : null}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {canCancel ? <Button label="취소" kind="secondary" onPress={onDone} style={{ flex: 1 }} /> : null}
        <Button label="저장" icon="check" onPress={() => void save()} loading={saving} disabled={!text.trim()} style={{ flex: 2 }} />
      </View>
    </View>
  );
}

function CheckLine({ result }: { result: CheckResult }) {
  const { colors } = useTheme();
  if (result.ok) {
    const name = AI_MODELS.find((model) => model.id === result.model)?.name ?? result.model;
    return (
      <View style={styles.check}>
        <Icon name="check-circle" size={18} color={colors.textMuted} />
        <Txt variant="small" style={{ flex: 1 }}>연결됨 · {name}</Txt>
      </View>
    );
  }
  const text = AI_ERROR_TEXT[result.kind];
  return (
    <View style={styles.check}>
      <Icon name="alert-circle" size={18} color={colors.danger} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="smallStrong">{text.title}</Txt>
        {text.message ? <Txt variant="small" tone="muted">{text.message}</Txt> : null}
        <ErrorDetail detail={result.detail} align="left" />
      </View>
    </View>
  );
}

/** AI 비서 설정: the owner's Anthropic key, the model, and concise privacy/billing facts. */
export default function AiKeySettings() {
  const { colors } = useTheme();
  const { ready, hasKey, masked } = useAiKeyStatus();
  const prefs = useAiPrefs();
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const runCheck = async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setChecking(true);
    setCheck(null);
    const result = await checkConnection(current.signal);
    if (controller.current !== current) return;
    controller.current = null;
    setChecking(false);
    if (!(!result.ok && result.kind === 'cancelled')) setCheck(result);
  };

  const remove = async () => {
    setConfirmDelete(false);
    controller.current?.abort();
    setChecking(false);
    setCheck(null);
    try {
      await deleteKey();
      showToast('API 키를 삭제했습니다.');
    } catch {
      showToast('API 키를 삭제하지 못했습니다.', { tone: 'error' });
    }
  };

  const copyConsole = async () => {
    try {
      await Clipboard.setStringAsync(CONSOLE_URL);
      showToast('콘솔 주소를 복사했습니다.');
    } catch {
      showToast('복사에 실패했습니다.', { tone: 'error' });
    }
  };

  const openConsole = async () => {
    try {
      await Linking.openURL(CONSOLE_URL);
    } catch {
      await copyConsole();
    }
  };

  return (
    <AiScreen title="AI 비서 설정">
      <Section title="Anthropic API 키">
        {!ready ? null : hasKey && !editing ? (
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={[styles.keyIcon, { backgroundColor: colors.surfaceMuted }]}><Icon name="key" size={18} color={colors.textMuted} /></View>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" accessibilityLabel="저장된 API 키">{masked}</Txt>
                <Txt variant="small" tone="muted">기기 암호화 저장</Txt>
              </View>
            </View>
            {check ? <CheckLine result={check} /> : null}
            <Button
              label={checking ? '연결 확인 중' : '연결 확인'} leading={<AiIcon size={16} color={colors.text} />} kind="secondary" loading={checking}
              onPress={() => void runCheck()} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="키 변경" kind="secondary" onPress={() => { setCheck(null); setEditing(true); }} style={{ flex: 1 }} />
              <Button label="삭제" kind="danger" onPress={() => setConfirmDelete(true)} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <Card style={{ gap: space.sm }}>
            {hasKey ? <Txt variant="small" tone="muted">새 키로 교체합니다.</Txt> : null}
            <KeyEditor canCancel={hasKey} onDone={() => setEditing(false)} />
          </Card>
        )}
      </Section>

      <Section title="모델">
        <Card style={{ paddingVertical: space.xs }}>
          {AI_MODELS.map((model, index) => {
            const selected = prefs.model === model.id;
            const price = PRICING[model.id];
            return (
              <Pressable
                key={model.id} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${model.name}, ${model.note}`}
                onPress={() => { setAiPrefs({ model: model.id }); setCheck(null); }}
                style={({ pressed }) => [styles.model, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  pressed && { opacity: 0.6 }]}>
                <View style={[styles.radio, { borderColor: selected ? colors.accent : colors.control }]}>
                  {selected ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{model.name}</Txt>
                  <Txt variant="small" tone="muted">{model.note}</Txt>
                </View>
                <Txt variant="caption" tone="faint" style={{ textAlign: 'right' }}>
                  {`$${price.input} / $${price.output}`}
                </Txt>
              </Pressable>
            );
          })}
        </Card>
      </Section>

      <Card style={{ paddingVertical: space.xs, marginTop: space.sm }}>
        <View style={styles.infoRow}>
          <Icon name="lock" size={16} color={colors.textMuted} />
          <Txt variant="small" style={{ flex: 1 }}>기기 암호화 저장</Txt>
        </View>
        <View style={[styles.infoRow, styles.infoDivider, { borderTopColor: colors.border }]}>
          <Icon name="credit-card" size={16} color={colors.textMuted} />
          <Txt variant="small" style={{ flex: 1 }}>사용량만큼 과금</Txt>
        </View>
        <View style={[styles.infoRow, styles.infoDivider, { borderTopColor: colors.border }]}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Anthropic 콘솔 열기"
            onPress={() => void openConsole()}
            style={({ pressed }) => [styles.consoleLink, pressed && { opacity: 0.65 }]}>
            <Icon name="external-link" size={16} color={colors.accentText} />
            <Txt variant="smallStrong" tone="accent" style={{ flex: 1 }}>Anthropic 콘솔 열기</Txt>
          </Pressable>
          <IconButton name="copy" label="콘솔 주소 복사" size={16} color={colors.textMuted} onPress={() => void copyConsole()} />
        </View>
      </Card>

      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} title="API 키를 삭제할까요?">
        <Txt variant="small" tone="muted" style={{ marginBottom: space.lg }}>
          기기에 저장된 키만 삭제됩니다. 키 폐기는 Anthropic 콘솔에서 진행하세요.
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="취소" kind="secondary" onPress={() => setConfirmDelete(false)} style={{ flex: 1 }} />
          <Button label="삭제" kind="danger" onPress={() => void remove()} style={{ flex: 1 }} />
        </View>
      </Sheet>
    </AiScreen>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, borderWidth: 1, paddingLeft: space.md, minHeight: 48 },
  input: { flex: 1, fontSize: 16, paddingVertical: space.sm },
  paste: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.md, minHeight: 44 },
  keyIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  check: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  model: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, paddingVertical: space.xs },
  infoDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  consoleLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 36 },
});
