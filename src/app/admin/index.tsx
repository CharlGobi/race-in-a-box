import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminRpc, AdminError, sendSignInLink, supabase, useSession } from '@/admin/client';
import { Btn, C, Field, H1, Notice, P, Screen, tap } from '@/ui/kit';

type Org = { id: string; name: string; subdomain: string; role: string; trialUrl?: string | null };
type RaceRow = { id: string; name: string; raceDate: string; venue: string; status: string; entries: number };

export default function OrganiserHome() {
  const { session, loading } = useSession();

  if (!supabase) {
    return (
      <Screen status={false}>
        <H1>Organiser</H1>
        <Notice>This build has no server set up yet. Add the Supabase settings in GitHub, then this page works.</Notice>
      </Screen>
    );
  }
  if (loading) {
    return (
      <Screen status={false}>
        <ActivityIndicator size="large" color={C.text} />
      </Screen>
    );
  }
  return session ? <Gym email={session.user.email ?? ''} /> : <SignIn />;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    const err = await sendSignInLink(email);
    setBusy(false);
    if (err) setError(err);
    else setSent(true);
  };

  return (
    <Screen status={false}>
      <H1>Organiser sign in</H1>
      {sent ? (
        <>
          <P>We sent a sign in link to {email}. Open it on this phone or computer.</P>
          <Btn label="Use a different email" kind="plain" onPress={() => setSent(false)} />
        </>
      ) : (
        <>
          <P>No password. We email you a link.</P>
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" inputMode="email" />
          {error ? <Notice>{error}</Notice> : null}
          <Btn label={busy ? 'Sending' : 'Email me a link'} disabled={busy || !/.+@.+\..+/.test(email)} onPress={send} />
        </>
      )}
      <P muted>Judges and volunteers do not sign in. They open the link you send them.</P>
    </Screen>
  );
}

async function fetchGym(): Promise<{ orgs: Org[]; races: RaceRow[] }> {
  const orgs = await adminRpc<Org[]>('my_orgs', {});
  const races = orgs[0] ? await adminRpc<RaceRow[]>('list_races', { p_org: orgs[0].id }) : [];
  return { orgs, races };
}

function Gym({ email }: { email: string }) {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [races, setRaces] = useState<RaceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const load = () => {
    setError(null);
    setTick((n) => n + 1);
  };
  // Reload the race list when coming back from a new race.
  useFocusEffect(useCallback(() => setTick((n) => n + 1), []));

  useEffect(() => {
    let alive = true;
    fetchGym().then(
      (r) => {
        if (!alive) return;
        setOrgs(r.orgs);
        setRaces(r.races);
      },
      (e: AdminError) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [tick]);

  if (error) {
    return (
      <Screen status={false}>
        <Notice>{error}</Notice>
        <Btn label="Try again" onPress={load} />
      </Screen>
    );
  }
  if (!orgs) {
    return (
      <Screen status={false}>
        <ActivityIndicator size="large" color={C.text} />
      </Screen>
    );
  }
  if (orgs.length === 0) return <CreateGym onDone={load} />;

  const org = orgs[0]!;
  return (
    <Screen status={false}>
      <H1>{org.name}</H1>
      <P muted>Signed in as {email}</P>
      <Btn label="New race" big onPress={() => router.push({ pathname: '/admin/new-race', params: { org: org.id } })} />
      {races.length === 0 ? <P>No races yet.</P> : null}
      {races.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          onPress={() => {
            tap();
            router.push({ pathname: '/admin/race/[id]', params: { id: r.id } });
          }}
          style={({ pressed }) => [s.race, pressed && { backgroundColor: C.panel }]}>
          <Text style={s.raceName}>{r.name}</Text>
          <Text style={s.raceSub}>
            {r.raceDate}
            {r.venue ? `, ${r.venue}` : ''}. {r.entries} entries
          </Text>
        </Pressable>
      ))}
      {org.role === 'organiser' ? <TrialLink org={org} /> : null}
      <Btn label="Sign out" kind="plain" onPress={() => supabase?.auth.signOut()} />
    </Screen>
  );
}

function TrialLink({ org }: { org: Org }) {
  const [url, setUrl] = useState(org.trialUrl ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const clean = url.trim();
  return (
    <View style={s.race}>
      <Text style={s.raceName}>Trial class link</Text>
      <Text style={s.raceSub}>Where the Join a free class button on share cards goes. For example your booking page.</Text>
      <Field label="Booking link" value={url} onChangeText={setUrl} autoCapitalize="none" inputMode="url" placeholder="https://" />
      <Btn
        label="Save link"
        kind="plain"
        disabled={clean === (org.trialUrl ?? '') || (clean !== '' && !/^https:\/\//i.test(clean))}
        onPress={async () => {
          try {
            await adminRpc('update_org_trial_url', { p_org: org.id, p_url: clean });
            setMsg(clean ? 'Saved.' : 'Removed.');
          } catch (e) {
            setMsg((e as AdminError).message);
          }
        }}
      />
      {msg ? <Text style={s.raceSub}>{msg}</Text> : null}
    </View>
  );
}

function CreateGym({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [sub, setSub] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cleanSub = sub.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminRpc('create_org', { p_name: name.trim(), p_subdomain: cleanSub });
      onDone();
    } catch (e) {
      setError((e as AdminError).message);
      setBusy(false);
    }
  };

  return (
    <Screen status={false}>
      <H1>Set up your gym</H1>
      <Field
        label="Gym name"
        value={name}
        onChangeText={(v) => {
          setName(v);
          if (!sub) setSub(v);
        }}
      />
      <Field label="Short name for your web address" value={cleanSub} onChangeText={setSub} autoCapitalize="none" help={`Letters and numbers only: ${cleanSub || 'yourgym'}`} />
      {error ? <Notice>{error}</Notice> : null}
      <Btn label={busy ? 'Saving' : 'Create gym'} disabled={busy || !name.trim() || cleanSub.length < 2} onPress={create} />
    </Screen>
  );
}

const s = StyleSheet.create({
  race: { borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 14, gap: 4, minHeight: 56 },
  raceName: { fontSize: 20, fontWeight: '800', color: C.text },
  raceSub: { fontSize: 16, color: C.muted },
});
