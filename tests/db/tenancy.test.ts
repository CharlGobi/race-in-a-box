import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { as, freshDb } from './harness';

const ALICE = randomUUID(); // organiser at gym A
const BEN = randomUUID(); // organiser at gym B

type Seeded = { org: string; race: string; division: string; segment: string; entry: string; athlete: string; heat: string; token: string; linkId: string };

async function seedGym(db: PGlite, user: string, name: string, sub: string): Promise<Seeded> {
  return as(db, { user }, async () => {
    const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
    const org = (await db.query<{ id: string }>('select public.create_org($1, $2) as id', [name, sub])).rows[0]!.id;
    const race = await one(`insert into races (org_id, name, race_date) values ($1, 'Race', '2026-11-28') returning id`, [org]);
    const division = await one(`insert into divisions (org_id, race_id, code, label) values ($1, $2, 'T2M', 'Teams') returning id`, [org, race]);
    const segment = await one(`insert into segments (org_id, race_id, ord, kind, name, metric) values ($1, $2, 1, 'run', 'Run', 'distance') returning id`, [org, race]);
    await db.query(`insert into segment_targets (org_id, segment_id, division_id, value, unit) values ($1, $2, $3, 900, 'm')`, [org, segment, division]);
    const entry = await one(`insert into entries (org_id, race_id, division_id, kind, code, display_name) values ($1, $2, $3, 'team', '1', 'Team 1') returning id`, [org, race, division]);
    const athlete = await one(`insert into athletes (org_id, name) values ($1, 'Lize Botha') returning id`, [org]);
    await db.query(`insert into entry_members (org_id, entry_id, athlete_id) values ($1, $2, $3)`, [org, entry, athlete]);
    const heat = await one(`insert into heats (org_id, race_id, number, start_at) values ($1, $2, 1, now()) returning id`, [org, race]);
    await db.query(`insert into heat_slots (org_id, race_id, heat_id, lane, entry_id) values ($1, $2, $3, 1, $4)`, [org, race, heat, entry]);
    const token = (await db.query<{ t: string }>(`select public.create_access_link($1, 'judge', 'Finish line', 24) as t`, [race])).rows[0]!.t;
    const linkId = (await db.query<{ id: string }>(`select id from access_links where race_id = $1`, [race])).rows[0]!.id;
    return { org, race, division, segment, entry, athlete, heat, token, linkId };
  });
}

function timingEvent(race: string, entry: string | null, extra: Record<string, unknown> = {}) {
  return { id: randomUUID(), raceId: race, deviceId: 'phoneA', entryId: entry, deviceTs: Date.now(), tzOffsetMin: 120, seq: 1, payload: { kind: 'finish' }, ...extra };
}

async function push(db: PGlite, token: string, events: unknown[]) {
  return as(db, { anon: true }, async () =>
    (await db.query<{ id: string; server_ts: string }>('select * from public.push_timing_events($1, $2::jsonb)', [token, JSON.stringify(events)])).rows,
  );
}

const TABLES = ['orgs', 'org_members', 'races', 'divisions', 'segments', 'segment_targets', 'entries', 'athletes', 'entry_members', 'heats', 'heat_slots', 'access_links', 'timing_events', 'audit_log'];

