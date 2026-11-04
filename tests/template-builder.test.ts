import { describe, expect, it } from 'vitest';

import { buildSetupPayload, parseTeamList } from '@/core/race-setup';
import {
  addDivision,
  addRunsBeforeStations,
  addSegment,
  blankTemplate,
  cloneTemplate,
  moveSegment,
  removeDivision,
  removeSegment,
  setTarget,
  setTargetForAll,
  targetFor,
  targetsAreSame,
  tidyTemplate,
  updateDivision,
  validateTemplate,
} from '@/core/template-builder';
import { gobiTemplate } from '@/core/templates/gobi';
import { soloTemplate } from '@/core/templates/solo';

const STATIONS = ['Ski erg', 'Sled push', 'Sled pull', 'Burpee broad jumps', 'Rowing', 'Farmers carry', 'Sandbag lunges', 'Wall balls'];

describe('section 6B: race builder', () => {
  it('builds the Gobi format from scratch with the builder steps', () => {
    let t = blankTemplate('Gobi Hybrid Games rebuild');
    for (const [code, label, kind, size] of [
      ['T2M', 'Team of 2, men', 'team', 2],
      ['T2W', 'Team of 2, women', 'team', 2],
      ['T2X', 'Team of 2, mixed', 'team', 2],
      ['R4M', 'Relay of 4, men', 'relay', 4],
      ['R4W', 'Relay of 4, women', 'relay', 4],
      ['R4X', 'Relay of 4, mixed', 'relay', 4],
    ] as const) {
      t = addDivision(t, { code, label, entryKind: kind, teamSize: size });
    }
    for (const name of STATIONS) t = addSegment(t, { kind: 'station', name, metric: 'reps', timed: false, teamRule: 'split' });
    // One tap puts a 900 m run (3 laps of 300 m) before every station.
    t = addRunsBeforeStations(t, 'Run', 900);

    expect(validateTemplate(t)).toEqual([]);
    expect(t.segments.map((s) => s.kind)).toEqual(gobiTemplate.segments.map((s) => s.kind));
    expect(t.segments.filter((s) => s.kind === 'station').map((s) => s.name)).toEqual(STATIONS);
    expect(t.segments.filter((s) => s.kind === 'run').every((s) => targetsAreSame(t, s.id) && targetFor(t, s.id, 'T2M')?.value === 900)).toBe(true);
    expect(t.divisions.map((d) => d.code)).toEqual(gobiTemplate.divisions.map((d) => d.code));
    // Running it twice adds nothing, because every station already has a run.
    expect(addRunsBeforeStations(t, 'Run', 900).segments).toHaveLength(16);
  });

  it('builds a solo format with 16 parts and different weights for men and women', () => {
    let t = blankTemplate('Winter solo');
    for (const [code, label, g] of [
      ['W', 'Women', 'W'],
      ['M', 'Men', 'M'],
    ] as const) {
      t = addDivision(t, { code, label, gender: g, entryKind: 'solo', teamSize: 1 });
    }
    for (const name of STATIONS) t = addSegment(t, { kind: 'station', name, metric: 'distance', timed: false });
    t = addRunsBeforeStations(t, 'Run', 1000);
    const sled = t.segments.find((s) => s.name === 'Sled push')!;
    t = setTarget(t, sled.id, 'W', { value: 50, unit: 'm', weight: 102 });
    t = setTarget(t, sled.id, 'M', { value: 50, unit: 'm', weight: 152 });

    expect(t.segments).toHaveLength(16);
    expect(validateTemplate(t)).toEqual([]);
    expect(targetsAreSame(t, sled.id)).toBe(false);

    const { entries } = parseTeamList('1, Lize Botha, W\n2, Thabo Zulu, M', ['W', 'M']);
    const p = buildSetupPayload(t, { name: 'Winter solo', raceDate: '2026-07-04', venue: 'Gobi' }, entries, { lanes: 4, intervalMin: 2, firstStartAt: 0 });
    const sledOrder = sled.order;
    expect(p.targets.filter((x) => x.segmentOrder === sledOrder).map((x) => [x.divisionCode, x.weight])).toEqual([
      ['W', 102],
      ['M', 152],
    ]);
    expect(p.entries.every((e) => e.kind === 'solo')).toBe(true);
    expect(p.divisions.every((d) => d.teamSize === 1)).toBe(true);
  });

  it('keeps targets in step when a division code changes or a part is removed', () => {
    let t = cloneTemplate(soloTemplate, 'Copy');
    t = updateDivision(t, 'WO', { code: 'wopen' });
    expect(t.divisions.map((d) => d.code)).toContain('WOPEN');
    expect(t.targets.some((x) => x.divisionId === 'WO')).toBe(false);
    expect(t.targets.filter((x) => x.divisionId === 'WOPEN')).toHaveLength(16);

    const first = t.segments[0]!.id;
    t = removeSegment(t, first);
    expect(t.segments).toHaveLength(15);
    expect(t.segments[0]!.order).toBe(1);
    expect(t.targets.some((x) => x.segmentId === first)).toBe(false);

    t = removeDivision(t, 'MP');
    expect(t.targets.some((x) => x.divisionId === 'MP')).toBe(false);
  });

  it('moves parts up and down and keeps the order numbers tidy', () => {
    let t = cloneTemplate(gobiTemplate, 'Moved');
    const second = t.segments[1]!.id;
    t = moveSegment(t, second, -1);
    expect(t.segments[0]!.id).toBe(second);
    expect(t.segments.map((s) => s.order)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(moveSegment(t, second, -1)).toBe(t); // already first
  });

  it('names every problem in plain words', () => {
    let t = blankTemplate(' ');
    expect(validateTemplate(t)).toEqual(['Give the format a name.', 'Add at least one division.', 'Add at least one run or station.']);
    t = addDivision(blankTemplate('HYROX copy'), { code: 'T2M', label: 'Teams', entryKind: 'team', teamSize: 1 });
    t = addDivision(t, { code: 'T2M', label: '', entryKind: 'solo', teamSize: 2 });
    t = addSegment(t, { kind: 'station', name: 'Ski erg', metric: 'reps', timed: false });
    t = setTargetForAll(t, t.segments[0]!.id, { value: 0, unit: 'reps' });
    const errs = validateTemplate(t);
    expect(errs).toEqual(
      expect.arrayContaining([
        'The name can not use a protected race brand word.',
        'Division code T2M is used twice.',
        'Division T2M needs a name.',
        'Division T2M needs a team size from 2 to 20.',
        'Division T2M is solo, so the team size must be 1.',
        'Ski erg: the target for T2M must be more than 0.',
      ]),
    );
  });

  it('tidy drops targets that point nowhere', () => {
    const t = { ...gobiTemplate, targets: [...gobiTemplate.targets, { segmentId: 'gone', divisionId: 'T2M', value: 1, unit: 'm' }] };
    expect(tidyTemplate(t).targets).toHaveLength(gobiTemplate.targets.length);
  });

  it('both built in formats pass their own checks', () => {
    expect(validateTemplate(gobiTemplate)).toEqual([]);
    expect(validateTemplate(soloTemplate)).toEqual([]);
    expect(soloTemplate.segments).toHaveLength(16);
  });
});
