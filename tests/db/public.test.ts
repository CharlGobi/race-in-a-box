import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildSetupPayload } from '@/core/race-setup';
import { deriveResults } from '@/core/results';
import { raceFromJson } from '@/core/sync-supabase';
import type { RawRace } from '@/core/sync-supabase';
import { soloTemplate } from '@/core/templates/solo';
import type { TimingEvent } from '@/core/types';

import { as, freshDb } from './harness';

const ALICE = randomUUID();
const BEN = randomUUID();
type Public = RawRace & { org: { name: string; trialUrl: string | null }; events: TimingEvent[] };

describe('section 6J: public results', () => {
  let db: PGlite;
  let org: string;
  let race: string;
  let slug: string;
  const rpc = async <T,>(user: string, sql: string, params: unknown[] = []) =>
    as(db, { user }, async () => (await db.query<{ r: T }>(sql, params)).rows[0]!.r);
  const pub = async () => as(db, { anon: true }, async () => (await db.query<{ r: Public }>('select public.public_results($1) as r', [slug])).rows[0]!.r);

  beforeAll(async () => {
    db = await freshDb();
    org = await rpc<string>(ALICE, `select public.create_org('Gobi Fitness', 'gobi') as r`);
    await rpc<string>(BEN, `select public.create_org('Other', 'other') as r`);
    const p = buildSetupPayload(soloTemplate, { name: 'Winter solo', raceDate: '2026-07-04', venue: 'Gobi' }, [
      { code: '1', displayName: 'Lize Botha', divisionCode: 'WO', members: ['Lize Botha'] },
      { code: '2', displayName: 'Thabo Zulu', divisionCode: 'MO', members: ['Thabo Zulu'] },
    ], { lanes: 4, intervalMin: 2, firstStartAt: Date.UTC(2026, 6, 4, 6) });
    race = await rpc<string>(ALICE, 'select public.setup_race($1, $2::jsonb) as r', [org, JSON.stringify(p)]);
    slug = (await db.query<{ s: string }>('select public_slug s from races where id = $1', [race])).rows[0]!.s;
    await db.query(`update athletes set show_as_initials = true where name = 'Thabo Zulu'`);
    const token = await rpc<string>(ALICE, `select public.create_access_link($1, 'judge', 'Finish', 24) as r`, [race]);
    const heat = (await db.query<{ id: string }>('select id from heats where race_id = $1 order by number limit 1', [race])).rows[0]!.id;
    const lize = (await db.query<{ id: string }>(`select id from entries where code = '1'`)).rows[0]!.id;
    const t0 = Date.UTC(2026, 6, 4, 6);
    await as(db, { anon: true }, () =>
      db.query('select * from public.push_timing_events($1, $2::jsonb)', [
        token,
        JSON.stringify([
          { id: randomUUID(), raceId: race, deviceId: 'phone-secret-id', entryId: null, deviceTs: t0, seq: 1, payload: { kind: 'start', heatId: heat } },
          { id: randomUUID(), raceId: race, deviceId: 'phone-secret-id', entryId: lize, deviceTs: t0 + 75 * 60_000, seq: 2, payload: { kind: 'finish' } },
        ]),
      ]),
    );
  }, 60_000);

  it('anyone with the link sees the race and results built from the log, with no login', async () => {
    const p = await pub();
    expect(p.org.name).toBe('Gobi Fitness');
    const results = deriveResults(raceFromJson(p), p.events.map((e) => ({ ...e, deviceTs: Number(e.deviceTs) })));
    expect(results.rows.find((r) => r.entry.code === '1')).toMatchObject({ status: 'finished', elapsedMs: 75 * 60_000, rank: 1 });
  });

  it('shows initials for an athlete who asked, and leaks no athlete names or phone ids', async () => {
    const text = JSON.stringify(await pub());
    expect(text).toContain('T. Z.');
    expect(text).not.toContain('Thabo');
    expect(text).not.toContain('phone-secret-id');
  });

  it('a wrong link and a hidden race both say not found', async () => {
    await expect(as(db, { anon: true }, () => db.query('select public.public_results($1)', ['nope']))).rejects.toThrow(/results_not_found/);
    await rpc(ALICE, 'select public.set_results_public($1, false) as r', [race]);
    await expect(pub()).rejects.toThrow(/results_not_found/);
    await expect(rpc(BEN, 'select public.set_results_public($1, true) as r', [race])).rejects.toThrow(/not_allowed/);
    await rpc(ALICE, 'select public.set_results_public($1, true) as r', [race]);
  });

  it('a visitor asks for a trial class, and only the gym sees it', async () => {
    await expect(as(db, { anon: true }, () => db.query(`select public.submit_visitor($1, '2', 'Thabo', '082 000 0000', false)`, [slug]))).rejects.toThrow(/consent_required/);
    await as(db, { anon: true }, () => db.query(`select public.submit_visitor($1, '2', 'Thabo', '082 000 0000', true)`, [slug]));
    for (let i = 0; i < 4; i++) await as(db, { anon: true }, () => db.query(`select public.submit_visitor($1, '2', 'x', 'x@x.co', true)`, [slug]));
    await expect(as(db, { anon: true }, () => db.query(`select public.submit_visitor($1, '2', 'x', 'x@x.co', true)`, [slug]))).rejects.toThrow(/too_many/);
    const info = await rpc<{ visitors: { name: string; entryCode: string }[] }>(ALICE, 'select public.race_public_info($1) as r', [race]);
    expect(info.visitors).toHaveLength(5);
    expect(info.visitors.at(-1)).toMatchObject({ name: 'Thabo', entryCode: '2' });
    await expect(rpc(BEN, 'select public.race_public_info($1) as r', [race])).rejects.toThrow(/not_allowed/);
    await expect(as(db, { anon: true }, () => db.query('select * from visitor_leads'))).rejects.toThrow(/permission denied/);
  });

  it('the trial link must be https and only the organiser can set it', async () => {
    await expect(rpc(ALICE, `select public.update_org_trial_url($1, 'javascript:alert(1)') as r`, [org])).rejects.toThrow(/bad_url/);
    await rpc(ALICE, `select public.update_org_trial_url($1, 'https://gobi.example/trial') as r`, [org]);
    expect((await pub()).org.trialUrl).toBe('https://gobi.example/trial');
    await expect(rpc(BEN, `select public.update_org_trial_url($1, 'https://x.example') as r`, [org])).rejects.toThrow(/not_allowed/);
  });
});
