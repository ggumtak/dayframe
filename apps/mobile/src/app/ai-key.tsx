import * as Clipboard from 'expo-clipboard';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Icon, IconButton, Sheet, Txt } from '@/components/ui';
import { type CheckResult, checkConnection } from '@/features/ai/client';
import { AiScreen, ErrorDetail } from '@/features/ai/components';
import { AI_ERROR_TEXT } from '@/features/ai/errors';
import { deleteKey, saveKey, useAiKeyStatus } from '@/features/ai/keyStore';
import { AI_MODELS, cleanKey, looksLikeKey, PRICING } from '@/features/ai/models';
import { setAiPrefs, useAiPrefs } from '@/features/ai/prefs';
import { josa } from '@/lib/josa';
import { showToast } from '@/lib/toast';
import { fontFamily, radius, space, useTheme } from '@/theme';

const CONSOLE = 'console.anthropic.com';

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
      } else showToast('복사한 내용이 없습니다.');
    } catch {
      showToast('붙여넣기를 하지 못했습니다. 입력란을 길게 눌러 붙여 넣어 주세요.', { tone: 'error' });
    }
  };

  const save = async () => {
    const key = cleanKey(text);
    if (!looksLikeKey(key)) {
      setProblem('키가 아닌 것 같습니다. sk-ant-로 시작하는 키를 처음부터 끝까지 붙여 넣어 주세요.');
      return;
    }
    setSaving(true);
    try {
      await saveKey(key);
      setText('');
      showToast('키를 저장했습니다. 연결 확인으로 바로 시험해 볼 수 있습니다.');
      onDone();
    } catch {
      setProblem('키를 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <View style={[styles.field, { backgroundColor: colors.surfaceMuted, borderColor: problem ? colors.danger : 'transparent' }]}>
        <TextInput
          value={text} onChangeText={(value) => { setText(value); setProblem(null); }}
          placeholder="sk-ant-로 시작하는 키" placeholderTextColor={colors.textFaint} accessibilityLabel="Anthropic 키"
          secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" importantForAutofill="no"
          spellCheck={false} textContentType="password" returnKeyType="done" onSubmitEditing={() => void save()}
          style={[styles.input, { color: colors.text, fontFamily }]} />
        <Pressable accessibilityRole="button" accessibilityLabel="붙여넣기" onPress={() => void paste()} hitSlop={6} style={styles.paste}>
          <Icon name="clipboard" size={16} color={colors.accent} />
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
      <View style={[styles.check, { backgroundColor: colors.successSoft }]}>
        <Icon name="check-circle" size={18} color={colors.success} />
        <Txt variant="small" style={{ flex: 1 }}>연결되었습니다. {name}{josa(name, '으로/로')} 요청할 수 있습니다.</Txt>
      </View>
    );
  }
  const text = AI_ERROR_TEXT[result.kind];
  return (
    <View style={[styles.check, { backgroundColor: colors.dangerSoft }]}>
      <Icon name="alert-circle" size={18} color={colors.danger} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="smallStrong">{text.title}</Txt>
        {text.message ? <Txt variant="small" tone="muted">{text.message}</Txt> : null}
        <ErrorDetail detail={result.detail} align="left" />
      </View>
    </View>
  );
}

