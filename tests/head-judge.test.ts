import { describe, expect, it } from 'vitest';

import { makeDemoRace } from '@/core/demo';
import { deriveResults, deviceActivity, formatElapsed, parseElapsed } from '@/core/results';

import { device, makeClock } from './helpers';

const T0 = Date.UTC(2026, 10, 28, 6, 0, 0);
const MIN = 60_000;

function setup() {
  const race = { ...makeDemoRace(T0), protestWindowMin: 15 };
  const heat = race.heats[0]!;
  const ids = heat.slots.map((s) => s.entryId);
  const clock = makeClock(T0);
  const judge = device(race.id, 'judge', 'judge', clock.now);
  const head = device(race.id, 'head', 'head_judge', clock.now);
  return { race, heat, ids, judge, head };
}

/** Start heat 1 and finish every team in it, the last one at 55 minutes. */
function fullHeat({ heat, ids, judge }: ReturnType<typeof setup>) {
  return [
    judge.factory.make({ kind: 'start', heatId: heat.id }, undefined, T0),
    ...ids.map((id, i) => judge.factory.make({ kind: 'finish' }, id, T0 + (51 + i) * MIN)),
  ];
}

describe('section 6F: penalties, DNF, DNS and DSQ with a reason', () => {
  it('adds penalties to the time and lists each one with its reason', () => {
    const t = setup();
    const log = [
      ...fullHeat(t),
      t.head.factory.make({ kind: 'penalty', seconds: 30, reason: 'No rep, wall balls' }, t.ids[0], T0 + 56 * MIN),
      t.head.factory.make({ kind: 'penalty', seconds: 60, reason: 'Short sled push' }, t.ids[0], T0 + 56 * MIN + 1),
    ];
    const row = deriveResults(t.race, log, T0 + 57 * MIN).rows.find((r) => r.entry.id === t.ids[0])!;
    expect(row.elapsedMs).toBe(51 * MIN + 90_000);
    expect(row.penalties.map((p) => p.reason)).toEqual(['No rep, wall balls', 'Short sled push']);
  });

  it('a DSQ with a reason takes the entry out of the ranking, and undo brings it back', () => {
    const t = setup();
    const dsq = t.head.factory.make({ kind: 'status', status: 'DSQ', reason: 'Skipped a station' }, t.ids[1], T0 + 56 * MIN);
    const log = [...fullHeat(t), dsq];
    const row = deriveResults(t.race, log, T0 + 57 * MIN).rows.find((r) => r.entry.id === t.ids[1])!;
    expect(row).toMatchObject({ status: 'DSQ', statusReason: 'Skipped a station', rank: undefined });
    const back = deriveResults(t.race, [...log, t.head.factory.make({ kind: 'undo', targetId: dsq.id }, t.ids[1], T0 + 58 * MIN)], T0 + 59 * MIN);
    expect(back.rows.find((r) => r.entry.id === t.ids[1])!.status).toBe('finished');
  });
});

describe('section 6F: protest window', () => {
  it('locks a heat 15 minutes after its last result', () => {
    const t = setup();
    const log = fullHeat(t); // last finish at 55 minutes
    const at = (m: number) => deriveResults(t.race, log, T0 + m * MIN).heats[0]!;
    expect(at(60)).toMatchObject({ completeAt: T0 + 55 * MIN, lockAt: T0 + 70 * MIN, locked: false });
    expect(at(70).locked).toBe(true);
    // A heat with a team still racing never locks on its own.
    expect(deriveResults(t.race, log.slice(0, -1), T0 + 200 * MIN).heats[0]!.lockAt).toBeUndefined();
  });

  it('ignores a judge change after the lock, keeps it in the log, and flags it', () => {
    const t = setup();
    const late = t.judge.factory.make({ kind: 'penalty', seconds: 60, reason: 'late protest' }, t.ids[0], T0 + 80 * MIN);
    const res = deriveResults(t.race, [...fullHeat(t), late], T0 + 81 * MIN);
    expect(res.rows.find((r) => r.entry.id === t.ids[0])!.penaltyMs).toBe(0);
    expect(res.flags).toContainEqual({ kind: 'after_lock', entryId: t.ids[0], eventId: late.id });
  });

  it('the head judge can still change a locked result', () => {
    const t = setup();
    const res = deriveResults(t.race, [...fullHeat(t), t.head.factory.make({ kind: 'penalty', seconds: 60, reason: 'protest upheld' }, t.ids[0], T0 + 80 * MIN)], T0 + 81 * MIN);
    expect(res.rows.find((r) => r.entry.id === t.ids[0])!.penaltyMs).toBe(60_000);
  });

  it('the head judge can lock a heat at once, and a judge lock does not count', () => {
    const t = setup();
    const log = [...fullHeat(t).slice(0, 2), t.judge.factory.make({ kind: 'lock', heatId: t.heat.id }, undefined, T0 + 52 * MIN)];
    expect(deriveResults(t.race, log, T0 + 53 * MIN).heats[0]!.locked).toBe(false);
    log.push(t.head.factory.make({ kind: 'lock', heatId: t.heat.id }, undefined, T0 + 52 * MIN));
    expect(deriveResults(t.race, log, T0 + 53 * MIN).heats[0]!.locked).toBe(true);
  });
});

