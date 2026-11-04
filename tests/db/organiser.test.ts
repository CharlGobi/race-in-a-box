import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildSetupPayload, parseTeamList } from '@/core/race-setup';
import { raceFromJson } from '@/core/sync-supabase';
import type { RawRace } from '@/core/sync-supabase';
import { gobiTemplate } from '@/core/templates/gobi';
import { soloTemplate } from '@/core/templates/solo';

import { as, freshDb } from './harness';

const ALICE = randomUUID();
const BEN = randomUUID();
const CODES = gobiTemplate.divisions.map((d) => d.code);

function payload(n = 60) {
  const text = Array.from({ length: n }, (_, i) => `${i + 1}, Team ${i + 1}, ${CODES[i % CODES.length]}`).join('\n');
  return buildSetupPayload(gobiTemplate, { name: 'Gobi Summer Sim', raceDate: '2026-11-28', venue: 'Gobi, George' }, parseTeamList(text, CODES).entries, {
    lanes: 5,
    intervalMin: 6,
    firstStartAt: Date.UTC(2026, 10, 28, 6, 0),
  });
}

describe('organiser functions', () => {
  let db: PGlite;
  let orgA: string;
  let orgB: string;

  const rpc = async <T,>(user: string, sql: string, params: unknown[] = []) =>
    as(db, { user }, async () => (await db.query<{ r: T }>(sql, params)).rows[0]!.r);

  beforeAll(async () => {
    db = await freshDb();
    orgA = await rpc<string>(ALICE, `select public.create_org('Gobi', 'gobi') as r`);
    orgB = await rpc<string>(BEN, `select public.create_org('Other', 'other') as r`);
  }, 60_000);

  it('my_orgs lists only the signed in user own gyms', async () => {
    const mine = await rpc<{ id: string; role: string }[]>(ALICE, 'select public.my_orgs() as r');
    expect(mine).toEqual([expect.objectContaining({ id: orgA, role: 'organiser', subdomain: 'gobi' })]);
  });

  it('setup_race creates the whole race in one go, and race_admin returns it in the app shape', async () => {
    const raceId = await rpc<string>(ALICE, 'select public.setup_race($1, $2::jsonb) as r', [orgA, JSON.stringify(payload())]);
    const admin = await rpc<{ race: { name: string }; entries: unknown[]; heats: { slots: unknown[] }[]; divisions: unknown[]; segments: unknown[]; links: unknown[]; events: unknown[]; canEdit: boolean }>(
      ALICE,
      'select public.race_admin($1) as r',
      [raceId],
    );
    expect(admin.race.name).toBe('Gobi Summer Sim');
    expect(admin.entries).toHaveLength(60);
    expect(admin.divisions).toHaveLength(6);
    expect(admin.segments).toHaveLength(16);
    expect(admin.heats.flatMap((h) => h.slots)).toHaveLength(60);
    expect(admin.canEdit).toBe(true);
    expect(admin.links).toEqual([]);

    const list = await rpc<{ id: string; entries: number }[]>(ALICE, 'select public.list_races($1) as r', [orgA]);
    expect(list).toEqual([expect.objectContaining({ id: raceId, entries: 60 })]);
  });

  it('a race with a bad row is not half saved', async () => {
    const bad = payload(6);
    bad.entries.push({ ...bad.entries[0]! }); // duplicate number
    await expect(rpc(ALICE, 'select public.setup_race($1, $2::jsonb) as r', [orgA, JSON.stringify({ ...bad, name: 'Broken race' })])).rejects.toThrow();
    const n = (await db.query<{ n: number }>(`select count(*)::int n from races where name = 'Broken race'`)).rows[0]!.n;
    expect(n).toBe(0);
  });

  it('another gym can not create races in, list, or open gym A races', async () => {
    const raceId = (await db.query<{ id: string }>('select id from races where org_id = $1 limit 1', [orgA])).rows[0]!.id;
    await expect(rpc(BEN, 'select public.setup_race($1, $2::jsonb) as r', [orgA, JSON.stringify(payload(2))])).rejects.toThrow(/not_allowed/);
    await expect(rpc(BEN, 'select public.list_races($1) as r', [orgA])).rejects.toThrow(/not_allowed/);
    await expect(rpc(BEN, 'select public.race_admin($1) as r', [raceId])).rejects.toThrow(/not_allowed/);
    expect(await rpc(BEN, 'select public.my_orgs() as r')).toEqual([expect.objectContaining({ id: orgB })]);
  });

  it('visitors with no account can not call organiser functions', async () => {
    await expect(as(db, { anon: true }, () => db.query('select public.my_orgs()'))).rejects.toThrow(/permission denied/);
    await expect(as(db, { anon: true }, () => db.query('select public.race_json($1)', [randomUUID()]))).rejects.toThrow(/permission denied/);
  });

  it('a link made on the race page opens the same race for a judge', async () => {
    const raceId = (await db.query<{ id: string }>('select id from races where org_id = $1 limit 1', [orgA])).rows[0]!.id;
    const token = await rpc<string>(ALICE, `select public.create_access_link($1, 'judge', 'Finish line', 24) as r`, [raceId]);
    const snap = await as(db, { anon: true }, async () => (await db.query<{ r: { race: { id: string }; entries: unknown[]; link: { role: string } } }>('select public.race_snapshot($1) as r', [token])).rows[0]!.r);
    expect(snap.race.id).toBe(raceId);
    expect(snap.entries).toHaveLength(60);
    expect(snap.link.role).toBe('judge');
    const admin = await rpc<{ links: { label: string; revokedAt: string | null }[] }>(ALICE, 'select public.race_admin($1) as r', [raceId]);
    expect(admin.links).toEqual([expect.objectContaining({ label: 'Finish line', revokedAt: null })]);
  });
});