/** AI 비서 설정: the owner's Anthropic key, the model, and what is sent where. */
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
      showToast('키를 삭제했습니다.');
    } catch {
      showToast('키를 삭제하지 못했습니다. 다시 시도해 주세요.', { tone: 'error' });
    }
  };

  const copyConsole = async () => {
    try {
      await Clipboard.setStringAsync('https://' + CONSOLE);
      showToast('주소를 복사했습니다.');
    } catch {
      showToast('주소를 길게 눌러 직접 복사해 주세요.', { tone: 'error' });
    }
  };

  return (
    <AiScreen title="AI 비서 설정">
      <Section title="Anthropic 키">
        {!ready ? null : hasKey && !editing ? (
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={[styles.keyIcon, { backgroundColor: colors.accentSoft }]}><Icon name="key" size={18} color={colors.accent} /></View>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" accessibilityLabel="저장한 키">{masked}</Txt>
                <Txt variant="small" tone="muted">이 휴대폰에만 저장되어 있습니다.</Txt>
              </View>
            </View>
            {check ? <CheckLine result={check} /> : null}
            <Button
              label={checking ? '확인하는 중' : '연결 확인'} icon="zap" kind="secondary" loading={checking}
              onPress={() => void runCheck()} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="바꾸기" kind="secondary" onPress={() => { setCheck(null); setEditing(true); }} style={{ flex: 1 }} />
              <Button label="삭제" kind="danger" onPress={() => setConfirmDelete(true)} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <Card style={{ gap: space.sm }}>
            <Txt variant="small" tone="muted">
              {hasKey ? '새 키를 저장하면 지금 키는 지워집니다.' : 'AI 비서는 내 Anthropic 키로 동작합니다. 쓴 만큼만 Anthropic이 요금을 청구합니다.'}
            </Txt>
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
                <View style={[styles.radio, { borderColor: selected ? colors.accent : colors.textFaint }]}>
                  {selected ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{model.name}</Txt>
                  <Txt variant="small" tone="muted">{model.note}</Txt>
                </View>
                <Txt variant="caption" tone="faint" style={{ textAlign: 'right' }}>
                  {`입력 $${price.input} · 출력 $${price.output}\n100만 토큰당`}
                </Txt>
              </Pressable>
            );
          })}
        </Card>
      </Section>

      <Section title="알아 두기">
        <Card style={{ gap: space.md }}>
          <Bullet icon="send">
            요청할 때 할 일 제목·메모, 습관 이름, 집중 기록 요약이 Anthropic으로 전송됩니다. 다른 곳으로는 보내지 않습니다.
          </Bullet>
          <Bullet icon="lock">키는 이 휴대폰에만 암호화해 저장합니다. 서버나 백업에는 올라가지 않습니다.</Bullet>
          <Bullet icon="credit-card">
            요금은 쓴 만큼 Anthropic이 청구합니다. Anthropic 콘솔에서 월 사용 한도를 정해 두면 예상보다 많이 나갈 일이 없습니다.
          </Bullet>
        </Card>
      </Section>

      <Section title="키 받는 곳">
        <Card style={{ gap: space.sm }}>
          <Txt variant="small" tone="muted">Anthropic 콘솔에 로그인한 뒤 API Keys 메뉴에서 키를 만들고 복사합니다.</Txt>
          <View style={[styles.address, { backgroundColor: colors.surfaceMuted }]}>
            <Txt variant="bodyStrong" selectable style={{ flex: 1 }}>{CONSOLE} → API Keys</Txt>
            <IconButton name="copy" label="콘솔 주소 복사" size={18} color={colors.accent} onPress={() => void copyConsole()} />
          </View>
        </Card>
      </Section>

      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} title="키를 삭제할까요?">
        <Txt variant="small" tone="muted" style={{ marginBottom: space.lg }}>
          이 휴대폰에서 키를 지웁니다. 키 자체를 없애려면 Anthropic 콘솔에서도 삭제해 주세요.
        </Txt>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="취소" kind="secondary" onPress={() => setConfirmDelete(false)} style={{ flex: 1 }} />
          <Button label="삭제" kind="danger" onPress={() => void remove()} style={{ flex: 1 }} />
        </View>
      </Sheet>
    </AiScreen>
  );
}

function Bullet({ icon, children }: { icon: ComponentProps<typeof Icon>['name']; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 2 }}><Icon name={icon} size={16} color={colors.textMuted} /></View>
      <Txt variant="small" style={{ flex: 1 }}>{children}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, borderWidth: 1, paddingLeft: space.md, minHeight: 48 },
  input: { flex: 1, fontSize: 16, paddingVertical: space.sm },
  paste: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.md, minHeight: 44 },
  keyIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  check: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, alignItems: 'flex-start' },
  model: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  address: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingLeft: space.md },
});
