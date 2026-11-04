import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatElapsed } from '@/core/results';
import { usePublicResults } from '@/public/use-public';
import { C, Notice, Screen, tap } from '@/ui/kit';

// Public live results. /r/<slug> for people, /r/<slug>?embed=1 for a gym's website.
export default function PublicResults() {
  const { slug, embed, div } = useLocalSearchParams<{ slug: string; embed?: string; div?: string }>();
  const isEmbed = embed === '1';
  const { data, error } = usePublicResults(slug);
  const [picked, setPicked] = useState<string | undefined>(div);

  if (!data) {
    return (
      <Screen status={false}>
        <Stack.Screen options={{ headerShown: !isEmbed, title: 'Results' }} />
        {error ? <Notice>{error}</Notice> : <ActivityIndicator size="large" color={C.text} />}
      </Screen>
    );
  }

  const { race, org, results } = data;
  const divisions = race.template.divisions;
  const current = picked && divisions.some((d) => d.id === picked) ? picked : divisions[0]?.id;
  const rows = results.rows
    .filter((r) => r.entry.divisionId === current && r.status !== 'entered')
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || Number(a.entry.code) - Number(b.entry.code));
  const finished = results.rows.filter((r) => r.status === 'finished').length;

  return (
    <Screen status={false}>
      <Stack.Screen options={{ headerShown: !isEmbed, title: race.name }} />
      {!isEmbed ? (
        <View style={s.head}>
          <Text style={s.title}>{race.name}</Text>
          <Text style={s.sub}>
            {org.name}
            {race.venue ? `, ${race.venue}` : ''}
            {race.raceDate ? `, ${race.raceDate}` : ''}. {finished} of {race.entries.length} finished.
          </Text>
        </View>
      ) : null}
      {error ? <Notice>{error}</Notice> : null}

      <View style={s.chips}>
        {divisions.map((d) => (
          <Pressable
            key={d.id}
            accessibilityRole="button"
            accessibilityState={{ selected: d.id === current }}
            accessibilityLabel={d.label}
            onPress={() => {
              tap();
              setPicked(d.id);
            }}
            style={[s.chip, d.id === current && s.chipOn]}>
            <Text style={[s.chipText, d.id === current && s.chipTextOn]}>{d.code}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.divLabel}>{divisions.find((d) => d.id === current)?.label}</Text>

      {rows.length === 0 ? <Text style={s.sub}>Nobody in this division has started yet.</Text> : null}
      {rows.map((r) => (
        <Pressable
          key={r.entry.id}
          accessibilityRole="button"
          disabled={r.status !== 'finished'}
          onPress={() => router.push({ pathname: '/r/[slug]/[code]', params: { slug, code: r.entry.code } })}
          style={({ pressed }) => [s.row, pressed && { backgroundColor: C.panel }]}>
          <Text style={s.rank}>{r.rank ?? ''}</Text>
          <View style={s.flex}>
            <Text style={s.name}>{r.entry.displayName}</Text>
            <Text style={s.small}>
              {r.entry.code}
              {r.penalties.length ? `. Penalty ${formatElapsed(r.penaltyMs)}` : ''}
              {r.status === 'finished' && !r.locked ? '. Not final yet' : ''}
            </Text>
          </View>
          <Text style={s.time}>{r.status === 'finished' ? formatElapsed(r.elapsedMs) : r.status === 'racing' ? 'Racing' : r.status}</Text>
        </Pressable>
      ))}

      {org.poweredBy ? <Text style={s.powered}>Timed with Race in a Box</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { gap: 4 },
  title: { fontSize: 28, fontWeight: '800', color: C.text },
  sub: { fontSize: 16, color: C.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, minWidth: 64, borderWidth: 2, borderColor: C.line, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  chipOn: { backgroundColor: C.text },
  chipText: { fontSize: 18, fontWeight: '800', color: C.text },
  chipTextOn: { color: '#FFFFFF' },
  divLabel: { fontSize: 18, fontWeight: '700', color: C.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 12, minHeight: 56 },
  rank: { width: 32, fontSize: 22, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  flex: { flex: 1 },
  name: { fontSize: 18, fontWeight: '800', color: C.text },
  small: { fontSize: 14, color: C.muted },
  time: { fontSize: 20, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  powered: { fontSize: 14, color: C.muted, textAlign: 'center', marginTop: 12 },
});
