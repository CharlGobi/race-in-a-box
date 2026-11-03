import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { makeDemoRace } from '@/core/demo';
import { mergeLogs } from '@/core/log';
import { deriveResults } from '@/core/results';
import { MemoryStore } from '@/core/store';
import { IndexedDbStore } from '@/core/store-idb';
import { FakeServer, syncOnce } from '@/core/sync';

import { device, makeClock } from './helpers';

const T0 = Date.UTC(2026, 9, 31, 7, 0, 0);

describe('section 7: offline and sync rules', () => {
  it('every write has a unique id, the device id and a rising sequence number', () => {
    const clock = makeClock(T0);
    const d = device('r1', 'phoneA', 'judge', clock.now);
    const a = d.factory.make({ kind: 'finish' }, 'e1');
    const b = d.factory.make({ kind: 'finish' }, 'e2');
    expect(a.id).not.toBe(b.id);
    expect(a.deviceId).toBe('phoneA');
    expect(b.seq).toBe(a.seq + 1);
  });

  it('merge by id ignores duplicates', () => {
    const clock = makeClock(T0);
    const d = device('r1', 'phoneA', 'judge', clock.now);
    const a = d.factory.make({ kind: 'finish' }, 'e1');
    const merged = mergeLogs([a], [a, { ...a }], [a]);
    expect(merged).toHaveLength(1);
  });

  it('a device sending the same events twice does not duplicate them on the server', async () => {
    const clock = makeClock(T0);
    const server = new FakeServer(clock.now);
    const d = device('r1', 'phoneA', 'judge', clock.now);
    await d.store.put([d.factory.make({ kind: 'finish' }, 'e1')]);
    const pendingBefore = await d.store.pending('r1');
    await server.transport().push(pendingBefore);
    await server.transport().push(pendingBefore);
    expect(server.events()).toHaveLength(1);
  });

  it('shows saved on phone while offline and sent after reconnecting', async () => {
    const clock = makeClock(T0);
    const server = new FakeServer(clock.now);
    server.online = false;
    const d = device('r1', 'phoneA', 'judge', clock.now);
    await d.store.put([d.factory.make({ kind: 'finish' }, 'e1')]);
    let state = await syncOnce(d.store, server.transport(), 'r1');
    expect(state).toMatchObject({ savedOnPhone: 1, waitingToSend: 1, online: false });
    server.online = true;
    state = await syncOnce(d.store, server.transport(), 'r1');
    expect(state).toMatchObject({ savedOnPhone: 1, waitingToSend: 0, online: true });
  });

  it('head judge wins over judge on the same field, and both versions stay in the log', () => {
    const race = makeDemoRace(T0);
    const heat = race.heats[0];
    const entryId = heat.slots[0].entryId;
    const clock = makeClock(T0);
    const head = device(race.id, 'head', 'head_judge', clock.now);
    const judge = device(race.id, 'judge', 'judge', clock.now);

    const start = head.factory.make({ kind: 'start', heatId: heat.id }, undefined, T0);
    const finish = judge.factory.make({ kind: 'finish' }, entryId, T0 + 50 * 60_000);
    const headFix = head.factory.make({ kind: 'edit', field: 'finish', at: T0 + 49 * 60_000, reason: 'clock' }, entryId, T0 + 60 * 60_000);
    // A judge correction made later still loses to the head judge.
    const judgeFix = judge.factory.make({ kind: 'edit', field: 'finish', at: T0 + 51 * 60_000, reason: 'typo' }, entryId, T0 + 61 * 60_000);

    const log = mergeLogs([start, finish, headFix, judgeFix]);
    const row = deriveResults(race, log).rows.find((r) => r.entry.id === entryId)!;
    expect(row.elapsedMs).toBe(49 * 60_000);
    expect(log).toHaveLength(4);
  });

  it('a later correction wins over an earlier one from the same role', () => {
    const race = makeDemoRace(T0);
    const heat = race.heats[0];
    const entryId = heat.slots[0].entryId;
    const clock = makeClock(T0);
    const judge = device(race.id, 'judge', 'judge', clock.now);
    const log = [
      judge.factory.make({ kind: 'start', heatId: heat.id }, undefined, T0),
      judge.factory.make({ kind: 'finish' }, entryId, T0 + 50 * 60_000),
      judge.factory.make({ kind: 'edit', field: 'finish', at: T0 + 48 * 60_000, reason: 'a' }, entryId, T0 + 55 * 60_000),
      judge.factory.make({ kind: 'edit', field: 'finish', at: T0 + 47 * 60_000, reason: 'b' }, entryId, T0 + 56 * 60_000),
    ];
    const row = deriveResults(race, log).rows.find((r) => r.entry.id === entryId)!;
    expect(row.elapsedMs).toBe(47 * 60_000);
  });

  it('undo cancels a tap but the tap stays in the log', () => {
    const race = makeDemoRace(T0);
    const heat = race.heats[0];
    const entryId = heat.slots[0].entryId;
    const clock = makeClock(T0);
    const judge = device(race.id, 'judge', 'judge', clock.now);
    const start = judge.factory.make({ kind: 'start', heatId: heat.id }, undefined, T0);
    const wrong = judge.factory.make({ kind: 'finish' }, entryId, T0 + 10 * 60_000);
    const undo = judge.factory.make({ kind: 'undo', targetId: wrong.id }, entryId, T0 + 10 * 60_000 + 5000);
    const row = deriveResults(race, [start, wrong, undo]).rows.find((r) => r.entry.id === entryId)!;
    expect(row.status).toBe('racing');
    expect(row.finishAt).toBeUndefined();
  });

  it('results rebuild from the log alone, in any order', () => {
    const race = makeDemoRace(T0);
    const clock = makeClock(T0);
    const judge = device(race.id, 'judge', 'judge', clock.now);
    const log = race.heats.flatMap((h, hi) => [
      judge.factory.make({ kind: 'start', heatId: h.id }, undefined, h.startAt),
      ...h.slots.map((s, si) => judge.factory.make({ kind: 'finish' }, s.entryId, h.startAt + (40 + hi + si) * 60_000)),
    ]);
    const a = deriveResults(race, log);
    const b = deriveResults(race, [...log].reverse());
    expect(b.rows.map((r) => [r.entry.id, r.elapsedMs, r.rank])).toEqual(a.rows.map((r) => [r.entry.id, r.elapsedMs, r.rank]));
  });

  it('IndexedDB store keeps events across a reopen, which is what a killed phone does', async () => {
    const clock = makeClock(T0);
    const first = new IndexedDbStore(indexedDB, 'killtest');
    const d = device('r1', 'phoneA', 'judge', clock.now, first);
    await d.store.put([d.factory.make({ kind: 'finish' }, 'e1'), d.factory.make({ kind: 'finish' }, 'e2')]);
    const reopened = new IndexedDbStore(indexedDB, 'killtest');
    expect(await reopened.all('r1')).toHaveLength(2);
    expect(await reopened.pending('r1')).toHaveLength(2);
  });
});

