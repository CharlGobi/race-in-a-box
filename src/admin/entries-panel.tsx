import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Race } from '@/core/types';
import { Btn, C, Choice, Field, Notice, P } from '@/ui/kit';

import { adminRpc } from './client';
import type { AdminError } from './client';

type Props = {
  race: Race;
  members: Record<string, string[]>;
  timedEntryIds: Set<string>;
  canEdit: boolean;
  onChange: () => void;
};

type Draft = { code: string; name: string; division: string; members: string; heat: string };

const splitMembers = (text: string) =>
  text
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Entries on the organiser's race page: find, edit, swap an athlete, move division, add, remove. */
export function EntriesPanel({ race, members, timedEntryIds, canEdit, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const heatOf = new Map<string, number>();
  for (const h of race.heats) for (const sl of h.slots) heatOf.set(sl.entryId, h.number);
  const divCode = new Map(race.template.divisions.map((d) => [d.id, d.code]));
  const q = query.trim().toLowerCase();
  const shown = race.entries.filter(
    (e) => !q || e.code === q || e.displayName.toLowerCase().includes(q) || (members[e.id] ?? []).some((m) => m.toLowerCase().includes(q)),
  );

  const startEdit = (id: string) => {
    const e = race.entries.find((x) => x.id === id)!;
    setOpen(id);
    setError(null);
    setDraft({ code: e.code, name: e.displayName, division: divCode.get(e.divisionId) ?? '', members: (members[id] ?? []).join('\n'), heat: '' });
  };
  const startAdd = () => {
    const used = new Set(race.entries.map((e) => Number(e.code)));
    let n = 1;
    while (used.has(n)) n++;
    setOpen('new');
    setError(null);
    setDraft({ code: String(n), name: '', division: race.template.divisions[0]?.code ?? '', members: '', heat: '' });
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setOpen(null);
      setDraft(null);
      onChange();
    } catch (e) {
      setError((e as AdminError).message);
    }
    setBusy(false);
  };

  const form = (id: string) =>
    draft ? (
      <View style={s.form}>
        <View style={s.row}>
          <Field label="Number" value={draft.code} inputMode="numeric" keyboardType="number-pad" onChangeText={(code) => setDraft({ ...draft, code })} style={s.small} />
          <View style={s.flex}>
            <Field label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
          </View>
        </View>
        <Choice label="Division" options={race.template.divisions.map((d) => ({ value: d.code, label: d.code }))} value={draft.division} onChange={(division) => setDraft({ ...draft, division })} />
        {id !== 'new' && draft.division !== divCode.get(race.entries.find((e) => e.id === id)?.divisionId ?? '') && heatOf.has(id) ? (
          <P muted>It stays in heat {heatOf.get(id)}. Check the heat still works.</P>
        ) : null}
        <Field label="Athletes, one per line" value={draft.members} multiline onChangeText={(m) => setDraft({ ...draft, members: m })} style={s.members} />
        {id === 'new' ? (
          <Field label="Heat number (leave empty for none)" value={draft.heat} inputMode="numeric" keyboardType="number-pad" onChangeText={(heat) => setDraft({ ...draft, heat })} />
        ) : null}
        {error ? <Notice>{error}</Notice> : null}
        <Btn
          label={busy ? 'Saving' : id === 'new' ? 'Add entry' : 'Save changes'}
          disabled={busy || !draft.name.trim() || !/^\d{1,4}$/.test(draft.code)}
          onPress={() =>
            run(() =>
              id === 'new'
                ? adminRpc('add_entry', {
                    p_race: race.id,
                    p_code: draft.code,
                    p_name: draft.name,
                    p_division: draft.division,
                    p_members: splitMembers(draft.members),
                    p_heat: draft.heat ? Number(draft.heat) : null,
                  })
                : adminRpc('update_entry', { p_entry: id, p_code: draft.code, p_name: draft.name, p_division: draft.division, p_members: splitMembers(draft.members) }),
            )
          }
        />
        {id !== 'new' && !timedEntryIds.has(id) ? (
          <Btn label="Remove this entry" kind="stop" disabled={busy} onPress={() => run(() => adminRpc('remove_entry', { p_entry: id }))} />
        ) : null}
        {id !== 'new' && timedEntryIds.has(id) ? <P muted>This entry has times, so it can not be removed. The head judge can mark it DNS or DNF.</P> : null}
        <Btn
          label="Cancel"
          kind="plain"
          onPress={() => {
            setOpen(null);
            setDraft(null);
          }}
        />
      </View>
    ) : null;

  return (
    <View style={s.wrap}>
      <Text style={s.h2}>Entries ({race.entries.length})</Text>
      <Field label="Find by number or name" value={query} onChangeText={setQuery} autoCapitalize="none" />
      {canEdit && open !== 'new' ? <Btn label="Add a late entry" kind="plain" onPress={startAdd} /> : null}
      {open === 'new' ? form('new') : null}
      {shown.slice(0, 60).map((e) => (
        <View key={e.id} style={s.entry}>
          <View style={s.row}>
            <Text style={s.code}>{e.code}</Text>
            <View style={s.flex}>
              <Text style={s.name}>{e.displayName}</Text>
              <Text style={s.sub}>
                {divCode.get(e.divisionId)}
                {heatOf.has(e.id) ? `, heat ${heatOf.get(e.id)}` : ', no heat'}
                {(members[e.id] ?? []).length && members[e.id]![0] !== e.displayName ? `. ${members[e.id]!.join(', ')}` : ''}
              </Text>
            </View>
            {canEdit && open !== e.id ? <Btn label="Edit" kind="plain" style={s.edit} onPress={() => startEdit(e.id)} /> : null}
          </View>
          {open === e.id ? form(e.id) : null}
        </View>
      ))}
      {shown.length > 60 ? <P muted>Showing 60 of {shown.length}. Search to find the rest.</P> : null}
      {shown.length === 0 ? <P muted>No entry matches.</P> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  h2: { fontSize: 20, fontWeight: '800', color: C.text, marginTop: 6 },
  entry: { borderBottomWidth: 1, borderColor: C.line, paddingVertical: 8, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  code: { width: 48, fontSize: 20, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  name: { fontSize: 18, fontWeight: '800', color: C.text },
  sub: { fontSize: 15, color: C.muted },
  edit: { minWidth: 88 },
  form: { gap: 10, borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12 },
  small: { minWidth: 100, maxWidth: 120 },
  members: { minHeight: 100 },
});
