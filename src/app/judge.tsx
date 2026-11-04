import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useRace } from '@/app-state/race-context';
import { deviceActivity, formatElapsed, parseElapsed } from '@/core/results';
import type { ResultRow } from '@/core/results';
import type { TimingEvent } from '@/core/types';
import { Btn, C, Choice, Field, H1, Notice, P, Screen } from '@/ui/kit';

const PENALTY_SECONDS = [
  { value: '10', label: '10 s' },
  { value: '30', label: '30 s' },
  { value: '60', label: '1 min' },
  { value: '120', label: '2 min' },
] as const;

const PENALTY_REASONS = ['No rep', 'Short distance', 'Missed station', 'Wrong weight', 'Other'];
const STATUS_REASONS = ['Injury', 'Did not start', 'Skipped a station', 'Outside help', 'Other'];

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

function ago(ms: number, now: number) {
  const m = Math.round((now - ms) / 60_000);
  return m < 1 ? 'just now' : m === 1 ? '1 min ago' : `${m} min ago`;
}

export default function HeadJudge() {
  const { role, results, record, events, now } = useRace();
  const [find, setFind] = useState('');

  if (role !== 'head_judge') {
    return (
      <Screen>
        <Notice>This screen is for the head judge. Open the head judge link from the organiser.</Notice>
      </Screen>
    );
  }

  const byId = new Map(results.rows.map((r) => [r.entry.id, r]));
  const disagree = results.flags.filter((f) => f.kind === 'devices_disagree');
  const late = results.flags.filter((f) => f.kind === 'after_lock');
  const found = find ? results.rows.find((r) => r.entry.code === find.trim()) : undefined;

  return (
    <Screen>
      <H1>Head judge</H1>

      {disagree.length || late.length ? <Text style={s.h2}>Needs you</Text> : <P muted>Nothing needs you right now.</P>}
      {disagree.map((f) =>
        f.kind === 'devices_disagree' ? (
          <Disagree key={f.entryId} row={byId.get(f.entryId)!} taps={events.filter((e) => f.eventIds.includes(e.id))} onPick={(at) => record({ kind: 'edit', field: 'finish', at, reason: 'Phones disagreed' }, f.entryId)} />
        ) : null,
      )}
      {late.length ? (
        <Notice>
          {late.length} change{late.length > 1 ? 's' : ''} came in after the heat locked and {late.length > 1 ? 'were' : 'was'} not used: team{' '}
          {[...new Set(late.map((f) => (f.kind === 'after_lock' ? byId.get(f.entryId)?.entry.code : '')))].join(', ')}. Check and redo it here if it should count.
        </Notice>
      ) : null}

      <Text style={s.h2}>Find a team</Text>
      <Field label="Team or athlete number" value={find} onChangeText={setFind} inputMode="numeric" keyboardType="number-pad" />
      {find && !found ? <P muted>No number {find} in this race.</P> : null}
      {found ? <EntryCard key={found.entry.id} row={found} /> : null}

      <Text style={s.h2}>Heats</Text>
      <DelayButtons onDelay={(minutes) => record({ kind: 'delay', minutes, reason: 'Delay' })} />
      {results.heats.map((h) => {
        const rows = results.rows.filter((r) => r.heatId === h.heatId);
        const done = rows.filter((r) => ['finished', 'DNF', 'DNS', 'DSQ'].includes(r.status)).length;
        return (
          <View key={h.heatId} style={s.heat}>
            <View style={s.flex}>
              <Text style={s.heatTitle}>Heat {h.number}</Text>
              <Text style={s.heatSub}>
                {h.startAt ? `Started ${clock(h.startAt)}. ${done} of ${rows.length} done.` : `Starts ${clock(h.plannedStartAt)}.`}
                {h.locked ? ' Locked.' : h.lockAt ? ` Locks ${clock(h.lockAt)}.` : ''}
              </Text>
            </View>
            {h.startAt && !h.locked ? <Btn label="Lock now" kind="plain" style={s.lock} onPress={() => record({ kind: 'lock', heatId: h.heatId })} /> : null}
          </View>
        );
      })}

      <Text style={s.h2}>Phones</Text>
      <P muted>{"If the main finish phone goes quiet, open Finish line on this phone. Your taps count over a timekeeper's."}</P>
      {deviceActivity(events).map((d) => (
        <View key={d.deviceId} style={s.heat}>
          <View style={s.flex}>
            <Text style={s.heatTitle}>
              {d.role === 'head_judge' ? 'Head judge' : 'Timekeeper'} {d.deviceId.slice(-4)}
            </Text>
            <Text style={[s.heatSub, now - d.lastAt > 5 * 60_000 && { color: C.warn, fontWeight: '800' }]}>
              {d.count} taps. Last tap {ago(d.lastAt, now)}. {d.lastSentAt ? `Last sent ${ago(d.lastSentAt, now)}.` : 'Nothing sent yet.'}
            </Text>
          </View>
        </View>
      ))}
      <Btn label="Open the finish line" onPress={() => router.push('/finish')} />
    </Screen>
  );
}

function Disagree({ row, taps, onPick }: { row: ResultRow; taps: TimingEvent[]; onPick: (at: number) => void }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>
        {row.entry.code}. {row.entry.displayName}: phones disagree
      </Text>
      {taps.map((t) => (
        <Btn
          key={t.id}
          kind="plain"
          label={`Use ${row.startAt !== undefined ? formatElapsed(t.deviceTs - row.startAt) : clock(t.deviceTs)} from phone ${t.deviceId.slice(-4)}`}
          onPress={() => onPick(t.deviceTs)}
        />
      ))}
    </View>
  );
}

