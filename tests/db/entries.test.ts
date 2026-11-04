import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildSetupPayload } from '@/core/race-setup';
import { gobiTemplate } from '@/core/templates/gobi';

import { as, freshDb } from './harness';

const ALICE = randomUUID();
const BEN = randomUUID();

type EntryJson = { id: string; code: string; displayName: string; division: string; heat: number | null; members: string[] };

describe('section 6C: entries after the race is made', () => {
  let db: PGlite;
  let org: string;
  let race: string;
  let token: string;
  const id = async (code: string) => (await db.query<{ id: string }>('select id from entries where race_id = $1 and code = $2', [race, code])).rows[0]!.id;
  const rpc = async <T,>(user: string, sql: string, params: unknown[] = []) =>
    as(db, { user }, async () => (await db.query<{ r: T }>(sql, params)).rows[0]!.r);

  beforeAll(async () => {
    db = await freshDb();
    org = await rpc<string>(ALICE, `select public.create_org('Gobi', 'gobi') as r`);
    await rpc<string>(BEN, `select public.create_org('Other', 'other') as r`);
    const teams = [
      { code: '1', displayName: 'Team Botha', divisionCode: 'T2M', members: ['Pieter Botha', 'Ruan Botha'] },
      { code: '2', displayName: 'Team Naidoo', divisionCode: 'T2W', members: ['Ayesha Naidoo', 'Megan Pillay'] },
      { code: '3', displayName: 'Team Smit', divisionCode: 'T2M', members: ['Kyle Smit', 'Jaco Smit'] },
    ];
    const p = buildSetupPayload(gobiTemplate, { name: 'Summer Sim', raceDate: '2026-11-28', venue: 'Gobi' }, teams, { lanes: 5, intervalMin: 6, firstStartAt: Date.UTC(2026, 10, 28, 5) });
    race = await rpc<string>(ALICE, 'select public.setup_race($1, $2::jsonb) as r', [org, JSON.stringify(p)]);
    token = await rpc<string>(ALICE, `select public.create_access_link($1, 'judge', 'Finish', 24) as r`, [race]);
  }, 60_000);

  it('stores athletes with their entries and shows them to the organiser', async () => {
    const admin = await rpc<{ members: Record<string, string[]> }>(ALICE, 'select public.race_admin($1) as r', [race]);
    expect(admin.members[await id('1')]).toEqual(['Pieter Botha', 'Ruan Botha']);
  });

  it('never sends athlete names to a judge phone', async () => {
    const snap = await as(db, { anon: true }, async () => (await db.query<{ r: unknown }>('select public.race_snapshot($1) as r', [token])).rows[0]!.r);
    const text = JSON.stringify(snap);
    expect(text).toContain('Team Botha');
    expect(text).not.toContain('Pieter');
    expect(text).not.toContain('Ayesha');
  });

  it('edits number and name, swaps an athlete, and moves division, with the old values in the audit log', async () => {
    const e1 = await id('1');
    const out = await rpc<EntryJson>(ALICE, 'select public.update_entry($1, $2, $3, $4, $5::jsonb) as r', [e1, '11', 'Team Botha Bros', 'T2X', JSON.stringify(['Pieter Botha', 'Lize Botha'])]);
    expect(out).toMatchObject({ code: '11', displayName: 'Team Botha Bros', division: 'T2X', members: ['Pieter Botha', 'Lize Botha'] });
    // The swapped out athlete is gone, not left behind.
    const ruan = (await db.query<{ n: number }>(`select count(*)::int n from athletes where name = 'Ruan Botha'`)).rows[0]!.n;
    expect(ruan).toBe(0);
    const audit = (await db.query<{ before: EntryJson; after: EntryJson }>(`select before, after from audit_log where action = 'entry.update'`)).rows[0]!;
    expect(audit.before).toMatchObject({ code: '1', division: 'T2M', members: ['Pieter Botha', 'Ruan Botha'] });
    expect(audit.after).toMatchObject({ code: '11', division: 'T2X' });
  });

  it('refuses a number that is already taken, a bad number and an unknown division', async () => {
    const e2 = await id('2');
    await expect(rpc(ALICE, 'select public.update_entry($1, $2, $3, $4, $5::jsonb) as r', [e2, '3', 'Team Naidoo', 'T2W', '[]'])).rejects.toThrow(/unique|duplicate/);
    await expect(rpc(ALICE, 'select public.update_entry($1, $2, $3, $4, $5::jsonb) as r', [e2, '12a', 'Team Naidoo', 'T2W', '[]'])).rejects.toThrow(/bad_number/);
    await expect(rpc(ALICE, 'select public.update_entry($1, $2, $3, $4, $5::jsonb) as r', [e2, '2', 'Team Naidoo', 'KIDS', '[]'])).rejects.toThrow(/unknown_division/);
  });

  it('adds a late entry into the next free lane of a heat', async () => {
    const out = await rpc<EntryJson>(ALICE, 'select public.add_entry($1, $2, $3, $4, $5::jsonb, $6) as r', [race, '40', 'Team Late', 'T2M', JSON.stringify(['Thabo Zulu', 'Sipho Dlamini']), 1]);
    expect(out).toMatchObject({ code: '40', heat: 1, members: ['Thabo Zulu', 'Sipho Dlamini'] });
    const lanes = (await db.query<{ lane: number }>('select lane from heat_slots hs join heats h on h.id = hs.heat_id where h.race_id = $1 and h.number = 1 order by lane', [race])).rows.map((r) => r.lane);
    expect(lanes).toEqual([1, 2, 3]);
    const noHeat = await rpc<EntryJson>(ALICE, 'select public.add_entry($1, $2, $3, $4, $5::jsonb) as r', [race, '41', 'Team Walk In', 'T2W', '[]']);
    expect(noHeat.heat).toBeNull();
  });

  it('removes an entry with no times, and refuses once a time exists', async () => {
    await rpc(ALICE, 'select public.remove_entry($1) as r', [await id('41')]);
    expect((await db.query('select 1 from entries where race_id = $1 and code = $2', [race, '41'])).rows).toHaveLength(0);

    const e3 = await id('3');
    await as(db, { anon: true }, () =>
      db.query('select * from public.push_timing_events($1, $2::jsonb)', [
        token,
        JSON.stringify([{ id: randomUUID(), raceId: race, deviceId: 'p', entryId: e3, deviceTs: Date.now(), seq: 1, payload: { kind: 'finish' } }]),
      ]),
    );
    await expect(rpc(ALICE, 'select public.remove_entry($1) as r', [e3])).rejects.toThrow(/has_times/);
  });

  it('another gym can not edit, add or remove entries', async () => {
    const e2 = await id('2');
    await expect(rpc(BEN, 'select public.update_entry($1, $2, $3, $4, $5::jsonb) as r', [e2, '2', 'Hijack', 'T2W', '[]'])).rejects.toThrow(/not_allowed/);
    await expect(rpc(BEN, 'select public.add_entry($1, $2, $3, $4, $5::jsonb) as r', [race, '99', 'x', 'T2W', '[]'])).rejects.toThrow(/not_allowed/);
    await expect(rpc(BEN, 'select public.remove_entry($1) as r', [e2])).rejects.toThrow(/not_allowed/);
    await expect(as(db, { anon: true }, () => db.query('select public.remove_entry($1)', [e2]))).rejects.toThrow(/permission denied/);
  });
});

