import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  addDivision,
  addRunsBeforeStations,
  addSegment,
  clearTargets,
  describeTarget,
  moveSegment,
  removeDivision,
  removeSegment,
  setTarget,
  setTargetForAll,
  targetFor,
  targetsAreSame,
  updateDivision,
  updateSegment,
  validateTemplate,
} from '@/core/template-builder';
import type { Division, RaceTemplate, Segment } from '@/core/types';
import { Btn, C, Choice, Field, Notice, NumberField } from '@/ui/kit';

const KIND = [
  { value: 'run', label: 'Run' },
  { value: 'station', label: 'Station' },
  { value: 'rest', label: 'Rest' },
] as const;

const METRIC = [
  { value: 'distance', label: 'Distance' },
  { value: 'reps', label: 'Reps' },
  { value: 'calories', label: 'Calories' },
  { value: 'time', label: 'Time' },
] as const;

const ENTRY = [
  { value: 'solo', label: 'Solo' },
  { value: 'team', label: 'Team' },
  { value: 'relay', label: 'Relay' },
] as const;

const RULE = [
  { value: 'split', label: 'Split as they like' },
  { value: 'shared', label: 'Share the work' },
  { value: 'each', label: 'Each does it all' },
] as const;

const DEFAULT_UNIT: Record<Segment['metric'], string> = { distance: 'm', reps: 'reps', calories: 'cal', time: 'min' };

type Props = { value: RaceTemplate; onChange: (t: RaceTemplate) => void };

/** The whole race builder. Pure: it edits the template it is given. */
export function FormatEditor({ value: t, onChange }: Props) {
  const errors = validateTemplate(t);
  const hasTeams = t.divisions.some((d) => d.entryKind !== 'solo');
  const [runDistance, setRunDistance] = useState<number | undefined>(1000);

  return (
    <View style={s.wrap}>
      <Field label="Format name" value={t.name} onChangeText={(name) => onChange({ ...t, name })} />

      <Text style={s.h2}>Divisions</Text>
      {t.divisions.map((d) => (
        <DivisionCard key={d.id} d={d} onChange={(patch) => onChange(updateDivision(t, d.id, patch))} onRemove={() => onChange(removeDivision(t, d.id))} />
      ))}
      <Btn
        label="Add division"
        kind="plain"
        onPress={() => onChange(addDivision(t, { code: nextCode(t), label: '', entryKind: t.divisions.at(-1)?.entryKind ?? 'solo', teamSize: t.divisions.at(-1)?.teamSize ?? 1 }))}
      />

      <Text style={s.h2}>Race order</Text>
      {t.segments.length === 0 ? <Text style={s.muted}>Add the stations first. Then one tap puts a run before each one.</Text> : null}
      {t.segments.map((seg, i) => (
        <SegmentCard
          key={seg.id}
          t={t}
          seg={seg}
          first={i === 0}
          last={i === t.segments.length - 1}
          hasTeams={hasTeams}
          onChange={onChange}
        />
      ))}
      <View style={s.row}>
        <Btn label="Add station" kind="plain" style={s.flex} onPress={() => onChange(addSegment(t, { kind: 'station', name: '', metric: 'reps', timed: false, ...(hasTeams ? { teamRule: 'split' as const } : {}) }))} />
        <Btn label="Add run" kind="plain" style={s.flex} onPress={() => onChange(addSegment(t, { kind: 'run', name: `Run ${t.segments.filter((x) => x.kind === 'run').length + 1}`, metric: 'distance', timed: false }))} />
      </View>
      <View style={s.box}>
        <NumberField label="Run distance (m)" value={runDistance} onValue={setRunDistance} allowEmpty />
        <Btn
          label="Put a run before every station"
          kind="plain"
          disabled={!runDistance || !t.segments.some((x) => x.kind === 'station')}
          onPress={() => runDistance && onChange(addRunsBeforeStations(t, 'Run', runDistance))}
        />
      </View>

      {errors.length ? (
        <Notice>
          {errors.length} thing{errors.length > 1 ? 's' : ''} to fix before saving:{'\n'}
          {errors.join('\n')}
        </Notice>
      ) : null}
    </View>
  );
}

function nextCode(t: RaceTemplate): string {
  let n = t.divisions.length + 1;
  const used = new Set(t.divisions.map((d) => d.code));
  while (used.has(`D${n}`)) n++;
  return `D${n}`;
}

function DivisionCard({ d, onChange, onRemove }: { d: Division; onChange: (p: Partial<Omit<Division, 'id'>>) => void; onRemove: () => void }) {
  return (
    <View style={s.card}>
      <View style={s.row}>
        <Field label="Code" value={d.code} autoCapitalize="characters" maxLength={8} onChangeText={(code) => onChange({ code })} style={s.code} />
        <View style={s.flex}>
          <Field label="Name" value={d.label} onChangeText={(label) => onChange({ label })} placeholder="For example Women Open" />
        </View>
      </View>
      <Choice
        label="Who races"
        options={[...ENTRY]}
        value={d.entryKind ?? 'team'}
        onChange={(entryKind) => onChange({ entryKind, teamSize: entryKind === 'solo' ? 1 : Math.max(2, d.teamSize ?? 2) })}
      />
      {d.entryKind !== 'solo' ? <NumberField label="People per team" value={d.teamSize} onValue={(n) => onChange({ teamSize: n ?? 2 })} /> : null}
      <Btn label={`Remove ${d.code}`} kind="plain" onPress={onRemove} />
    </View>
  );
}

