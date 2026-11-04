import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useRace } from '@/app-state/race-context';
import { Btn, C, H1, P, Screen } from '@/ui/kit';

export default function Home() {
  const { race, role, setRole, results, mode } = useRace();
  const finished = results.rows.filter((r) => r.status === 'finished').length;
  const started = new Set(results.rows.filter((r) => r.startAt !== undefined).map((r) => r.heatId)).size;

  return (
    <Screen>
      <View style={s.head}>
        <H1>{race.name}</H1>
        <P muted>
          {race.venue ? `${race.venue}. ` : ''}
          {race.entries.length} entries, {race.heats.length} heats.
        </P>
      </View>

      <View style={s.counts}>
        <Count n={started} of={race.heats.length} label="heats started" />
        <Count n={finished} of={race.entries.length} label="teams finished" />
      </View>

      <Btn label="Finish line" big onPress={() => router.push('/finish')} />
      {role === 'head_judge' ? <Btn label="Head judge" kind="go" onPress={() => router.push('/judge')} /> : null}
      <Btn label="Start a heat" onPress={() => router.push('/start')} />
      <Btn label="Live results" onPress={() => router.push('/results')} />
      <Btn label="Phone check" kind="plain" onPress={() => router.push('/check')} />
      <Btn label="Organiser" kind="plain" onPress={() => router.push('/admin')} />

      {mode.kind === 'live' ? (
        <View style={s.role}>
          <Text style={s.roleLabel}>
            You are the {mode.link.role === 'head_judge' ? 'head judge' : 'timekeeper'}
            {mode.link.label ? `: ${mode.link.label}` : ''}
          </Text>
        </View>
      ) : (
        <View style={s.role}>
          <Text style={s.roleLabel}>You are the</Text>
          <View style={s.roleRow}>
            <Btn
              label="Timekeeper"
              kind={role === 'judge' ? 'primary' : 'plain'}
              style={s.roleBtn}
              onPress={() => setRole('judge')}
            />
            <Btn
              label="Head judge"
              kind={role === 'head_judge' ? 'primary' : 'plain'}
              style={s.roleBtn}
              onPress={() => setRole('head_judge')}
            />
          </View>
          <P muted>Rehearsal with made up teams. On race day you open the link the organiser sends you.</P>
        </View>
      )}
    </Screen>
  );
}

function Count({ n, of, label }: { n: number; of: number; label: string }) {
  return (
    <View style={s.count}>
      <Text style={s.countN}>
        {n}
        <Text style={s.countOf}> of {of}</Text>
      </Text>
      <Text style={s.countLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  head: { gap: 4 },
  counts: { flexDirection: 'row', gap: 12 },
  count: { flex: 1, borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12 },
  countN: { fontSize: 32, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  countOf: { fontSize: 18, fontWeight: '700', color: C.muted },
  countLabel: { fontSize: 16, color: C.text },
  role: { gap: 8, marginTop: 8 },
  roleLabel: { fontSize: 18, fontWeight: '700', color: C.text },
  roleRow: { flexDirection: 'row', gap: 12 },
  roleBtn: { flex: 1 },
});
