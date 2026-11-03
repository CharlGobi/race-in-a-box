import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRace } from '@/app-state/race-context';

// Volunteer screen rules (PRD section 8): dark text on white, contrast of 7:1 or more,
// no shadows or gradients, targets 48 px or more and 56 px for primary actions.

export const C = {
  bg: '#FFFFFF',
  text: '#111111', // 18.9:1 on white
  muted: '#3D3D3D', // 10.9:1 on white
  line: '#111111',
  panel: '#F2F2F2',
  go: '#0A5C2B', // white on this is 7.9:1
  stop: '#8A1111', // white on this is 8.9:1
  warn: '#5C4300', // 9.6:1 on white
  warnBg: '#FFF4D6',
};

export function tap() {
  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const body = <View style={s.inner}>{children}</View>;
  return (
    <SafeAreaView style={s.safe} edges={['bottom', 'left', 'right']}>
      <SaveStatus />
      {scroll ? <ScrollView contentContainerStyle={s.scroll}>{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

/** Always visible. The app never hides a pending sync. */
export function SaveStatus() {
  const { events, waitingToSend, serverConnected, online, problem } = useRace();
  let label: string;
  let bad = false;
  if (!serverConnected) {
    label = events.length === 0 ? 'Rehearsal. Nothing recorded yet' : `Rehearsal. ${events.length} saved on phone, not sent`;
  } else if (problem) {
    label = waitingToSend > 0 ? `${waitingToSend} saved on phone, not sent. ${problem}` : problem;
    bad = true;
  } else if (waitingToSend > 0) {
    label = online ? `Saved on phone. Sending ${waitingToSend}` : `No signal. ${waitingToSend} saved on phone, will send`;
  } else if (events.length === 0) {
    label = online ? 'Connected. Nothing recorded yet' : 'No signal. Nothing recorded yet';
  } else {
    label = online ? `All ${events.length} saved on phone and sent` : 'No signal. Everything so far was sent';
  }
  return (
    <View style={[s.status, bad && s.statusBad]} accessibilityLiveRegion="polite">
      <Text style={[s.statusText, bad && { color: C.warn }]}>{label}</Text>
    </View>
  );
}

type BtnProps = {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'go' | 'stop' | 'plain';
  big?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  hint?: string;
};

export function Btn({ label, onPress, kind = 'primary', big, disabled, style, hint }: BtnProps) {
  const bg = kind === 'go' ? C.go : kind === 'stop' ? C.stop : kind === 'plain' ? C.bg : C.text;
  const fg = kind === 'plain' ? C.text : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      disabled={disabled}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, minHeight: big ? 96 : 56, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        kind === 'plain' && s.btnPlain,
        style,
      ]}>
      <Text style={[s.btnText, { color: fg, fontSize: big ? 28 : 20 }]}>{label}</Text>
    </Pressable>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={s.h1}>{children}</Text>;
}

export function P({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[s.p, muted && { color: C.muted }]}>{children}</Text>;
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <View style={s.notice}>
      <Text style={s.noticeText}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1 },
  inner: { flex: 1, padding: 16, gap: 14, width: '100%', maxWidth: 560, alignSelf: 'center' },
  status: { backgroundColor: C.panel, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 2, borderColor: C.line },
  statusBad: { backgroundColor: C.warnBg, borderColor: C.warn },
  statusText: { color: C.text, fontSize: 16, fontWeight: '700' },
  btn: { borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnPlain: { borderWidth: 2, borderColor: C.line },
  btnText: { fontWeight: '800', textAlign: 'center' },
  h1: { fontSize: 28, fontWeight: '800', color: C.text },
  p: { fontSize: 18, lineHeight: 26, color: C.text },
  notice: { backgroundColor: C.warnBg, borderWidth: 2, borderColor: C.warn, borderRadius: 8, padding: 12 },
  noticeText: { color: C.warn, fontSize: 17, fontWeight: '700' },
});