function SegmentCard({
  t,
  seg,
  first,
  last,
  hasTeams,
  onChange,
}: {
  t: RaceTemplate;
  seg: Segment;
  first: boolean;
  last: boolean;
  hasTeams: boolean;
  onChange: (t: RaceTemplate) => void;
}) {
  const same = targetsAreSame(t, seg.id);
  const [perDivision, setPerDivision] = useState(!same);
  const firstTarget = t.divisions[0] ? targetFor(t, seg.id, t.divisions[0].id) : undefined;
  const unit = firstTarget?.unit ?? DEFAULT_UNIT[seg.metric];

  return (
    <View style={[s.card, seg.kind === 'run' && s.runCard]}>
      <Text style={s.cardTitle}>
        {seg.order}. {seg.name || (seg.kind === 'run' ? 'Run' : 'Station')}
        <Text style={s.muted}>  {t.divisions.length ? (same ? describeTarget(firstTarget) : 'Different per division') : ''}</Text>
      </Text>
      <Choice options={[...KIND]} value={seg.kind as 'run' | 'station' | 'rest'} onChange={(kind) => onChange(updateSegment(t, seg.id, { kind, ...(kind === 'run' ? { metric: 'distance' as const } : {}) }))} />
      <Field label="Name" value={seg.name} onChangeText={(name) => onChange(updateSegment(t, seg.id, { name }))} placeholder="For example Sled push" />
      {seg.kind !== 'run' ? (
        <Choice label="Measured in" options={[...METRIC]} value={seg.metric} onChange={(metric) => onChange(updateSegment(t, seg.id, { metric }))} />
      ) : null}
      {hasTeams && seg.kind === 'station' ? (
        <Choice label="Teams" options={[...RULE]} value={seg.teamRule ?? 'split'} onChange={(teamRule) => onChange(updateSegment(t, seg.id, { teamRule }))} />
      ) : null}

      {t.divisions.length ? (
        <>
          <Choice
            label="Target"
            options={[
              { value: 'same', label: 'Same for everyone' },
              { value: 'each', label: 'Different per division' },
            ]}
            value={perDivision ? 'each' : 'same'}
            onChange={(v) => setPerDivision(v === 'each')}
          />
          {perDivision ? (
            t.divisions.map((d) => {
              const x = targetFor(t, seg.id, d.id);
              return (
                <View key={d.id} style={s.row}>
                  <Text style={s.divCode}>{d.code}</Text>
                  <View style={s.flex}>
                    <NumberField
                      label={`Target (${unit})`}
                      value={x?.value}
                      allowEmpty
                      onValue={(v) => onChange(v === undefined ? t : setTarget(t, seg.id, d.id, { value: v, unit, weight: x?.weight }))}
                    />
                  </View>
                  <View style={s.flex}>
                    <NumberField
                      label="Weight (kg)"
                      value={x?.weight}
                      allowEmpty
                      onValue={(w) => x && onChange(setTarget(t, seg.id, d.id, { value: x.value, unit: x.unit, weight: w }))}
                    />
                  </View>
                </View>
              );
            })
          ) : (
            <View style={s.row}>
              <View style={s.flex}>
                <NumberField
                  label={`Target (${unit})`}
                  value={same ? firstTarget?.value : undefined}
                  allowEmpty
                  onValue={(v) => onChange(v === undefined ? clearTargets(t, seg.id) : setTargetForAll(t, seg.id, { value: v, unit, weight: same ? firstTarget?.weight : undefined }))}
                />
              </View>
              <View style={s.flex}>
                <NumberField
                  label="Weight (kg)"
                  value={same ? firstTarget?.weight : undefined}
                  allowEmpty
                  onValue={(w) => firstTarget && onChange(setTargetForAll(t, seg.id, { value: firstTarget.value, unit, weight: w }))}
                />
              </View>
            </View>
          )}
          <Field
            label="Unit"
            value={unit}
            onChangeText={(u) => {
              let next = t;
              for (const d of t.divisions) {
                const x = targetFor(t, seg.id, d.id);
                if (x) next = setTarget(next, seg.id, d.id, { value: x.value, unit: u, weight: x.weight });
              }
              onChange(next);
            }}
            style={s.code}
          />
        </>
      ) : null}

      <View style={s.row}>
        <Btn label="Up" kind="plain" style={s.flex} disabled={first} onPress={() => onChange(moveSegment(t, seg.id, -1))} />
        <Btn label="Down" kind="plain" style={s.flex} disabled={last} onPress={() => onChange(moveSegment(t, seg.id, 1))} />
        <Btn label="Remove" kind="plain" style={s.flex} onPress={() => onChange(removeSegment(t, seg.id))} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 14 },
  h2: { fontSize: 22, fontWeight: '800', color: C.text, marginTop: 8 },
  muted: { fontSize: 15, fontWeight: '400', color: C.muted },
  card: { borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12, gap: 10 },
  runCard: { backgroundColor: C.panel },
  cardTitle: { fontSize: 19, fontWeight: '800', color: C.text },
  box: { borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  flex: { flex: 1 },
  code: { minWidth: 96, maxWidth: 120 },
  divCode: { width: 52, fontSize: 18, fontWeight: '800', color: C.text, paddingBottom: 14 },
});
