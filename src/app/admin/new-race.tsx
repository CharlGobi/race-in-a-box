import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { adminRpc } from '@/admin/client';
import type { AdminError } from '@/admin/client';
import { findKitClashes, lastFinishEstimate } from '@/core/heats';
import { buildSetupPayload, parseTeamList } from '@/core/race-setup';
import { gobiTemplate } from '@/core/templates/gobi';
import { Btn, C, Field, H1, Notice, P, Screen } from '@/ui/kit';

const CODES = gobiTemplate.divisions.map((d) => d.code);
const STATIONS = gobiTemplate.segments.filter((s) => s.kind === 'station').map((s) => s.name);

function nextSaturday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

// South Africa has no daylight saving, so race times are fixed at UTC+2.
function startMs(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00+02:00`);
}

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
}

export default function NewRace() {
  const { org } = useLocalSearchParams<{ org: string }>();
  const [name, setName] = useState('');
  const [date, setDate] = useState(nextSaturday);
  const [venue, setVenue] = useState('');
  const [lanes, setLanes] = useState('5');
  const [interval, setInterval] = useState('6');
  const [first, setFirst] = useState('07:00');
  const [station, setStation] = useState('5');
  const [teams, setTeams] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parseTeamList(teams, CODES), [teams]);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
  const timeOk = /^\d{2}:\d{2}$/.test(first);
  const nLanes = Number(lanes);
  const nInterval = Number(interval);
  const planOk = dateOk && timeOk && nLanes >= 1 && nLanes <= 50 && nInterval >= 1 && nInterval <= 30;

  const payload = useMemo(
    () =>
      planOk
        ? buildSetupPayload(gobiTemplate, { name: name.trim(), raceDate: date, venue: venue.trim() }, parsed.entries, {
            lanes: nLanes,
            intervalMin: nInterval,
            firstStartAt: startMs(date, first),
          })
        : null,
    [planOk, name, date, venue, parsed.entries, nLanes, nInterval, first],
  );

  const heatsForCheck = payload?.heats.map((h) => ({ id: String(h.number), number: h.number, startAt: h.startAt, slots: [] })) ?? [];
  const clashes = findKitClashes(heatsForCheck, STATIONS, Number(station) || 0);
  const lastFinish = lastFinishEstimate(heatsForCheck, 90);

  const save = async () => {
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      const id = await adminRpc<string>('setup_race', { p_org: org, p: payload });
      router.replace({ pathname: '/admin/race/[id]', params: { id } });
    } catch (e) {
      setError((e as AdminError).message);
      setBusy(false);
    }
  };

  const canSave = !!payload && !!name.trim() && parsed.entries.length > 0 && parsed.errors.length === 0 && !busy;

  return (
    <Screen status={false}>
      <H1>New race</H1>
      <P muted>Format: Gobi Hybrid Games. Teams of 2 and relays of 4, 8 stations, 3 laps of 300 m between stations.</P>
      <Field label="Race name" value={name} onChangeText={setName} />
      <Field label="Date" value={date} onChangeText={setDate} help="Year, month, day. For example 2026-11-28" />
      <Field label="Venue" value={venue} onChangeText={setVenue} />

      <View style={s.row}>
        <Field label="Lanes" value={lanes} onChangeText={setLanes} keyboardType="number-pad" style={s.small} />
        <Field label="Minutes between heats" value={interval} onChangeText={setInterval} keyboardType="number-pad" style={s.small} />
      </View>
      <View style={s.row}>
        <Field label="First heat" value={first} onChangeText={setFirst} help="24 hour time" style={s.small} />
        <Field label="Longest station (min)" value={station} onChangeText={setStation} keyboardType="number-pad" style={s.small} />
      </View>

      <Field
        label="Teams"
        value={teams}
        onChangeText={setTeams}
        multiline
        autoCapitalize="none"
        placeholder={'1, Team Botha, T2M\n2, Team Naidoo, T2W\n3, Team Smit, R4X'}
        help={`One team per line: number, name, division. Paste from a spreadsheet works too. Divisions: ${CODES.join(', ')}.`}
      />

      {parsed.errors.length ? (
        <Notice>
          {parsed.errors.length} line{parsed.errors.length > 1 ? 's' : ''} to fix:{'\n'}
          {parsed.errors.slice(0, 8).join('\n')}
          {parsed.errors.length > 8 ? `\nand ${parsed.errors.length - 8} more` : ''}
        </Notice>
      ) : null}

      {payload && parsed.entries.length ? (
        <View style={s.summary}>
          <Text style={s.sumTitle}>
            {parsed.entries.length} teams in {payload.heats.length} heats
          </Text>
          <Text style={s.sumText}>
            First heat {clock(payload.heats[0]!.startAt)}, last heat {clock(payload.heats[payload.heats.length - 1]!.startAt)}.
            {lastFinish ? ` Last finish around ${clock(lastFinish)} if a team takes 90 minutes.` : ''}
          </Text>
        </View>
      ) : null}

      {clashes.length ? (
        <Notice>
          Kit clash: heats start {interval} minutes apart, but a heat spends {station} minutes at the longest station. Heats{' '}
          {clashes[0]!.heatA} and {clashes[0]!.heatB} will need the same kit at once. Make the gap at least {station} minutes, or add a kit set.
        </Notice>
      ) : null}

      {error ? <Notice>{error}</Notice> : null}
      <Btn label={busy ? 'Saving' : 'Save race'} big disabled={!canSave} onPress={save} />
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  small: { minWidth: 120 },
  summary: { borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12, gap: 4 },
  sumTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  sumText: { fontSize: 16, color: C.text, lineHeight: 22 },
});
