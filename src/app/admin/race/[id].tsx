import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';

import { adminRpc, appUrl } from '@/admin/client';
import { EntriesPanel } from '@/admin/entries-panel';
import type { AdminError } from '@/admin/client';
import { deriveResults, formatElapsed } from '@/core/results';
import { raceFromJson } from '@/core/sync-supabase';
import type { RawRace } from '@/core/sync-supabase';
import type { TimingEvent } from '@/core/types';
import { Btn, C, Field, H1, Notice, NumberField, P, Screen } from '@/ui/kit';

type Link = { id: string; role: string; label: string; expiresAt: string; revokedAt: string | null };
type Admin = RawRace & { canEdit: boolean; links: Link[]; events: TimingEvent[]; members?: Record<string, string[]> };

const ROLE_NAME: Record<string, string> = { judge: 'Timekeeper', head_judge: 'Head judge', volunteer: 'Volunteer', helper: 'Helper' };

export default function RaceAdmin() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Admin | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const load = () => setTick((n) => n + 1);

  useEffect(() => {
    let alive = true;
    adminRpc<Admin>('race_admin', { p_race: id }).then(
      (d) => {
        if (!alive) return;
        setData(d);
        setLoadedAt(Date.now());
        setError(null);
      },
      (e: AdminError) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [id, tick]);

  // Refresh every 15 seconds while the page is open.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const race = useMemo(() => (data ? raceFromJson(data) : null), [data]);
  const results = useMemo(() => (race && data ? deriveResults(race, data.events.map((e) => ({ ...e, deviceTs: Number(e.deviceTs) }))) : null), [race, data]);

  if (!data || !race || !results) {
    return (
      <Screen status={false}>
        {error ? <Notice>{error}</Notice> : <ActivityIndicator size="large" color={C.text} />}
      </Screen>
    );
  }

  const finished = results.rows.filter((r) => r.status === 'finished');
  const started = new Set(results.rows.filter((r) => r.startAt !== undefined).map((r) => r.heatId)).size;
  const disagree = results.flags.filter((f) => f.kind === 'devices_disagree').length;
  const timedEntryIds = new Set(data.events.flatMap((e) => (e.entryId ? [e.entryId] : [])));
  const fastest = [...finished].sort((a, b) => (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0)).slice(0, 3);

  return (
    <Screen status={false}>
      <H1>{race.name}</H1>
      <P muted>
        {data.race.raceDate}
        {race.venue ? `, ${race.venue}` : ''}. {race.entries.length} entries in {race.heats.length} heats.
      </P>
      {error ? <Notice>{error}</Notice> : null}

      <View style={s.box}>
        <Text style={s.boxTitle}>Race day</Text>
        <Text style={s.boxText}>
          {started} of {race.heats.length} heats started. {finished.length} of {race.entries.length} finished.
        </Text>
        {disagree ? <Text style={[s.boxText, { color: C.warn, fontWeight: '800' }]}>Phones disagree on {disagree} finish times.</Text> : null}
        {fastest.map((r) => (
          <Text key={r.entry.id} style={s.boxText}>
            {r.entry.displayName}: {formatElapsed(r.elapsedMs)}
          </Text>
        ))}
        <Btn label="Refresh" kind="plain" onPress={load} />
      </View>

      {data.canEdit ? <ProtestWindow raceId={race.id} value={race.protestWindowMin ?? 15} onSaved={load} /> : null}

      {data.canEdit ? <MakeLink raceId={race.id} onMade={load} /> : null}

      <Text style={s.section}>Links</Text>
      {data.links.length === 0 ? <P muted>No links yet.</P> : null}
      {data.links.map((l) => (
        <LinkRow key={l.id} link={l} now={loadedAt} canEdit={data.canEdit} onChange={load} />
      ))}

      <EntriesPanel race={race} members={data.members ?? {}} timedEntryIds={timedEntryIds} canEdit={data.canEdit} onChange={load} />
    </Screen>
  );
}

function ProtestWindow({ raceId, value, onSaved }: { raceId: string; value: number; onSaved: () => void }) {
  const [mins, setMins] = useState<number | undefined>(value);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <View style={s.box}>
      <Text style={s.boxTitle}>Protest window</Text>
      <Text style={s.boxText}>Each heat locks this many minutes after its last result. After that only the head judge can change it.</Text>
      <NumberField label="Minutes" value={mins} onValue={setMins} allowEmpty />
      <Btn
        label="Save"
        kind="plain"
        disabled={mins === undefined || mins < 0 || mins > 240 || mins === value}
        onPress={async () => {
          try {
            await adminRpc('update_race_settings', { p_race: raceId, p_protest_window_min: Math.round(mins!) });
            setMsg(`Saved. Heats lock ${Math.round(mins!)} minutes after their last result.`);
            onSaved();
          } catch (e) {
            setMsg((e as AdminError).message);
          }
        }}
      />
      {msg ? <Text style={s.boxText}>{msg}</Text> : null}
    </View>
  );
}

