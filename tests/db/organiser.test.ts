import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildSetupPayload, parseTeamList } from '@/core/race-setup';
import { gobiTemplate } from '@/core/templates/gobi';

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
