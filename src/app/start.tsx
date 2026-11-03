import { StyleSheet, Text, View } from 'react-native';

import { useRace } from '@/app-state/race-context';
import { Btn, C, P, Screen } from '@/ui/kit';

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function StartHeat() {
  const { race, events, record, results } = useRace();
  const divLabel = new Map(race.template.divisions.map((d) => [d.id, d.code]));
  const entryById = new Map(race.entries.map((e) => [e.id, e]));

  // A start is live unless it was undone.
  const undone = new Set(events.flatMap((e) => (e.payload.kind === 'undo' ? [e.payload.targetId] : [])));
  const startOf = (heatId: string) =>
    events.find((e) => e.payload.kind === 'start' && e.payload.heatId === heatId && !undone.has(e.id));

  const nextHeat = race.heats.find((h) => !startOf(h.id));

  return (
    <Screen>
      {nextHeat ? (
        <View style={s.next}>
          <Text style={s.nextTitle}>Next: heat {nextHeat.number}</Text>
          <P>
            {nextHeat.slots.length} teams, {divLabel.get(entryById.get(nextHeat.slots[0].entryId)!.divisionId)}. Planned{' '}
            {clock(nextHeat.startAt)}.
          </P>
          <Btn
            label={`Go! Start heat ${nextHeat.number}`}
            kind="go"
            big
            onPress={() => record({ kind: 'start', heatId: nextHeat.id })}
          />
        </View>
      ) : (
        <P>All heats have started.</P>
      )}

      {race.heats.map((h) => {
        const st = startOf(h.id);
        const finished = results.rows.filter((r) => r.heatId === h.id && r.status === 'finished').length;
        return (
          <View key={h.id} style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Heat {h.number}</Text>
              <Text style={s.rowSub}>
                {st ? `Started ${clock(st.deviceTs)}. ${finished} of ${h.slots.length} finished` : `Planned ${clock(h.startAt)}`}
              </Text>
            </View>
            {st && finished === 0 ? (
              <Btn label="Undo start" kind="plain" style={s.undo} onPress={() => record({ kind: 'undo', targetId: st.id })} />
            ) : null}
          </View>
        );
      })}
    </Screen>
  );
}

const s = StyleSheet.create({
  next: { gap: 10, borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 14 },
  nextTitle: { fontSize: 24, fontWeight: '800', color: C.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 10 },
  rowTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  rowSub: { fontSize: 16, color: C.muted },
  undo: { minWidth: 130 },
});
