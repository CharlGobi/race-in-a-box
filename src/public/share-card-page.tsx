import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';

import { appUrl } from '@/admin/client';
import { server } from '@/config';
import { ordinal, submitVisitor } from '@/core/public';
import { formatElapsed } from '@/core/results';
import { usePublicResults } from '@/public/use-public';
import { Btn, C, Choice, Field, Notice, P, Screen } from '@/ui/kit';

// The share card for one finisher, with a trial class for people who are not members yet.
export function ShareCardPage({ slug, code }: { slug: string; code: string }) {
  const { data, error } = usePublicResults(slug);

  if (!data) {
    return <Screen status={false}>{error ? <Notice>{error}</Notice> : <ActivityIndicator size="large" color={C.text} />}</Screen>;
  }
  const { race, org, results } = data;
  const row = results.rows.find((r) => r.entry.code === code);
  if (!row) return <Screen status={false}><Notice>There is no number {code} in this race.</Notice></Screen>;

  const div = race.template.divisions.find((d) => d.id === row.entry.divisionId);
  const inDiv = results.rows.filter((r) => r.entry.divisionId === row.entry.divisionId && r.rank !== undefined).length;
  const url = appUrl(`/r?s=${slug}&n=${code}`);
  const message =
    row.status === 'finished'
      ? `${row.entry.displayName} finished ${race.name} in ${formatElapsed(row.elapsedMs)}${row.rank ? `, ${ordinal(row.rank)} in ${div?.label ?? div?.code}` : ''}. ${url}`
      : `${row.entry.displayName} at ${race.name}. ${url}`;

  const share = async () => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      if (navigator.share) await navigator.share({ text: message }).catch(() => {});
      else await navigator.clipboard?.writeText(message);
    } else {
      await Share.share({ message });
    }
  };

  return (
    <Screen status={false}>
      <Stack.Screen options={{ title: row.entry.displayName }} />
      <View style={s.card} accessibilityLabel="Result card">
        <Text style={s.race}>{race.name}</Text>
        <Text style={s.who}>{row.entry.displayName}</Text>
        {row.status === 'finished' ? (
          <>
            <Text style={s.time}>{formatElapsed(row.elapsedMs)}</Text>
            {row.rank ? (
              <Text style={s.rank}>
                {ordinal(row.rank)} of {inDiv} in {div?.label ?? div?.code}
              </Text>
            ) : null}
            {!row.locked ? <Text style={s.note}>Not final until the protest window closes.</Text> : null}
          </>
        ) : (
          <Text style={s.rank}>{row.status === 'racing' ? 'Still racing' : row.status}</Text>
        )}
        <Text style={s.gym}>{org.name}</Text>
      </View>

      <Btn label="Share my result" kind="go" onPress={share} />
      {org.trialUrl ? <Btn label={`Join a free class at ${org.name}`} onPress={() => Linking.openURL(org.trialUrl!)} /> : null}
      <TrialForm slug={slug} code={code} gym={org.name} />
      <Btn label="All results" kind="plain" onPress={() => router.push({ pathname: '/r', params: { s: slug } })} />
    </Screen>
  );
}

function TrialForm({ slug, code, gym }: { slug: string; code: string; gym: string }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [ok, setOk] = useState<'yes' | 'no'>('no');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (state === 'done') return <Text style={s.thanks}>Thanks. {gym} will be in touch about a free class.</Text>;

  return (
    <View style={s.form}>
      <Text style={s.formTitle}>Not a member yet?</Text>
      <P muted>Leave your name and number or email and {gym} will book you a free class.</P>
      <Field label="Name" value={name} onChangeText={setName} autoComplete="name" />
      <Field label="Phone or email" value={contact} onChangeText={setContact} autoComplete="email" autoCapitalize="none" />
      <Choice
        label={`May ${gym} contact you about a free class?`}
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
        value={ok}
        onChange={setOk}
      />
      {error ? <Notice>{error}</Notice> : null}
      <Btn
        label={state === 'busy' ? 'Sending' : 'Book my free class'}
        disabled={state === 'busy' || ok !== 'yes' || !name.trim() || contact.trim().length < 3 || !server}
        onPress={async () => {
          setState('busy');
          setError(null);
          try {
            await submitVisitor(server!, slug, code, name, contact);
            setState('done');
          } catch {
            setError('That did not send. Try again in a moment.');
            setState('idle');
          }
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 3, borderColor: C.line, borderRadius: 12, padding: 20, gap: 6, alignItems: 'center', backgroundColor: C.bg },
  race: { fontSize: 18, fontWeight: '700', color: C.muted, textAlign: 'center' },
  who: { fontSize: 26, fontWeight: '800', color: C.text, textAlign: 'center' },
  time: { fontSize: 64, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  rank: { fontSize: 20, fontWeight: '800', color: C.text, textAlign: 'center' },
  note: { fontSize: 14, color: C.muted, textAlign: 'center' },
  gym: { fontSize: 16, fontWeight: '700', color: C.muted, marginTop: 8 },
  form: { borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12, gap: 10 },
  formTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  thanks: { fontSize: 18, fontWeight: '800', color: C.go },
});