describe('race builder storage (PRD 6B)', () => {
  let db: PGlite;
  let orgA: string;

  const rpc = async <T,>(user: string, sql: string, params: unknown[] = []) =>
    as(db, { user }, async () => (await db.query<{ r: T }>(sql, params)).rows[0]!.r);

  beforeAll(async () => {
    db = await freshDb();
    orgA = await rpc<string>(ALICE, `select public.create_org('Gobi', 'gobi') as r`);
    await rpc<string>(BEN, `select public.create_org('Other', 'other') as r`);
  }, 60_000);

  it('saves, updates and lists a gym format, and another gym can not touch it', async () => {
    const body = JSON.stringify({ divisions: soloTemplate.divisions, segments: soloTemplate.segments, targets: soloTemplate.targets });
    const id = await rpc<string>(ALICE, 'select public.save_template($1, null, $2, $3::jsonb) as r', [orgA, 'Winter solo', body]);
    await rpc(ALICE, 'select public.save_template($1, $2, $3, $4::jsonb) as r', [orgA, id, 'Winter solo v2', body]);
    const list = await rpc<{ id: string; name: string; body: { segments: unknown[] } }[]>(ALICE, 'select public.list_templates($1) as r', [orgA]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: 'Winter solo v2' });
    expect(list[0]!.body.segments).toHaveLength(16);

    await expect(rpc(BEN, 'select public.list_templates($1) as r', [orgA])).rejects.toThrow(/not_allowed/);
    await expect(rpc(BEN, 'select public.save_template($1, $2, $3, $4::jsonb) as r', [orgA, id, 'Stolen', body])).rejects.toThrow(/not_allowed/);
    await expect(rpc(ALICE, 'select public.save_template($1, null, $2, $3::jsonb) as r', [orgA, 'HYROX copy', body])).rejects.toThrow(/brand_word/);
    await rpc(ALICE, 'select public.delete_template($1, $2) as r', [orgA, id]);
    expect(await rpc(ALICE, 'select public.list_templates($1) as r', [orgA])).toEqual([]);
  });

  it('a solo race keeps its per division weights, entry types and format name', async () => {
    const text = '1, Lize Botha, WO\n2, Anri Nel, WP\n3, Thabo Zulu, MO\n4, Ruan Smit, MP';
    const p = buildSetupPayload(soloTemplate, { name: 'Winter solo', raceDate: '2026-07-04', venue: 'Gobi' }, parseTeamList(text, ['WO', 'WP', 'MO', 'MP']).entries, {
      lanes: 4,
      intervalMin: 2,
      firstStartAt: Date.UTC(2026, 6, 4, 6),
    });
    const raceId = await rpc<string>(ALICE, 'select public.setup_race($1, $2::jsonb) as r', [orgA, JSON.stringify(p)]);
    const admin = await rpc<RawRace>(ALICE, 'select public.race_admin($1) as r', [raceId]);
    const race = raceFromJson(admin);
    expect(race.template.name).toBe(soloTemplate.name);
    expect(race.template.targets).toHaveLength(soloTemplate.targets.length);
    const sled = race.template.segments.find((s) => s.name === 'Sled push')!;
    const weights = race.template.divisions.map((d) => [d.code, race.template.targets.find((x) => x.segmentId === sled.id && x.divisionId === d.id)?.weight]);
    expect(Object.fromEntries(weights)).toEqual({ WO: 100, WP: 140, MO: 140, MP: 190 });
    expect(race.template.divisions.every((d) => d.entryKind === 'solo' && d.teamSize === 1)).toBe(true);
    expect(race.entries.every((e) => e.kind === 'solo')).toBe(true);
  });

  it('a solo division with a team size other than 1 is refused', async () => {
    const p = buildSetupPayload(soloTemplate, { name: 'Bad', raceDate: '2026-07-04', venue: '' }, [], { lanes: 4, intervalMin: 2, firstStartAt: 0 });
    p.divisions[0]!.teamSize = 2;
    await expect(rpc(ALICE, 'select public.setup_race($1, $2::jsonb) as r', [orgA, JSON.stringify(p)])).rejects.toThrow();
  });
});