describe('section 6A: cross tenant test on every table', () => {
  let db: PGlite;
  let a: Seeded;
  let b: Seeded;

  beforeAll(async () => {
    db = await freshDb();
    a = await seedGym(db, ALICE, 'Gobi', 'gobi');
    b = await seedGym(db, BEN, 'Other Gym', 'othergym');
    await push(db, a.token, [timingEvent(a.race, a.entry)]);
    await push(db, b.token, [timingEvent(b.race, b.entry)]);
  }, 60_000);

  it('the migration covers every table with row level security', async () => {
    const rows = (await db.query<{ tablename: string; rowsecurity: boolean }>(`select tablename, rowsecurity from pg_tables where schemaname = 'public'`)).rows;
    expect(rows.map((r) => r.tablename).sort()).toEqual([...TABLES].sort());
    for (const r of rows) expect(r.rowsecurity, r.tablename).toBe(true);
  });

  for (const table of TABLES) {
    it(`${table}: gym B can not read, change or delete gym A rows`, async () => {
      const col = table === 'orgs' ? 'id' : 'org_id';
      // Each gym sees its own rows.
      const own = await as(db, { user: ALICE }, async () => (await db.query<{ n: number }>(`select count(*)::int n from ${table} where ${col} = $1`, [a.org])).rows[0]!.n);
      expect(own, `${table} seeded`).toBeGreaterThan(0);

      await as(db, { user: BEN }, async () => {
        const seen = (await db.query<{ n: number }>(`select count(*)::int n from ${table} where ${col} = $1`, [a.org])).rows[0]!.n;
        expect(seen).toBe(0);
        const upd = await db.query(`update ${table} set ${col} = ${col} where ${col} = $1`, [a.org]).catch((e: Error) => e);
        if (!(upd instanceof Error)) expect(upd.affectedRows).toBe(0);
        const del = await db.query(`delete from ${table} where ${col} = $1`, [a.org]).catch((e: Error) => e);
        if (!(del instanceof Error)) expect(del.affectedRows).toBe(0);
      });

      const still = await as(db, { user: ALICE }, async () => (await db.query<{ n: number }>(`select count(*)::int n from ${table} where ${col} = $1`, [a.org])).rows[0]!.n);
      expect(still).toBe(own);
    });
  }

  it('gym B can not write rows into gym A, or point its own rows at gym A data', async () => {
    await as(db, { user: BEN }, async () => {
      await expect(db.query(`insert into races (org_id, name, race_date) values ($1, 'x', '2026-12-01')`, [a.org])).rejects.toThrow();
      await expect(db.query(`insert into divisions (org_id, race_id, code, label) values ($1, $2, 'X', 'x')`, [b.org, a.race])).rejects.toThrow();
      await expect(db.query(`insert into entry_members (org_id, entry_id, athlete_id) values ($1, $2, $3)`, [b.org, b.entry, a.athlete])).rejects.toThrow();
      await expect(db.query(`insert into org_members (org_id, user_id, role) values ($1, $2, 'organiser')`, [a.org, BEN])).rejects.toThrow();
      await expect(db.query(`select public.create_access_link($1, 'head_judge', 'x', 24)`, [a.race])).rejects.toThrow(/not_allowed/);
      await expect(db.query(`select public.revoke_access_link($1)`, [a.linkId])).rejects.toThrow(/not_allowed/);
    });
  });

  it('a visitor with no account and no link can read nothing', async () => {
    await as(db, { anon: true }, async () => {
      for (const t of TABLES) await expect(db.query(`select * from ${t} limit 1`), t).rejects.toThrow(/permission denied/);
    });
  });
});

