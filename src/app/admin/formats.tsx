import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { AdminError } from '@/admin/client';
import { loadFormats } from '@/admin/formats';
import type { FormatChoice } from '@/admin/formats';
import { Btn, C, H1, Notice, P, Screen } from '@/ui/kit';

export default function Formats() {
  const { org } = useLocalSearchParams<{ org: string }>();
  const [list, setList] = useState<FormatChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reload each time the page comes back into view, for example after saving a format.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadFormats(org).then(
        (l) => alive && setList(l),
        (e: AdminError) => alive && setError(e.message),
      );
      return () => {
        alive = false;
      };
    }, [org]),
  );

  const open = (params: Record<string, string>) => router.push({ pathname: '/admin/format', params: { org, ...params } });

  return (
    <Screen status={false}>
      <H1>Race formats</H1>
      <P muted>A format is the divisions, the runs and stations, and the targets. Copy one to change it, or start blank.</P>
      <Btn label="Start a blank format" onPress={() => open({ from: 'blank' })} />
      {error ? <Notice>{error}</Notice> : null}
      {!list && !error ? <ActivityIndicator size="large" color={C.text} /> : null}
      {list?.map((f) => (
        <View key={f.key} style={s.card}>
          <Text style={s.name}>{f.template.name}</Text>
          <Text style={s.sub}>
            {f.builtIn ? 'Comes with the app. ' : 'Your gym. '}
            {f.template.divisions.length} divisions, {f.template.segments.length} parts.
          </Text>
          <View style={s.row}>
            {f.gymId ? <Btn label="Edit" style={s.flex} onPress={() => open({ id: f.gymId! })} /> : null}
            <Btn label="Copy" kind="plain" style={s.flex} onPress={() => open({ from: f.key })} />
          </View>
        </View>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12, gap: 8 },
  name: { fontSize: 19, fontWeight: '800', color: C.text },
  sub: { fontSize: 15, color: C.muted },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
