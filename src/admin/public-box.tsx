import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { Btn, C, Choice, Notice } from '@/ui/kit';

import { adminRpc, appUrl } from './client';
import type { AdminError } from './client';

type Info = { slug: string; public: boolean; trialUrl: string | null; visitors: { name: string; contact: string; entryCode: string; at: string }[] };

/** Public results link, website embed, show or hide, and visitors who asked for a trial class. */
export function PublicBox({ raceId, canEdit, tick }: { raceId: string; canEdit: boolean; tick: number }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState(0);

  useEffect(() => {
    let alive = true;
    adminRpc<Info>('race_public_info', { p_race: raceId }).then(
      (i) => alive && setInfo(i),
      (e: AdminError) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [raceId, tick, mine]);

  if (!info) return error ? <Notice>{error}</Notice> : null;
  const url = appUrl(`/r?s=${info.slug}`);
  const embed = `<iframe src="${url}&embed=1" style="width:100%;height:700px;border:0" title="Live results"></iframe>`;
  const copy = (text: string) => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') navigator.clipboard?.writeText(text);
  };

  return (
    <View style={s.box}>
      <Text style={s.title}>Public results</Text>
      {canEdit ? (
        <Choice
          label="Show results to the public"
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
          value={info.public ? 'yes' : 'no'}
          onChange={async (v) => {
            await adminRpc('set_results_public', { p_race: raceId, p_public: v === 'yes' });
            setMine((n) => n + 1);
          }}
        />
      ) : null}
      {info.public ? (
        <>
          <Text selectable style={s.mono}>
            {url}
          </Text>
          <View style={s.row}>
            <Btn label="Open" kind="plain" style={s.flex} onPress={() => Linking.openURL(url)} />
            {Platform.OS === 'web' ? <Btn label="Copy link" kind="plain" style={s.flex} onPress={() => copy(url)} /> : null}
          </View>
          <Text style={s.text}>To put live results on your website, paste this where the results should go:</Text>
          <Text selectable style={s.mono}>
            {embed}
          </Text>
          {Platform.OS === 'web' ? <Btn label="Copy website code" kind="plain" onPress={() => copy(embed)} /> : null}
        </>
      ) : (
        <Text style={s.text}>Results are hidden. The link shows a not found message.</Text>
      )}
      {!info.trialUrl ? <Text style={s.text}>Add your trial class booking link on your gym page, and the share card gets a Join a free class button.</Text> : null}

      {canEdit ? (
        <>
          <Text style={s.title}>Visitors who want a trial class ({info.visitors.length})</Text>
          {info.visitors.length === 0 ? <Text style={s.text}>None yet. They appear here when someone fills in the form on a share card.</Text> : null}
          {info.visitors.map((v, i) => (
            <View key={i} style={s.visitor}>
              <Text style={s.name}>
                {v.name}
                {v.entryCode ? `, number ${v.entryCode}` : ''}
              </Text>
              <Text selectable style={s.text}>
                {v.contact}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12, gap: 10 },
  title: { fontSize: 20, fontWeight: '800', color: C.text },
  text: { fontSize: 16, color: C.text, lineHeight: 22 },
  mono: { fontSize: 13, color: C.text, fontFamily: Platform.select({ web: 'monospace', default: undefined }), backgroundColor: C.panel, padding: 8, borderRadius: 6 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  visitor: { borderBottomWidth: 1, borderColor: C.line, paddingVertical: 6 },
  name: { fontSize: 17, fontWeight: '800', color: C.text },
});