describe('section 6E and 7: access links and the server log', () => {
  let db: PGlite;
  let a: Seeded;
  let b: Seeded;

  beforeAll(async () => {
    db = await freshDb();
    a = await seedGym(db, ALICE, 'Gobi', 'gobi');
    b = await seedGym(db, BEN, 'Other Gym', 'othergym');
  }, 60_000);

  it('a judge link pushes finishes, and pushing the same events again adds nothing', async () => {
    const evs = [timingEvent(a.race, a.entry), timingEvent(a.race, null, { payload: { kind: 'start', heatId: 'heat1' } })];
    const first = await push(db, a.token, evs);
    const again = await push(db, a.token, evs);
    expect(first).toHaveLength(2);
    expect(again.map((r) => r.server_ts)).toEqual(first.map((r) => r.server_ts));
    const n = (await db.query<{ n: number }>('select count(*)::int n from timing_events where race_id = $1', [a.race])).rows[0]!.n;
    expect(n).toBe(2);
  });

  it('the role and race come from the link, so a phone can not promote itself to head judge', async () => {
    const ev = timingEvent(a.race, a.entry, { actorRole: 'head_judge' });
    await push(db, a.token, [ev]);
    const row = (await db.query<{ actor_role: string; actor_link_id: string }>('select actor_role, actor_link_id from timing_events where id = $1', [ev.id])).rows[0]!;
    expect(row.actor_role).toBe('judge');
    expect(row.actor_link_id).toBe(a.linkId);
  });

  it('a link can not write to another race or reference another gym entry', async () => {
    await expect(push(db, a.token, [timingEvent(b.race, b.entry)])).rejects.toThrow(/wrong_race/);
    await expect(push(db, a.token, [timingEvent(a.race, b.entry)])).rejects.toThrow();
  });

  it('pull returns only this race, in server order, and picks up from a cursor', async () => {
    await push(db, b.token, [timingEvent(b.race, b.entry)]);
    const all = await as(db, { anon: true }, async () => (await db.query<{ e: { raceId: string; serverSeq: number } }>('select e from public.pull_timing_events($1) e', [a.token])).rows.map((r) => r.e));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.raceId === a.race)).toBe(true);
    const last = all[all.length - 1]!.serverSeq;
    const after = await as(db, { anon: true }, async () => (await db.query('select e from public.pull_timing_events($1, $2) e', [a.token, last])).rows);
    expect(after).toHaveLength(0);
  });

  it('timing events can never be changed or deleted, even by the server', async () => {
    const id = (await db.query<{ id: string }>('select id from timing_events limit 1')).rows[0]!.id;
    await expect(db.query(`update timing_events set device_ts = 0 where id = $1`, [id])).rejects.toThrow(/append_only/);
    await expect(db.query(`delete from timing_events where id = $1`, [id])).rejects.toThrow(/append_only/);
    await as(db, { user: ALICE }, async () => {
      await expect(db.query(`update timing_events set device_ts = 0 where id = $1`, [id])).rejects.toThrow();
    });
  });

  it('a revoked link stops working on the very next call', async () => {
    const token = await as(db, { user: ALICE }, async () => (await db.query<{ t: string }>(`select public.create_access_link($1, 'judge', 'Spare', 24) as t`, [a.race])).rows[0]!.t);
    await push(db, token, [timingEvent(a.race, a.entry)]);
    const linkId = (await db.query<{ id: string }>(`select id from access_links where label = 'Spare'`)).rows[0]!.id;
    await as(db, { user: ALICE }, () => db.query('select public.revoke_access_link($1)', [linkId]));
    await expect(push(db, token, [timingEvent(a.race, a.entry)])).rejects.toThrow(/link_revoked/);
    await expect(as(db, { anon: true }, () => db.query('select public.link_info($1)', [token]))).rejects.toThrow(/link_revoked/);
  });

  it('an expired link gives a clear message', async () => {
    await db.query(`update access_links set expires_at = now() - interval '1 minute' where id = $1`, [a.linkId]);
    await expect(push(db, a.token, [timingEvent(a.race, a.entry)])).rejects.toThrow(/link_expired/);
    await expect(push(db, 'made-up-token', [])).rejects.toThrow(/link_unknown/);
  });

  it('a volunteer link can see its job but can not record times', async () => {
    const token = await as(db, { user: ALICE }, async () => (await db.query<{ t: string }>(`select public.create_access_link($1, 'volunteer', 'Water', 24) as t`, [a.race])).rows[0]!.t);
    const info = await as(db, { anon: true }, async () => (await db.query<{ i: { role: string } }>('select public.link_info($1) as i', [token])).rows[0]!.i);
    expect(info.role).toBe('volunteer');
    await expect(push(db, token, [timingEvent(a.race, a.entry)])).rejects.toThrow(/not_allowed/);
  });

  it('link tokens are never stored, only their hash', async () => {
    const stored = (await db.query<{ h: string }>('select token_hash h from access_links where id = $1', [a.linkId])).rows[0]!.h;
    expect(stored).not.toBe(a.token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });
});