describe('section 6F: one tap delay for all later heats', () => {
  it('moves every heat that has not started, and not the ones already going', () => {
    const t = setup();
    const [h1, h2, h3] = t.race.heats;
    const log = [
      t.judge.factory.make({ kind: 'start', heatId: h1!.id }, undefined, h1!.startAt),
      t.head.factory.make({ kind: 'delay', minutes: 5, reason: 'Sled reset' }, undefined, h1!.startAt + MIN),
      t.head.factory.make({ kind: 'delay', minutes: 2, reason: 'Kit check' }, undefined, h1!.startAt + 2 * MIN),
    ];
    const heats = deriveResults(t.race, log, h1!.startAt + 3 * MIN).heats;
    expect(heats[0]!.plannedStartAt).toBe(h1!.startAt);
    expect(heats[1]!.plannedStartAt).toBe(h2!.startAt + 7 * MIN);
    expect(heats[2]!.plannedStartAt).toBe(h3!.startAt + 7 * MIN);
  });

  it('only the head judge can delay heats', () => {
    const t = setup();
    const log = [t.judge.factory.make({ kind: 'delay', minutes: 5, reason: 'x' }, undefined, T0)];
    expect(deriveResults(t.race, log, T0).heats[1]!.plannedStartAt).toBe(t.race.heats[1]!.startAt);
  });
});

describe('section 6F and 11: two phones disagree, the head judge settles it', () => {
  it('a head judge correction clears the flag and sets the time', () => {
    const t = setup();
    const other = device(t.race.id, 'judge2', 'judge', () => T0);
    const log = [
      t.judge.factory.make({ kind: 'start', heatId: t.heat.id }, undefined, T0),
      t.judge.factory.make({ kind: 'finish' }, t.ids[0], T0 + 50 * MIN),
      other.factory.make({ kind: 'finish' }, t.ids[0], T0 + 50 * MIN + 9000),
    ];
    expect(deriveResults(t.race, log, T0 + 51 * MIN).flags.some((f) => f.kind === 'devices_disagree')).toBe(true);
    log.push(t.head.factory.make({ kind: 'edit', field: 'finish', at: T0 + 50 * MIN + 9000, reason: 'Used phone 2' }, t.ids[0], T0 + 52 * MIN));
    const res = deriveResults(t.race, log, T0 + 53 * MIN);
    expect(res.flags.some((f) => f.kind === 'devices_disagree')).toBe(false);
    expect(res.rows.find((r) => r.entry.id === t.ids[0])!.elapsedMs).toBe(50 * MIN + 9000);
  });
});

describe('head judge takeover', () => {
  it('shows which phones were last heard from, so a silent main phone stands out', () => {
    const t = setup();
    const log = fullHeat(t).map((e, i) => (i < 3 ? { ...e, serverTs: e.deviceTs + 1000 } : e));
    log.push(t.head.factory.make({ kind: 'finish' }, t.race.heats[1]!.slots[0]!.entryId, T0 + 70 * MIN));
    const d = deviceActivity(log);
    expect(d[0]).toMatchObject({ deviceId: 'head', role: 'head_judge', count: 1 });
    expect(d[0]!.lastSentAt).toBeUndefined(); // the head judge's tap has not been sent yet
    expect(d[1]).toMatchObject({ deviceId: 'judge', count: 6, lastAt: T0 + 55 * MIN, lastSentAt: T0 + 52 * MIN + 1000 });
  });
});

describe('time entry', () => {
  it('reads mm:ss and h:mm:ss and refuses anything else', () => {
    expect(parseElapsed('47:05')).toBe(47 * MIN + 5000);
    expect(parseElapsed('1:02:03')).toBe(3723_000);
    expect(formatElapsed(parseElapsed('1:02:03'))).toBe('1:02:03');
    for (const bad of ['47', '47:5x', '60:00:61', '1:2:3:4', '']) expect(parseElapsed(bad)).toBeUndefined();
  });
});