function EntryCard({ row }: { row: ResultRow }) {
  const { record, events } = useRace();
  const [secs, setSecs] = useState<string>('30');
  const [reason, setReason] = useState(PENALTY_REASONS[0]!);
  const [status, setStatus] = useState<'DNF' | 'DNS' | 'DSQ'>('DNF');
  const [statusReason, setStatusReason] = useState(STATUS_REASONS[0]!);
  const [time, setTime] = useState(row.elapsedMs !== undefined ? formatElapsed(row.elapsedMs - row.penaltyMs) : '');
  const [msg, setMsg] = useState<string | null>(null);
  const id = row.entry.id;
  const mine = events.filter((e) => e.entryId === id && e.actorRole === 'head_judge' && e.payload.kind !== 'undo');
  const undone = new Set(events.flatMap((e) => (e.payload.kind === 'undo' ? [e.payload.targetId] : [])));
  const lastMine = [...mine].reverse().find((e) => !undone.has(e.id));
  const parsed = parseElapsed(time);

  const done = (text: string) => setMsg(text);

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>
        {row.entry.code}. {row.entry.displayName}
      </Text>
      <Text style={s.big}>
        {row.status === 'finished' ? formatElapsed(row.elapsedMs) : row.status === 'racing' ? 'Racing' : row.status === 'entered' ? 'Not started' : row.status}
        {row.statusReason ? <Text style={s.heatSub}>  {row.statusReason}</Text> : null}
        {row.locked ? <Text style={s.heatSub}>  Locked</Text> : null}
      </Text>
      {row.penalties.map((p) => (
        <Text key={p.eventId} style={s.heatSub}>
          Penalty {p.seconds} s: {p.reason}
        </Text>
      ))}

      <Choice label="Penalty" options={[...PENALTY_SECONDS]} value={secs as (typeof PENALTY_SECONDS)[number]['value']} onChange={setSecs} />
      <Choice label="Why" options={PENALTY_REASONS.map((r) => ({ value: r, label: r }))} value={reason} onChange={setReason} />
      <Btn label={`Add ${secs} s penalty`} onPress={() => record({ kind: 'penalty', seconds: Number(secs), reason }, id).then(() => done(`Added ${secs} s for ${reason}.`))} />

      <Choice
        label="Out of the race"
        options={[
          { value: 'DNF', label: 'DNF' },
          { value: 'DNS', label: 'DNS' },
          { value: 'DSQ', label: 'DSQ' },
        ]}
        value={status}
        onChange={setStatus}
      />
      <Choice label="Why" options={STATUS_REASONS.map((r) => ({ value: r, label: r }))} value={statusReason} onChange={setStatusReason} />
      <Btn label={`Mark ${status}`} kind="stop" onPress={() => record({ kind: 'status', status, reason: statusReason }, id).then(() => done(`Marked ${status}: ${statusReason}.`))} />

      {row.startAt !== undefined ? (
        <>
          <Field label="Correct the time (before penalties)" value={time} onChangeText={setTime} placeholder="47:05" help="Minutes and seconds, or hours, minutes and seconds" />
          <Btn
            label="Save corrected time"
            kind="plain"
            disabled={parsed === undefined}
            onPress={() =>
              parsed !== undefined && record({ kind: 'edit', field: 'finish', at: row.startAt! + parsed, reason: 'Head judge correction' }, id).then(() => done(`Time set to ${formatElapsed(parsed)}.`))
            }
          />
        </>
      ) : (
        <P muted>{"This team's heat has not started, so there is no time to correct."}</P>
      )}

      {lastMine ? (
        <Btn label="Undo my last change" kind="plain" onPress={() => record({ kind: 'undo', targetId: lastMine.id }, id).then(() => done('Undone.'))} />
      ) : null}
      {msg ? <Text style={s.ok}>{msg}</Text> : null}
    </View>
  );
}

function DelayButtons({ onDelay }: { onDelay: (minutes: number) => void }) {
  const [armed, setArmed] = useState<number | null>(null);
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Delay every heat that has not started, in minutes</Text>
      <View style={s.row}>
        {[1, 2, 5, 10].map((m) => (
          <Btn key={m} label={String(m)} hint={`${m} minutes`} kind={armed === m ? 'primary' : 'plain'} style={s.flex} onPress={() => setArmed(m)} />
        ))}
      </View>
      {armed ? (
        <Btn
          label={`Yes, delay later heats by ${armed} min`}
          kind="stop"
          onPress={() => {
            onDelay(armed);
            setArmed(null);
          }}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  h2: { fontSize: 22, fontWeight: '800', color: C.text, marginTop: 8 },
  card: { borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12, gap: 10 },
  cardTitle: { fontSize: 19, fontWeight: '800', color: C.text },
  big: { fontSize: 32, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  heat: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 8 },
  heatTitle: { fontSize: 18, fontWeight: '800', color: C.text },
  heatSub: { fontSize: 15, fontWeight: '400', color: C.muted },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 8 },
  lock: { minWidth: 120 },
  ok: { fontSize: 18, fontWeight: '800', color: C.go },
});
