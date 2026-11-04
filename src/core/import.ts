import type { TeamLine } from './race-setup';
import type { Division } from './types';

// Entries from a spreadsheet (PRD 6C). The organiser uploads a CSV or Excel file,
// checks which column is which, matches their division names to the race's
// divisions, and gets a clear message for every row that will not import.

export type Grid = string[][];

export type ImportedEntry = TeamLine & { members: string[] };

export type Mapping = {
  hasHeader: boolean;
  number?: number;
  name?: number;
  first?: number;
  last?: number;
  division?: number;
  members: number[];
};

// CSV ------------------------------------------------------------------------

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of [',', ';', '\t']) {
    let n = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) n++;
    }
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** RFC 4180 style CSV with quotes, doubled quotes, CRLF, a byte order mark, and comma, semicolon or tab. */
export function parseCsv(input: string): Grid {
  const text = input.replace(/^﻿/, '');
  const d = detectDelimiter(text);
  const rows: Grid = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return tidyGrid(rows);
}

/** Trim every cell, turn numbers and dates into text, drop empty rows, square the grid. */
export function tidyGrid(rows: unknown[][]): Grid {
  const out = rows
    .map((r) =>
      r.map((c) => {
        if (c === null || c === undefined) return '';
        if (c instanceof Date) return c.toISOString().slice(0, 10);
        if (typeof c === 'number') return Number.isInteger(c) ? String(c) : String(c);
        return String(c).trim();
      }),
    )
    .filter((r) => r.some((c) => c !== ''));
  const width = Math.max(0, ...out.map((r) => r.length));
  return out.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
}

// Guessing columns ---------------------------------------------------------------

