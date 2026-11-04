import { deriveResults } from './results';
import type { Results } from './results';
import { raceFromJson, rpc } from './sync-supabase';
import type { RawRace, ServerConfig } from './sync-supabase';
import type { Race, TimingEvent } from './types';

export type PublicRace = {
  race: Race & { raceDate?: string };
  org: { name: string; trialUrl: string | null; poweredBy: boolean };
  results: Results;
};

/** Results for anyone with the race's public link. Built from the timing log, like every other screen. */
export async function loadPublicResults(cfg: ServerConfig, slug: string): Promise<PublicRace> {
  const p = await rpc<RawRace & { org: PublicRace['org']; events: TimingEvent[]; serverNow: number | string }>(cfg, 'public_results', { p_slug: slug });
  const race = raceFromJson(p) as PublicRace['race'];
  const events = p.events.map((e) => ({ ...e, deviceTs: Number(e.deviceTs), serverTs: Number(e.serverTs) }));
  return { race, org: p.org, results: deriveResults(race, events, Number(p.serverNow)) };
}

export async function submitVisitor(cfg: ServerConfig, slug: string, entryCode: string, name: string, contact: string): Promise<void> {
  await rpc(cfg, 'submit_visitor', { p_slug: slug, p_entry_code: entryCode, p_name: name, p_contact: contact, p_consent: true });
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
