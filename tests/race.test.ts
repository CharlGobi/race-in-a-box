import { describe, expect, it } from 'vitest';

import { makeDemoEntries, makeDemoRace } from '@/core/demo';
import { buildHeats, findKitClashes } from '@/core/heats';
import { deriveResults, formatElapsed } from '@/core/results';
import { gobiTemplate } from '@/core/templates/gobi';

import { device, makeClock } from './helpers';

const T0 = Date.UTC(2026, 9, 31, 7, 0, 0);

describe('section 4: Gobi template', () => {
  it('has the six division codes, 8 stations and runs of 3 laps of 300 m', () => {
    expect(gobiTemplate.divisions.map((d) => d.code)).toEqual(['T2M', 'T2W', 'T2X', 'R4M', 'R4W', 'R4X']);
    expect(gobiTemplate.segments.filter((s) => s.kind === 'station')).toHaveLength(8);
    expect(gobiTemplate.segments.filter((s) => s.kind === 'run')).toHaveLength(8);
  });

  it('uses no protected brand words', () => {
    const text = JSON.stringify(gobiTemplate).toUpperCase();
    for (const word of ['HYROX', 'HRX']) expect(text).not.toContain(word);
    expect(/\bROX\b|\bHY\b/.test(text)).toBe(false);
  });
});

describe('section 6D: heats and clash warnings', () => {
  it('builds heats by division with at most 5 lanes', () => {
    const heats = buildHeats({ entries: makeDemoEntries(60), lanes: 5, intervalMin: 6, firstStartAt: T0, byDivision: true });
    expect(heats.flatMap((h) => h.slots)).toHaveLength(60);
    expect(Math.max(...heats.map((h) => h.slots.length))).toBeLessThanOrEqual(5);
  });

  it('Gobi settings flag a kit clash when the interval is too short', () => {
    const stations = gobiTemplate.segments.filter((s) => s.kind === 'station').map((s) => s.name);
    const tight = buildHeats({ entries: makeDemoEntries(60), lanes: 5, intervalMin: 3, firstStartAt: T0, byDivision: true });
    const roomy = buildHeats({ entries: makeDemoEntries(60), lanes: 5, intervalMin: 6, firstStartAt: T0, byDivision: true });
    expect(findKitClashes(tight, stations, 5).length).toBeGreaterThan(0);
    expect(findKitClashes(roomy, stations, 5)).toHaveLength(0);
  });
});

describe('results', () => {
  it('ranks within division, adds penalties and keeps DNF out of the ranking', () => {
    const race = makeDemoRace(T0);
    const heat = race.heats[0];
    const [a, b, c] = heat.slots.map((s) => s.entryId);
    const clock = makeClock(T0);
    const j = device(race.id, 'j', 'judge', clock.now);
    const log = [
      j.factory.make({ kind: 'start', heatId: heat.id }, undefined, T0),
      j.factory.make({ kind: 'finish' }, a, T0 + 50 * 60_000),
      j.factory.make({ kind: 'finish' }, b, T0 + 49 * 60_000),
      j.factory.make({ kind: 'penalty', seconds: 120, reason: 'short reps' }, b, T0 + 49 * 60_000 + 1),
      j.factory.make({ kind: 'status', status: 'DNF', reason: 'injury' }, c, T0 + 30 * 60_000),
    ];
    const rows = deriveResults(race, log).rows;
    const get = (id: string) => rows.find((r) => r.entry.id === id)!;
    expect(get(a).rank).toBe(1);
    expect(get(b).rank).toBe(2);
    expect(get(b).elapsedMs).toBe(51 * 60_000);
    expect(get(c).status).toBe('DNF');
    expect(get(c).rank).toBeUndefined();
  });

  it('formats times', () => {
    expect(formatElapsed(47 * 60_000 + 5000)).toBe('47:05');
    expect(formatElapsed(3600_000 + 61_000)).toBe('1:01:01');
  });
});
