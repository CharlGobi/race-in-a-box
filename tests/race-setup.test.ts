import { describe, expect, it } from 'vitest';

import { buildSetupPayload, parseTeamList } from '@/core/race-setup';
import { gobiTemplate } from '@/core/templates/gobi';

const CODES = gobiTemplate.divisions.map((d) => d.code);

describe('section 6C: team list paste', () => {
  it('reads commas, tabs and semicolons and skips a header row', () => {
    const r = parseTeamList('Number,Team,Division\n1, Team Botha, T2M\n2\tTeam Naidoo\tt2w\n3; Team Smit; R4X\n', CODES);
    expect(r.errors).toEqual([]);
    expect(r.entries).toEqual([
      { code: '1', displayName: 'Team Botha', divisionCode: 'T2M' },
      { code: '2', displayName: 'Team Naidoo', divisionCode: 'T2W' },
      { code: '3', displayName: 'Team Smit', divisionCode: 'R4X' },
    ]);
  });

  it('keeps commas inside a team name', () => {
    const r = parseTeamList('7, Botha, Naidoo and Co, T2X', CODES);
    expect(r.entries[0]).toEqual({ code: '7', displayName: 'Botha, Naidoo and Co', divisionCode: 'T2X' });
  });

  it('rejects duplicates with a clear message', () => {
    const r = parseTeamList('1, A, T2M\n2, B, T2M\n1, C, T2W', CODES);
    expect(r.entries).toHaveLength(2);
    expect(r.errors).toEqual(['Line 3: number 1 is already used on line 1.']);
  });

  it('explains every other bad line', () => {
    const r = parseTeamList('1, A, T2M\nx1, B, T2M\n3, C, XYZ\n4, D\n5, , T2M', CODES);
    expect(r.errors).toHaveLength(4);
    expect(r.errors[0]).toMatch(/not a number/);
    expect(r.errors[1]).toMatch(/not a division.*T2M/);
    expect(r.errors[2]).toMatch(/needs number, name and division/);
    expect(r.errors[3]).toMatch(/no name/);
  });

  it('takes 60 teams without error', () => {
    const text = Array.from({ length: 60 }, (_, i) => `${i + 1}, Team ${i + 1}, ${CODES[i % CODES.length]}`).join('\n');
    const r = parseTeamList(text, CODES);
    expect(r.errors).toEqual([]);
    expect(r.entries).toHaveLength(60);
  });
});

describe('race setup payload', () => {
  it('builds heats by division with the lane count, and every team lands in exactly one heat', () => {
    const text = Array.from({ length: 60 }, (_, i) => `${i + 1}, Team ${i + 1}, ${CODES[i % CODES.length]}`).join('\n');
    const { entries } = parseTeamList(text, CODES);
    const p = buildSetupPayload(gobiTemplate, { name: 'Gobi Summer Sim', raceDate: '2026-11-28', venue: 'Gobi' }, entries, { lanes: 5, intervalMin: 6, firstStartAt: 0 });
    const slotted = p.heats.flatMap((h) => h.slots.map((s) => s.entryCode));
    expect(new Set(slotted).size).toBe(60);
    expect(slotted).toHaveLength(60);
    expect(Math.max(...p.heats.map((h) => h.slots.length))).toBeLessThanOrEqual(5);
    expect(p.heats[1]!.startAt - p.heats[0]!.startAt).toBe(6 * 60_000);
    // A heat never mixes divisions.
    const divOf = new Map(p.entries.map((e) => [e.code, e.divisionCode]));
    for (const h of p.heats) expect(new Set(h.slots.map((s) => divOf.get(s.entryCode))).size).toBe(1);
    expect(p.divisions).toHaveLength(6);
    expect(p.segments).toHaveLength(16);
  });
});