const HEAD = {
  number: /^(#|no\.?|nr\.?|num|number|bib|bib ?(no|number)|race ?(no|number)|team ?(no|number)|athlete ?(no|number))$/i,
  name: /^(name|team|team ?name|athlete|athlete ?name|full ?name|entry|entry ?name)$/i,
  first: /^(first ?name|given ?name|name ?first|voornaam)$/i,
  last: /^(last ?name|surname|family ?name|van)$/i,
  division: /^(division|div|category|cat|class|wave|race|event|ticket|ticket ?type)$/i,
  member: /(member|partner|team ?mate|athlete ?\d|name ?\d|person ?\d|participant ?\d)/i,
};

export function guessMapping(grid: Grid): Mapping {
  const header = grid[0] ?? [];
  const hits = header.map((h) => Object.entries(HEAD).find(([, re]) => re.test(h.trim()))?.[0]);
  const hasHeader = hits.some(Boolean) && !header.every((h) => /^\d+$/.test(h));
  const m: Mapping = { hasHeader, members: [] };
  if (hasHeader) {
    hits.forEach((k, i) => {
      if (k === 'member') m.members.push(i);
      else if (k && (m as Record<string, unknown>)[k] === undefined) (m as Record<string, unknown>)[k] = i;
    });
  } else {
    // No header: number, name, division is the common shape.
    const sample = grid.slice(0, 20);
    const numeric = (i: number) => sample.every((r) => /^\d{1,4}$/.test(r[i] ?? ''));
    if (header.length >= 1 && numeric(0)) m.number = 0;
    if (header.length >= 2) m.name = m.number === 0 ? 1 : 0;
    if (header.length >= 3) m.division = header.length - 1;
  }
  return m;
}

export function dataRows(grid: Grid, m: Mapping): { row: string[]; rowNo: number }[] {
  return grid.slice(m.hasHeader ? 1 : 0).map((row, i) => ({ row, rowNo: i + (m.hasHeader ? 2 : 1) }));
}

// Divisions --------------------------------------------------------------------

export function divisionValues(grid: Grid, m: Mapping): string[] {
  if (m.division === undefined) return [];
  return [...new Set(dataRows(grid, m).map(({ row }) => row[m.division!] ?? '').filter(Boolean))].sort();
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Match each value in the file to a division by code or name. Leaves the rest for the organiser. */
export function guessDivisionMap(values: string[], divisions: Division[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of values) {
    const n = norm(v);
    const hit =
      divisions.find((d) => norm(d.code) === n) ??
      divisions.find((d) => norm(d.label) === n) ??
      divisions.find((d) => n.length > 2 && (norm(d.label).includes(n) || n.includes(norm(d.label))));
    if (hit) out[v] = hit.code;
  }
  return out;
}

// Building entries -------------------------------------------------------------

export type ApplyOptions = { autoNumberFrom?: number; singleDivision?: string };

export function applyMapping(
  grid: Grid,
  m: Mapping,
  divisionMap: Record<string, string>,
  divisions: Division[],
  opts: ApplyOptions = {},
): { entries: ImportedEntry[]; errors: string[] } {
  const entries: ImportedEntry[] = [];
  const errors: string[] = [];
  const byNumber = new Map<string, number>();
  const byName = new Map<string, number>();
  const codes = new Set(divisions.map((d) => d.code));
  let next = opts.autoNumberFrom ?? 1;

  if (opts.autoNumberFrom === undefined && m.number === undefined) errors.push('Choose the column with the race number, or number the entries for you.');
  if (m.name === undefined && m.first === undefined && m.members.length === 0) errors.push('Choose the column with the name.');
  if (m.division === undefined && !opts.singleDivision) errors.push('Choose the division column, or put every entry in one division.');
  if (errors.length) return { entries, errors };

  for (const { row, rowNo } of dataRows(grid, m)) {
    const cell = (i: number | undefined) => (i === undefined ? '' : (row[i] ?? '').trim());
    const members = m.members.map(cell).filter(Boolean);
    const person = [cell(m.first), cell(m.last)].filter(Boolean).join(' ');
    const displayName = cell(m.name) || person || members.join(' and ');

    let code: string;
    if (opts.autoNumberFrom !== undefined) {
      code = String(next);
    } else {
      code = cell(m.number).replace(/^#/, '');
      if (!/^\d{1,4}$/.test(code)) {
        errors.push(`Row ${rowNo}: "${cell(m.number)}" is not a race number from 1 to 9999.`);
        continue;
      }
      code = String(Number(code));
    }

    const rawDiv = opts.singleDivision ?? cell(m.division);
    const divisionCode = opts.singleDivision ?? divisionMap[rawDiv];
    if (!displayName) {
      errors.push(`Row ${rowNo}: number ${code} has no name.`);
      continue;
    }
    if (!divisionCode || !codes.has(divisionCode)) {
      errors.push(rawDiv ? `Row ${rowNo}: "${rawDiv}" is not matched to a division.` : `Row ${rowNo}: ${displayName} has no division.`);
      continue;
    }
    const seenNo = byNumber.get(code);
    if (seenNo !== undefined) {
      errors.push(`Row ${rowNo}: number ${code} is already used on row ${seenNo}.`);
      continue;
    }
    const nameKey = `${divisionCode}|${norm(displayName)}`;
    const seenName = byName.get(nameKey);
    if (seenName !== undefined) {
      errors.push(`Row ${rowNo}: ${displayName} is already in ${divisionCode} on row ${seenName}.`);
      continue;
    }
    byNumber.set(code, rowNo);
    byName.set(nameKey, rowNo);
    if (opts.autoNumberFrom !== undefined) next++;

    const div = divisions.find((d) => d.code === divisionCode)!;
    const people = members.length ? members : div.entryKind === 'solo' && person ? [person] : div.entryKind === 'solo' ? [displayName] : [];
    entries.push({ code, displayName, divisionCode, members: people });
  }

  return { entries, errors };
}

/** A sentence per division and team size problem, for the summary under the upload. */
export function teamSizeWarnings(entries: ImportedEntry[], divisions: Division[]): string[] {
  const out: string[] = [];
  for (const d of divisions) {
    if (d.entryKind === 'solo') continue;
    const wrong = entries.filter((e) => e.divisionCode === d.code && e.members.length > 0 && e.members.length !== d.teamSize);
    if (wrong.length) out.push(`${wrong.length} ${d.code} entr${wrong.length > 1 ? 'ies have' : 'y has'} a different number of people than ${d.teamSize}.`);
  }
  return out;
}