describe('section 6F and 11: the race day stress test', () => {
  it('network cut for 20 minutes, main phone killed, head judge takes over: zero lost finishes', async () => {
    const race = makeDemoRace(T0);
    const clock = makeClock(T0);
    const server = new FakeServer(clock.now);

    const mainStore = new MemoryStore(); // stands in for IndexedDB, which survives the kill
    let main = device(race.id, 'main', 'judge', clock.now, mainStore);
    const backup = device(race.id, 'backup', 'judge', clock.now);
    const head = device(race.id, 'head', 'head_judge', clock.now);

    // All heats start, recorded by the main phone.
    for (const h of race.heats) await main.store.put([main.factory.make({ kind: 'start', heatId: h.id }, undefined, h.startAt)]);
    await syncOnce(main.store, server.transport(), race.id);

    const all = race.heats.flatMap((h) => h.slots.map((s) => ({ h, s })));
    const expected = new Map<string, number>();

    // Network cut. Main phone and backup both record the first half.
    server.online = false;
    const half = Math.floor(all.length / 2);
    for (let i = 0; i < half; i++) {
      const { h, s } = all[i];
      const at = h.startAt + (45 * 60_000 + i * 7000);
      expected.set(s.entryId, at - h.startAt);
      await main.store.put([main.factory.make({ kind: 'finish' }, s.entryId, at)]);
      await backup.store.put([backup.factory.make({ kind: 'finish' }, s.entryId, at + 400)]);
      await syncOnce(main.store, server.transport(), race.id);
    }
    clock.advance(20 * 60_000);

    // Main phone killed. Head judge takes over for the rest, still offline.
    for (let i = half; i < all.length; i++) {
      const { h, s } = all[i];
      const at = h.startAt + (45 * 60_000 + i * 7000);
      expected.set(s.entryId, at - h.startAt);
      await head.store.put([head.factory.make({ kind: 'finish' }, s.entryId, at)]);
    }

    // Network back. The main phone restarts from its stored log.
    server.online = true;
    main = device(race.id, 'main', 'judge', clock.now, mainStore);
    // Two rounds: the first phone to sync only gets the others' events on its next sync.
    for (let round = 0; round < 2; round++) {
      for (const d of [head, backup, main]) await syncOnce(d.store, server.transport(), race.id);
    }

    const results = deriveResults(race, server.events());
    for (const row of results.rows) {
      expect(row.status).toBe('finished');
      expect(row.elapsedMs).toBe(expected.get(row.entry.id));
    }
    expect(results.flags.filter((f) => f.kind === 'devices_disagree')).toHaveLength(0);
    // Every phone ends with the full log.
    for (const d of [head, backup, main]) expect((await d.store.all(race.id)).length).toBe(server.events().length);
  });

  it('two phones that disagree on a finish raise a flag', () => {
    const race = makeDemoRace(T0);
    const heat = race.heats[0];
    const entryId = heat.slots[0].entryId;
    const clock = makeClock(T0);
    const a = device(race.id, 'a', 'judge', clock.now);
    const b = device(race.id, 'b', 'judge', clock.now);
    const log = [
      a.factory.make({ kind: 'start', heatId: heat.id }, undefined, T0),
      a.factory.make({ kind: 'finish' }, entryId, T0 + 50 * 60_000),
      b.factory.make({ kind: 'finish' }, entryId, T0 + 50 * 60_000 + 9000),
    ];
    const flags = deriveResults(race, log).flags;
    expect(flags).toContainEqual(expect.objectContaining({ kind: 'devices_disagree', entryId, gapMs: 9000 }));
  });
});
