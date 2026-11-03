import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useRace } from '@/app-state/race-context';
import { formatElapsed } from '@/core/results';
import type { ResultRow } from '@/core/results';
import { C, Notice, Screen, tap } from '@/ui/kit';

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + '.')
    .join(' ');
}

function members(row: ResultRow) {
  return row.entry.members.map((m) => (m.showAsInitials ? initials(m.name) : m.name)).join(', ');
}

export default function Results() {
  const { race, results, role } = useRace();
  const [div, setDiv] = useState(race.template.divisions[0].id);

  const rows = results.rows
    .filter((r) => r.entry.divisionId === div)
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || Number(a.entry.code) - Number(b.entry.code));

  const disagree = results.flags.filter((f) => f.kind === 'devices_disagree');
  const codeOf = new Map(race.entries.map((e) => [e.id, e.code]));

  return (
    <Screen>
      {role === 'head_judge' && disagree.length ? (
        <Notice>
          Phones disagree on {disagree.length} finish{disagree.length > 1 ? 'es' : ''}:{' '}
          {disagree.map((f) => (f.kind === 'devices_disagree' ? `team ${codeOf.get(f.entryId)} by ${Math.round(f.gapMs / 1000)} s` : '')).join(', ')}
        </Notice>
      ) : null}

      <View style={s.chips}>
        {race.template.divisions.map((d) => (
          <Pressable
            key={d.id}
            accessibilityRole="button"
            accessibilityState={{ selected: d.id === div }}
            onPress={() => {
              tap();
              setDiv(d.id);
            }}
            style={[s.chip, d.id === div && s.chipOn]}>
            <Text style={[s.chipText, d.id === div && s.chipTextOn]}>{d.code}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.divLabel}>{race.template.divisions.find((d) => d.id === div)?.label}</Text>

      {rows.map((r) => (
        <View key={r.entry.id} style={s.row}>
          <Text style={s.rank}>{r.rank ?? ''}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>
              {r.entry.displayName}
            </Text>
            <Text style={s.members}>{members(r)}</Text>
          </View>
          <Text style={s.time}>
            {r.status === 'finished'
              ? formatElapsed(r.elapsedMs)
              : r.status === 'racing'
                ? 'Racing'
                : r.status === 'entered'
                  ? ''
                  : r.status}
          </Text>
        </View>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, minWidth: 72, borderWidth: 2, borderColor: C.line, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  chipOn: { backgroundColor: C.text },
  chipText: { fontSize: 18, fontWeight: '800', color: C.text },
  chipTextOn: { color: '#FFFFFF' },
  divLabel: { fontSize: 18, fontWeight: '700', color: C.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 10 },
  rank: { width: 32, fontSize: 22, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  name: { fontSize: 18, fontWeight: '800', color: C.text },
  members: { fontSize: 15, color: C.muted },
  time: { fontSize: 20, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
});
