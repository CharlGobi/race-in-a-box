import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { makeDemoRace } from '@/core/demo';
import { deriveResults } from '@/core/results';
import { MemoryStore } from '@/core/store';
import { syncOnce } from '@/core/sync';
import { LinkError, loadRaceSnapshot, SupabaseTransport } from '@/core/sync-supabase';
import type { ServerConfig } from '@/core/sync-supabase';
import type { Race } from '@/core/types';

import { device, makeClock } from '../helpers';
import { as, freshDb } from './harness';

const ORGANISER = randomUUID();

/** Stands in for Supabase's REST endpoint: each call runs the SQL function as the anon role. */
function fakeSupabase(db: PGlite, net: { online: boolean }): ServerConfig {
  const fetchImpl = (async (url: string, init: { body: string }) => {
    if (!net.online) throw new TypeError('Network request failed');
    const fn = url.split('/rpc/')[1]!;
    const args = JSON.parse(init.body) as Record<string, unknown>;
    const names = Object.keys(args);
    const params = names.map((k) => (typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    const call = `public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
    try {
      const body = await as(db, { anon: true }, async () => {
        if (fn === 'push_timing_events') return (await db.query(`select * from ${call}`, params)).rows;
        if (fn === 'pull_timing_events') return (await db.query<{ e: unknown }>(`select e as pull_timing_events from ${call} e`, params)).rows;
        return (await db.query<{ r: unknown }>(`select ${call} as r`, params)).rows[0]!.r;
      });
      // Like Supabase, a function that returns nothing answers 204 with no body.
      if (body === null || body === '') return new Response(null, { status: 204 });
      return new Response(JSON.stringify(body), { status: 200 });
    } catch (e) {
      return new Response(JSON.stringify({ message: (e as Error).message }), { status: 400 });
    }
  }) as unknown as typeof fetch;
  return { url: 'https://example.supabase.co', anonKey: 'anon', fetch: fetchImpl };
}

/** Load the rehearsal race into the database the way the race builder will. */
async function seedRace(db: PGlite, demo: Race) {
  return as(db, { user: ORGANISER }, async () => {
    const id = async (sql: string, p: unknown[]) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
    const org = (await db.query<{ id: string }>(`select public.create_org('Gobi', 'gobi') as id`)).rows[0]!.id;
    const race = await id(`insert into races (org_id, name, race_date, venue) values ($1, $2, '2026-10-31', $3) returning id`, [org, demo.name, demo.venue]);
    const div = new Map<string, string>();
    for (const d of demo.template.divisions) div.set(d.id, await id(`insert into divisions (org_id, race_id, code, label) values ($1, $2, $3, $4) returning id`, [org, race, d.code, d.label]));
    const ent = new Map<string, string>();
    for (const e of demo.entries) ent.set(e.id, await id(`insert into entries (org_id, race_id, division_id, kind, code, display_name) values ($1, $2, $3, 'team', $4, $5) returning id`, [org, race, div.get(e.divisionId), e.code, e.displayName]));
    for (const h of demo.heats) {
      const heat = await id(`insert into heats (org_id, race_id, number, start_at) values ($1, $2, $3, to_timestamp($4 / 1000.0)) returning id`, [org, race, h.number, h.startAt]);
      for (const s of h.slots) await db.query(`insert into heat_slots (org_id, race_id, heat_id, lane, entry_id) values ($1, $2, $3, $4, $5)`, [org, race, heat, s.lane, ent.get(s.entryId)]);
    }
    const link = async (role: string, label: string) => (await db.query<{ t: string }>(`select public.create_access_link($1, $2, $3, 24) as t`, [race, role, label])).rows[0]!.t;
    return { race, judgeToken: await link('judge', 'Finish line'), backupToken: await link('judge', 'Backup'), headToken: await link('head_judge', 'Head judge') };
  });
}

describe('server sync through the real database functions', () => {
  let db: PGlite;
  const net = { online: true };
  let cfg: ServerConfig;
  let seeded: Awaited<ReturnType<typeof seedRace>>;
  const T0 = Date.UTC(2026, 9, 31, 7, 0, 0);

  beforeAll(async () => {
    db = await freshDb();
    cfg = fakeSupabase(db, net);
    seeded = await seedRace(db, makeDemoRace(T0));
  }, 120_000);

  it('a judge phone loads the whole race from its link', async () => {
    const snap = await loadRaceSnapshot(cfg, seeded.judgeToken);
    expect(snap.link.role).toBe('judge');
    expect(snap.race.entries).toHaveLength(60);
    expect(snap.race.heats).toHaveLength(12);
    expect(snap.race.template.divisions.map((d) => d.code).sort()).toEqual(['R4M', 'R4W', 'R4X', 'T2M', 'T2W', 'T2X']);
  });

  it('section 11: network cut for 20 minutes, main phone killed, head judge takeover, zero lost', async () => {
    const { race } = await loadRaceSnapshot(cfg, seeded.judgeToken);
    const clock = makeClock(T0);
    const mainStore = new MemoryStore();
    let main = device(race.id, 'main', 'judge', clock.now, mainStore);
    const backup = device(race.id, 'backup', 'judge', clock.now);
    const head = device(race.id, 'head', 'head_judge', clock.now);
    let mainT = new SupabaseTransport(cfg, seeded.judgeToken);
    const backupT = new SupabaseTransport(cfg, seeded.backupToken);
    const headT = new SupabaseTransport(cfg, seeded.headToken);

    for (const h of race.heats) await main.store.put([main.factory.make({ kind: 'start', heatId: h.id }, undefined, h.startAt)]);
    await syncOnce(main.store, mainT, race.id);

    const all = race.heats.flatMap((h) => h.slots.map((s) => ({ h, s })));
    const expected = new Map<string, number>();
    net.online = false;
    const half = Math.floor(all.length / 2);
    for (let i = 0; i < half; i++) {
      const { h, s } = all[i]!;
      const at = h.startAt + 45 * 60_000 + i * 7000;
      expected.set(s.entryId, at - h.startAt);
      await main.store.put([main.factory.make({ kind: 'finish' }, s.entryId, at)]);
      await backup.store.put([backup.factory.make({ kind: 'finish' }, s.entryId, at + 300)]);
      const st = await syncOnce(main.store, mainT, race.id);
      expect(st.online).toBe(false);
    }
    clock.advance(20 * 60_000);
    for (let i = half; i < all.length; i++) {
      const { h, s } = all[i]!;
      const at = h.startAt + 45 * 60_000 + i * 7000;
      expected.set(s.entryId, at - h.startAt);
      await head.store.put([head.factory.make({ kind: 'finish' }, s.entryId, at)]);
    }

    net.online = true;
    main = device(race.id, 'main', 'judge', clock.now, mainStore);
    mainT = new SupabaseTransport(cfg, seeded.judgeToken);
    for (let round = 0; round < 2; round++) {
      for (const [d, t] of [[head, headT], [backup, backupT], [main, mainT]] as const) {
        const st = await syncOnce(d.store, t, race.id);
        expect(st.online).toBe(true);
      }
    }

    const serverLog = await new SupabaseTransport(cfg, seeded.headToken).pull(race.id);
    const results = deriveResults(race, serverLog);
    for (const row of results.rows) {
      expect(row.status, row.entry.code).toBe('finished');
      expect(row.elapsedMs, row.entry.code).toBe(expected.get(row.entry.id));
    }
    expect(serverLog.length).toBe(race.heats.length + all.length + half);
    for (const d of [head, backup, main]) {
      expect(await d.store.pending(race.id)).toHaveLength(0);
      expect((await d.store.all(race.id)).length).toBe(serverLog.length);
    }
    // The head judge's events carry the head judge role, set by the server from the link.
    expect(serverLog.filter((e) => e.actorRole === 'head_judge')).toHaveLength(all.length - half);
  }, 120_000);

  it('a revoked link turns into a clear message on the phone, and taps stay saved', async () => {
    const { race } = await loadRaceSnapshot(cfg, seeded.backupToken);
    const linkId = (await db.query<{ id: string }>(`select id from access_links where label = 'Backup'`)).rows[0]!.id;
    await as(db, { user: ORGANISER }, () => db.query('select public.revoke_access_link($1)', [linkId]));
    const d = device(race.id, 'backup2', 'judge', Date.now);
    await d.store.put([d.factory.make({ kind: 'finish' }, race.entries[0]!.id)]);
    const t = new SupabaseTransport(cfg, seeded.backupToken);
    await expect(t.push(await d.store.pending(race.id))).rejects.toEqual(new LinkError('link_revoked'));
    const st = await syncOnce(d.store, t, race.id);
    expect(st).toMatchObject({ savedOnPhone: 1, waitingToSend: 1, problem: 'link_revoked' });
  });
});