function MakeLink({ raceId, onMade }: { raceId: string; onMade: () => void }) {
  const [role, setRole] = useState<'judge' | 'head_judge'>('judge');
  const [label, setLabel] = useState('');
  const [made, setMade] = useState<{ url: string; qr: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await adminRpc<string>('create_access_link', {
        p_race: raceId,
        p_role: role,
        p_label: label.trim() || ROLE_NAME[role],
        p_valid_hours: 72,
      });
      const url = appUrl(`/l/${token}`);
      const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      setMade({ url, qr: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, label: label.trim() || ROLE_NAME[role]! });
      setLabel('');
      onMade();
    } catch (e) {
      setError((e as AdminError).message);
    }
    setBusy(false);
  };

  const message = made ? `Race timing link for ${made.label}. Open it on race day, no app needed: ${made.url}` : '';

  return (
    <View style={s.box}>
      <Text style={s.boxTitle}>Make a judge link</Text>
      <View style={s.row}>
        <Btn label="Timekeeper" kind={role === 'judge' ? 'primary' : 'plain'} style={s.flex} onPress={() => setRole('judge')} />
        <Btn label="Head judge" kind={role === 'head_judge' ? 'primary' : 'plain'} style={s.flex} onPress={() => setRole('head_judge')} />
      </View>
      <Field label="Who or where" value={label} onChangeText={setLabel} placeholder="For example Finish line, Thabo" />
      <Btn label={busy ? 'Making link' : 'Make link'} disabled={busy} onPress={make} />
      {error ? <Notice>{error}</Notice> : null}
      {made ? (
        <View style={s.made}>
          <Text style={s.boxText}>Link for {made.label}. It works for 3 days. Scan the code or send the link.</Text>
          <Image source={{ uri: made.qr }} style={s.qr} contentFit="contain" accessibilityLabel={`QR code for ${made.label}`} />
          <Text selectable style={s.url}>
            {made.url}
          </Text>
          <Btn label="Send on WhatsApp" kind="go" onPress={() => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`)} />
          <Btn
            label={Platform.OS === 'web' ? 'Copy link' : 'Share link'}
            kind="plain"
            onPress={() => {
              if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(made.url);
              else Share.share({ message });
            }}
          />
          <P muted>The link is only shown now. If you lose it, switch it off and make a new one.</P>
        </View>
      ) : null}
    </View>
  );
}

function LinkRow({ link, now, canEdit, onChange }: { link: Link; now: number; canEdit: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const expired = new Date(link.expiresAt).getTime() < now;
  const state = link.revokedAt ? 'Switched off' : expired ? 'Expired' : `Works until ${new Date(link.expiresAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}`;
  return (
    <View style={s.link}>
      <View style={s.flex}>
        <Text style={s.linkTitle}>
          {link.label} ({ROLE_NAME[link.role] ?? link.role})
        </Text>
        <Text style={s.linkSub}>{state}</Text>
      </View>
      {canEdit && !link.revokedAt && !expired ? (
        <Btn
          label={busy ? 'Wait' : 'Switch off'}
          kind="stop"
          disabled={busy}
          style={s.revoke}
          onPress={async () => {
            setBusy(true);
            try {
              await adminRpc('revoke_access_link', { p_link: link.id });
            } finally {
              setBusy(false);
              onChange();
            }
          }}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12, gap: 10 },
  boxTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  boxText: { fontSize: 17, color: C.text, lineHeight: 24 },
  section: { fontSize: 20, fontWeight: '800', color: C.text, marginTop: 6 },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  made: { gap: 10, alignItems: 'stretch' },
  qr: { width: 240, height: 240, alignSelf: 'center', backgroundColor: '#FFFFFF' },
  url: { fontSize: 14, color: C.text, fontFamily: Platform.select({ web: 'monospace', default: undefined }) },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 10 },
  linkTitle: { fontSize: 18, fontWeight: '800', color: C.text },
  linkSub: { fontSize: 15, color: C.muted },
  revoke: { minWidth: 130 },
});