describe('section 6F: protest window setting', () => {
  it('defaults to 15 minutes, can be changed by the organiser, and reaches judge phones', async () => {
    const db = await freshDb();
    const org = await as(db, { user: ALICE }, async () => (await db.query<{ r: string }>(`select public.create_org('Gobi', 'gobi') as r`)).rows[0]!.r);
    const race = await as(db, { user: ALICE }, async () => (await db.query<{ r: string }>(`insert into races (org_id, name, race_date) values ($1, 'R', '2026-11-28') returning id as r`, [org])).rows[0]!.r);
    const token = await as(db, { user: ALICE }, async () => (await db.query<{ r: string }>(`select public.create_access_link($1, 'head_judge', 'Head', 24) as r`, [race])).rows[0]!.r);
    const snap = async () => as(db, { anon: true }, async () => (await db.query<{ r: { race: { protestWindowMin: number } } }>('select public.race_snapshot($1) as r', [token])).rows[0]!.r);
    expect((await snap()).race.protestWindowMin).toBe(15);
    await as(db, { user: ALICE }, () => db.query('select public.update_race_settings($1, 30)', [race]));
    expect((await snap()).race.protestWindowMin).toBe(30);
    await expect(as(db, { user: BEN }, () => db.query('select public.update_race_settings($1, 0)', [race]))).rejects.toThrow(/not_allowed/);
    await expect(as(db, { user: ALICE }, () => db.query('select public.update_race_settings($1, 999)', [race]))).rejects.toThrow();
  });
});
