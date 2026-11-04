import { describe, expect, it } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';

import { readUpload } from '@/core/excel';
import { applyMapping, divisionValues, guessDivisionMap, guessMapping, parseCsv, teamSizeWarnings } from '@/core/import';
import { buildSetupPayload } from '@/core/race-setup';
import { gobiTemplate } from '@/core/templates/gobi';
import { soloTemplate } from '@/core/templates/solo';

const toArrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('CSV reading', () => {
  it('handles quotes, doubled quotes, CRLF, a byte order mark and semicolons', () => {
    const g = parseCsv('﻿No;Team;Division\r\n1;"Botha; Naidoo";T2M\r\n2;"The ""Fast"" Ones";T2W\r\n\r\n');
    expect(g).toEqual([
      ['No', 'Team', 'Division'],
      ['1', 'Botha; Naidoo', 'T2M'],
      ['2', 'The "Fast" Ones', 'T2W'],
    ]);
  });

  it('reads tabs and pads short rows', () => {
    expect(parseCsv('a\tb\tc\n1\t2')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
    ]);
  });
});

describe('section 6C: import 150 solo and 60 team entries without error', () => {
  it('150 solo athletes from a ticketing style export with first and last names', () => {
    const divs = ['Women Open', 'Women Pro', 'Men Open', 'Men Pro'];
    const rows = ['Bib,First Name,Last Name,Email,Ticket Type'];
    for (let i = 1; i <= 150; i++) rows.push(`${i},Name${i},Surname${i},a${i}@example.com,${divs[i % 4]}`);
    const grid = parseCsv(rows.join('\n'));
    const m = guessMapping(grid);
    expect(m).toMatchObject({ hasHeader: true, number: 0, first: 1, last: 2, division: 4 });
    const map = guessDivisionMap(divisionValues(grid, m), soloTemplate.divisions);
    expect(map).toEqual({ 'Men Open': 'MO', 'Men Pro': 'MP', 'Women Open': 'WO', 'Women Pro': 'WP' });
    const r = applyMapping(grid, m, map, soloTemplate.divisions);
    expect(r.errors).toEqual([]);
    expect(r.entries).toHaveLength(150);
    // Row i gets divs[i % 4], so athlete 1 is in Women Pro.
    expect(r.entries[0]).toEqual({ code: '1', displayName: 'Name1 Surname1', divisionCode: 'WP', members: ['Name1 Surname1'] });
    const p = buildSetupPayload(soloTemplate, { name: 'x', raceDate: '2026-12-01', venue: '' }, r.entries, { lanes: 8, intervalMin: 2, firstStartAt: 0 });
    expect(p.entries).toHaveLength(150);
    expect(p.entries.every((e) => e.kind === 'solo')).toBe(true);
  });

  it('60 teams with member columns, numbered for the organiser, from an Excel file', async () => {
    const header = ['Team name', 'Category', 'Athlete 1', 'Athlete 2', 'Athlete 3', 'Athlete 4'].map((value) => ({ value }));
    const cats = ['Pairs Men', 'Pairs Women', 'Pairs Mixed', 'Relay Men', 'Relay Women', 'Relay Mixed'];
    const data = [header];
    for (let i = 1; i <= 60; i++) {
      const relay = (i - 1) % 6 >= 3;
      const people = Array.from({ length: 4 }, (_, k) => (relay || k < 2 ? `Person ${i}.${k + 1}` : null));
      data.push([`Team ${i}`, cats[(i - 1) % 6], ...people].map((value) => ({ value: value as string })));
    }
    const buf = (await writeXlsxFile(data, { buffer: true })) as Buffer;
    const grid = await readUpload('entries.xlsx', toArrayBuffer(buf));
    const m = guessMapping(grid);
    expect(m).toMatchObject({ hasHeader: true, name: 0, division: 1, members: [2, 3, 4, 5] });
    expect(m.number).toBeUndefined();

    // The organiser matches their category names to the race divisions.
    const map = { 'Pairs Men': 'T2M', 'Pairs Women': 'T2W', 'Pairs Mixed': 'T2X', 'Relay Men': 'R4M', 'Relay Women': 'R4W', 'Relay Mixed': 'R4X' };
    const r = applyMapping(grid, m, map, gobiTemplate.divisions, { autoNumberFrom: 1 });
    expect(r.errors).toEqual([]);
    expect(r.entries).toHaveLength(60);
    expect(r.entries.map((e) => e.code)).toEqual(Array.from({ length: 60 }, (_, i) => String(i + 1)));
    expect(r.entries[3]).toMatchObject({ divisionCode: 'R4M', members: ['Person 4.1', 'Person 4.2', 'Person 4.3', 'Person 4.4'] });
    expect(teamSizeWarnings(r.entries, gobiTemplate.divisions)).toEqual([]);
  });

  it('reads race numbers stored as numbers in Excel', async () => {
    const data = [
      [{ value: 'Number' }, { value: 'Name' }, { value: 'Division' }],
      [{ value: 7 }, { value: 'Team Botha' }, { value: 'T2M' }],
    ];
    const buf = (await writeXlsxFile(data as never, { buffer: true })) as Buffer;
    const grid = await readUpload('x.xlsx', toArrayBuffer(buf));
    const m = guessMapping(grid);
    const r = applyMapping(grid, m, guessDivisionMap(divisionValues(grid, m), gobiTemplate.divisions), gobiTemplate.divisions);
    expect(r.entries).toEqual([{ code: '7', displayName: 'Team Botha', divisionCode: 'T2M', members: [] }]);
  });
});

describe('section 6C: reject duplicates and bad rows with a clear message', () => {
  const grid = parseCsv(
    ['Number,Team,Division', '1,Team Botha,T2M', '2,Team Naidoo,T2W', '1,Team Smit,T2M', '3,Team Botha,T2M', 'x4,Team Nel,T2X', '5,,T2X', '6,Team Zulu,Kids'].join('\n'),
  );
  const m = guessMapping(grid);
  const r = applyMapping(grid, m, guessDivisionMap(divisionValues(grid, m), gobiTemplate.divisions), gobiTemplate.divisions);

  it('keeps the good rows', () => {
    expect(r.entries.map((e) => e.code)).toEqual(['1', '2']);
  });

  it('names the spreadsheet row for every problem', () => {
    expect(r.errors).toEqual([
      'Row 4: number 1 is already used on row 2.',
      'Row 5: Team Botha is already in T2M on row 2.',
      'Row 6: "x4" is not a race number from 1 to 9999.',
      'Row 7: number 5 has no name.',
      'Row 8: "Kids" is not matched to a division.',
    ]);
  });

  it('asks for the missing columns before anything else', () => {
    const g = parseCsv('Email,Phone\na@b.c,1');
    const res = applyMapping(g, { hasHeader: true, members: [] }, {}, gobiTemplate.divisions);
    expect(res.errors).toEqual([
      'Choose the column with the race number, or number the entries for you.',
      'Choose the column with the name.',
      'Choose the division column, or put every entry in one division.',
    ]);
  });

  it('warns when a team has the wrong number of people', () => {
    const entries = [{ code: '1', displayName: 'A', divisionCode: 'T2M', members: ['x', 'y', 'z'] }];
    expect(teamSizeWarnings(entries, gobiTemplate.divisions)).toEqual(['1 T2M entry has a different number of people than 2.']);
  });

  it('refuses old .xls files with a plain message', async () => {
    await expect(readUpload('old.xls', new ArrayBuffer(4))).rejects.toThrow(/Save it as .xlsx or CSV/);
  });
});
