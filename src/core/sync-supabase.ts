import { OfflineError } from './sync';
import type { SyncTransport } from './sync';
import type { Race, TimingEvent } from './types';

// Talks to the Postgres functions in supabase/migrations through Supabase's REST endpoint.
// The link token is the only credential a judge phone has.

export class LinkError extends Error {
  constructor(public readonly code: 'link_unknown' | 'link_revoked' | 'link_expired' | 'not_allowed' | 'wrong_race' | 'server') {
    super(code);
  }
}

export const LINK_MESSAGES: Record<LinkError['code'], string> = {
  link_unknown: 'This link is not valid. Ask the organiser for a new one.',
  link_revoked: 'The organiser has switched this link off. Ask them for a new one.',
  link_expired: 'This link has expired. Ask the organiser for a new one.',
  not_allowed: 'This link can not record times.',
  wrong_race: 'These times belong to a different race.',
  server: 'The server had a problem. Your taps are safe on this phone.',
};

export type ServerConfig = { url: string; anonKey: string; fetch?: typeof fetch };

export type RaceSnapshot = {
  link: { id: string; role: 'head_judge' | 'judge' | 'volunteer' | 'helper'; label: string; expiresAt: string };
  race: Race;
};

async function rpc<T>(cfg: ServerConfig, fn: string, body: Record<string, unknown>): Promise<T> {
  const f = cfg.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${cfg.url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      // apikey alone works for both the older anon key and the newer publishable key.
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OfflineError();
  }
  if (!res.ok) {
    let message = '';
    try {
      message = String(((await res.json()) as { message?: string }).message ?? '');
    } catch {
      // Not JSON.
    }
    const code = (['link_unknown', 'link_revoked', 'link_expired', 'not_allowed', 'wrong_race'] as const).find((c) => message.includes(c));
    if (code) throw new LinkError(code);
    if (res.status >= 500 || res.status === 0) throw new OfflineError();
    throw new LinkError('server');
  }
  return (await res.json()) as T;
}

/** PostgREST returns a set of jsonb either as bare values or wrapped in the function name. */
function unwrap<T>(rows: unknown[], fn: string): T[] {
  return rows.map((r) => (r && typeof r === 'object' && fn in (r as object) ? (r as Record<string, T>)[fn] : (r as T)));
}

export class SupabaseTransport implements SyncTransport {
  private cursor = 0;

  constructor(
    private readonly cfg: ServerConfig,
    private readonly token: string,
  ) {}

  async push(events: TimingEvent[]) {
    const out: { id: string; serverTs: number }[] = [];
    for (let i = 0; i < events.length; i += 200) {
      const batch = events.slice(i, i + 200).map((e) => ({
        id: e.id,
        raceId: e.raceId,
        deviceId: e.deviceId,
        entryId: e.entryId ?? null,
        deviceTs: e.deviceTs,
        tzOffsetMin: e.tzOffsetMin,
        seq: e.seq,
        payload: e.payload,
      }));
      const rows = await rpc<{ id: string; server_ts: number | string }[]>(this.cfg, 'push_timing_events', { p_token: this.token, p_events: batch });
      out.push(...rows.map((r) => ({ id: r.id, serverTs: Number(r.server_ts) })));
    }
    return out;
  }

  async pull(raceId: string) {
    const all: TimingEvent[] = [];
    for (;;) {
      const raw = await rpc<unknown[]>(this.cfg, 'pull_timing_events', { p_token: this.token, p_after: this.cursor });
      const rows = unwrap<TimingEvent & { serverSeq: number }>(raw, 'pull_timing_events');
      for (const r of rows) {
        const { serverSeq, ...ev } = r;
        all.push({ ...ev, entryId: ev.entryId ?? undefined, deviceTs: Number(ev.deviceTs), serverTs: Number(ev.serverTs) });
        this.cursor = Math.max(this.cursor, Number(serverSeq));
      }
      if (rows.length < 2000) break;
    }
    return all.filter((e) => e.raceId === raceId);
  }
}

export type RawRace = {
  race: Omit<Race, 'template' | 'entries' | 'heats'> & { raceDate?: string; status?: string };
  divisions: Race['template']['divisions'];
  segments: Race['template']['segments'];
  entries: Omit<Race['entries'][number], 'members'>[];
  heats: { id: string; number: number; startAt: number | string; slots: { lane: number; entryId: string }[] }[];
};

/** Turn the database's race_json shape into the app's Race. */
export function raceFromJson(s: RawRace): Race {
  return {
    ...s.race,
    template: { id: 'server', name: s.race.name, divisions: s.divisions, segments: s.segments, targets: [] },
    entries: s.entries.map((e) => ({ ...e, members: [] })),
    heats: s.heats.map((h) => ({ ...h, startAt: Number(h.startAt) })),
  };
}

export async function loadRaceSnapshot(cfg: ServerConfig, token: string): Promise<RaceSnapshot> {
  const s = await rpc<RawRace & { link: RaceSnapshot['link'] }>(cfg, 'race_snapshot', { p_token: token });
  return { link: s.link, race: raceFromJson(s) };
}
