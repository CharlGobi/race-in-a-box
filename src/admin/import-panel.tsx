import * as DocumentPicker from 'expo-document-picker';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { readUpload } from '@/core/excel';
import { applyMapping, divisionValues, guessDivisionMap, guessMapping, teamSizeWarnings } from '@/core/import';
import type { Grid, ImportedEntry, Mapping } from '@/core/import';
import type { Division } from '@/core/types';
import { Btn, C, Choice, MultiChoice, Notice, P } from '@/ui/kit';

const NONE = '-';

function colName(grid: Grid, m: Mapping, i: number): string {
  const letter = i < 26 ? String.fromCharCode(65 + i) : `C${i + 1}`;
  const head = m.hasHeader ? grid[0]?.[i] : grid[0]?.[i];
  return head ? `${letter}: ${head.slice(0, 18)}` : letter;
}

async function pickFile(): Promise<{ name: string; data: ArrayBuffer } | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const data = a.file ? await a.file.arrayBuffer() : await (await fetch(a.uri)).arrayBuffer();
  return { name: a.name, data };
}

/** Upload a CSV or Excel file and turn it into entries. */
export function ImportPanel({ divisions, onUse }: { divisions: Division[]; onUse: (entries: ImportedEntry[], fileName: string) => void }) {
  const [file, setFile] = useState<{ name: string; grid: Grid } | null>(null);
  const [m, setM] = useState<Mapping | null>(null);
  const [divMap, setDivMap] = useState<Record<string, string>>({});
  const [autoNumber, setAutoNumber] = useState(false);
  const [single, setSingle] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    try {
      const picked = await pickFile();
      if (!picked) return;
      const grid = await readUpload(picked.name, picked.data);
      if (grid.length === 0) throw new Error('That file is empty.');
      const guess = guessMapping(grid);
      setFile({ name: picked.name, grid });
      setM(guess);
      setAutoNumber(guess.number === undefined);
      setSingle(guess.division === undefined && divisions.length === 1 ? divisions[0]!.code : undefined);
      setDivMap(guessDivisionMap(divisionValues(grid, guess), divisions));
    } catch (e) {
      setError((e as Error).message || 'That file could not be read. Try saving it as CSV.');
    }
  };

  const result = useMemo(
    () => (file && m ? applyMapping(file.grid, m, divMap, divisions, { autoNumberFrom: autoNumber ? 1 : undefined, singleDivision: single }) : null),
    [file, m, divMap, divisions, autoNumber, single],
  );

  if (!file || !m || !result) {
    return (
      <View style={s.box}>
        <Btn label="Upload a CSV or Excel file" kind="plain" onPress={choose} />
        <P muted>From Entry Ninja, a sign up form or your own spreadsheet. One row per entry.</P>
        {error ? <Notice>{error}</Notice> : null}
      </View>
    );
  }

  const width = file.grid[0]?.length ?? 0;
  const cols = Array.from({ length: width }, (_, i) => ({ value: String(i), label: colName(file.grid, m, i) }));
  const pick = (key: 'number' | 'name' | 'first' | 'last' | 'division', label: string, extra: { value: string; label: string }[] = []) => (
    <Choice
      label={label}
      options={[...extra, { value: NONE, label: 'Not in file' }, ...cols]}
      value={key === 'number' && autoNumber ? 'auto' : key === 'division' && single ? 'one' : m[key] === undefined ? NONE : String(m[key])}
      onChange={(v) => {
        if (key === 'number') setAutoNumber(v === 'auto');
        if (key === 'division') setSingle(v === 'one' ? divisions[0]?.code : undefined);
        if (v === 'auto' || v === 'one') return;
        const next = { ...m, [key]: v === NONE ? undefined : Number(v) };
        setM(next);
        if (key === 'division') setDivMap(guessDivisionMap(divisionValues(file.grid, next), divisions));
      }}
    />
  );
  const values = single ? [] : divisionValues(file.grid, m);
  const warnings = teamSizeWarnings(result.entries, divisions);

  return (
    <View style={s.box}>
      <Text style={s.title}>{file.name}</Text>
      <Text style={s.sub}>{file.grid.length - (m.hasHeader ? 1 : 0)} rows. Check which column is which.</Text>
      <Choice
        label="First row is"
        options={[
          { value: 'head', label: 'Headings' },
          { value: 'data', label: 'An entry' },
        ]}
        value={m.hasHeader ? 'head' : 'data'}
        onChange={(v) => setM({ ...m, hasHeader: v === 'head' })}
      />
      {pick('number', 'Race number', [{ value: 'auto', label: 'Number them for me' }])}
      {pick('name', 'Entry name')}
      {m.name === undefined ? (
        <>
          {pick('first', 'First name')}
          {pick('last', 'Last name')}
        </>
      ) : null}
      {pick('division', 'Division', divisions.length ? [{ value: 'one', label: `All in ${divisions[0]!.code}` }] : [])}
      {single ? (
        <Choice label="Put every entry in" options={divisions.map((d) => ({ value: d.code, label: d.code }))} value={single} onChange={setSingle} />
      ) : null}

      <MultiChoice
        label="Athlete columns"
        options={cols}
        values={m.members.map(String)}
        onToggle={(v) => {
          const n = Number(v);
          setM({ ...m, members: m.members.includes(n) ? m.members.filter((x) => x !== n) : [...m.members, n].sort((x, y) => x - y) });
        }}
      />

      {values.length ? (
        <View style={s.field}>
          <Text style={s.label}>Match divisions</Text>
          {values.map((v) => (
            <Choice
              key={v}
              label={`"${v}" is`}
              options={divisions.map((d) => ({ value: d.code, label: d.code }))}
              value={divMap[v]}
              onChange={(code) => setDivMap({ ...divMap, [v]: code })}
            />
          ))}
        </View>
      ) : null}

      {result.entries.length ? (
        <View style={s.preview}>
          <Text style={s.label}>{result.entries.length} ready. First few:</Text>
          {result.entries.slice(0, 4).map((e) => (
            <Text key={e.code} style={s.row}>
              {e.code}. {e.displayName}, {e.divisionCode}
              {e.members.length && e.members[0] !== e.displayName ? ` (${e.members.join(', ')})` : ''}
            </Text>
          ))}
        </View>
      ) : null}
      {result.errors.length ? (
        <Notice>
          {result.errors.length} row{result.errors.length > 1 ? 's' : ''} will not import:{'\n'}
          {result.errors.slice(0, 8).join('\n')}
          {result.errors.length > 8 ? `\nand ${result.errors.length - 8} more` : ''}
        </Notice>
      ) : null}
      {warnings.length ? <Notice>{warnings.join(' ')}</Notice> : null}

      <Btn
        label={`Use these ${result.entries.length} entries`}
        disabled={result.entries.length === 0 || result.errors.length > 0}
        onPress={() => onUse(result.entries, file.name)}
      />
      <Btn label="Choose another file" kind="plain" onPress={choose} />
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 2, borderColor: C.line, borderRadius: 8, padding: 12, gap: 12 },
  title: { fontSize: 19, fontWeight: '800', color: C.text },
  sub: { fontSize: 16, color: C.muted },
  field: { gap: 8 },
  label: { fontSize: 18, fontWeight: '800', color: C.text },
  preview: { gap: 4 },
  row: { fontSize: 16, color: C.text },
});
