import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useRace } from '@/app-state/race-context';
import { formatElapsed } from '@/core/results';
import { Btn, C, Notice, Screen, tap } from '@/ui/kit';

// Stamp the time on tap, then type the number. Stamps are kept on the phone,
// so a phone call or a crash in between loses nothing.

const STAMPS_KEY = 'rib:finishStamps';

export default function FinishLine() {
  const { race, events, record, results } = useRace();
  const [stamps, setStamps] = useState<number[]>([]);
  const [num, setNum] = useState('');
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STAMPS_KEY).then((raw) => raw && setStamps(JSON.parse(raw)));
  }, []);

  const saveStamps = (next: number[]) => {
    setStamps(next);
    AsyncStorage.setItem(STAMPS_KEY, JSON.stringify(next));
  };

  const entryByCode = new Map(race.entries.map((e) => [e.code, e]));
  const rowById = new Map(results.rows.map((r) => [r.entry.id, r]));
  const oldest = stamps[0];

  const onCross = () => {
    saveStamps([...stamps, Date.now()]);
    setMsg(null);
  };

  const onSave = async () => {
    if (oldest === undefined) return;
    const entry = entryByCode.get(num);
    if (!entry) {
      setMsg({ text: `There is no team ${num} in this race. Check the number.`, bad: true });
      return;
    }
    const row = rowById.get(entry.id)!;
    if (row.startAt === undefined) {
      setMsg({ text: `Team ${num}'s heat has not started. Ask the head judge.`, bad: true });
      return;
    }
    await record({ kind: 'finish' }, entry.id, oldest);
    saveStamps(stamps.slice(1));
    setNum('');
    const again = row.status === 'finished' ? ' This team already had a time, the head judge will check.' : '';
    setMsg({ text: `Team ${num} finished in ${formatElapsed(oldest - row.startAt)}.${again}` });
  };

  const undone = new Set(events.flatMap((e) => (e.payload.kind === 'undo' ? [e.payload.targetId] : [])));
  const recent = events
    .filter((e) => e.payload.kind === 'finish' && !undone.has(e.id))
    .slice(-4)
    .reverse();

  const press = (k: string) => {
    tap();
    if (k === 'del') setNum((n) => n.slice(0, -1));
    else setNum((n) => (n.length < 4 ? n + k : n));
  };

  return (
    <Screen>
      <Btn label="Tap as they cross" kind="go" big onPress={onCross} style={{ minHeight: 120 }} />

      {oldest !== undefined ? (
        <View style={s.panel}>
          <Text style={s.panelTitle}>
            Time saved {new Date(oldest).toLocaleTimeString('en-ZA')}
            {stamps.length > 1 ? `. ${stamps.length - 1} more waiting` : ''}
          </Text>
          <Text style={s.panelSub}>Type the team number</Text>
          <Text style={s.display} accessibilityLabel={`Team number ${num || 'empty'}`}>
            {num || ' '}
          </Text>
          <View style={s.pad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0'].map((k) => (
              <Pressable
                key={k}
                accessibilityRole="button"
                accessibilityLabel={k === 'del' ? 'Delete' : k}
                onPress={() => press(k)}
                style={({ pressed }) => [s.key, pressed && { backgroundColor: C.panel }]}>
                <Text style={[s.keyText, k === 'del' && s.keyDel]}>{k === 'del' ? 'Delete' : k}</Text>
              </Pressable>
            ))}
            <View style={s.keySpacer} />
          </View>
          <Btn label={num ? `Save team ${num}` : 'Save'} disabled={!num} onPress={onSave} />
          <Btn label="Wrong tap, remove this time" kind="plain" onPress={() => saveStamps(stamps.slice(1))} />
        </View>
      ) : (
        <Text style={s.idle}>Tap the green button the moment a team crosses the line. Then type their number.</Text>
      )}

      {msg ? msg.bad ? <Notice>{msg.text}</Notice> : <Text style={s.ok}>{msg.text}</Text> : null}

      {recent.length ? (
        <View style={{ gap: 6 }}>
          <Text style={s.panelSub}>Last saved</Text>
          {recent.map((e) => {
            const row = rowById.get(e.entryId!);
            return (
              <View key={e.id} style={s.recent}>
                <Text style={s.recentText}>
                  Team {row?.entry.code} {row?.startAt !== undefined ? formatElapsed(e.deviceTs - row.startAt) : ''}
                </Text>
                <Btn label="Undo" kind="plain" style={{ minWidth: 96 }} onPress={() => record({ kind: 'undo', targetId: e.id }, e.entryId)} />
              </View>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  panel: { gap: 10, borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12 },
  panelTitle: { fontSize: 18, fontWeight: '800', color: C.text },
  panelSub: { fontSize: 17, fontWeight: '700', color: C.muted },
  display: {
    fontSize: 48,
    fontWeight: '800',
    color: C.text,
    textAlign: 'center',
    borderWidth: 2,
    borderColor: C.line,
    borderRadius: 8,
    paddingVertical: 4,
    fontVariant: ['tabular-nums'],
  },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  key: {
    flexBasis: '31%',
    flexGrow: 1,
    minHeight: 64,
    borderWidth: 2,
    borderColor: C.line,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keySpacer: { flexBasis: '31%', flexGrow: 1 },
  keyText: { fontSize: 28, fontWeight: '800', color: C.text },
  keyDel: { fontSize: 20 },
  idle: { fontSize: 18, lineHeight: 26, color: C.text },
  ok: { fontSize: 20, fontWeight: '800', color: C.go },
  recent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.line, paddingVertical: 4 },
  recentText: { fontSize: 20, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },
});
