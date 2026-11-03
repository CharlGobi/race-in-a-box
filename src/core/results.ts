import { authority, sortLog, undoneIds } from './log';
import type { Entry, EntryStatus, Race, TimingEvent } from './types';

export type Flag =
  | { kind: 'devices_disagree'; entryId: string; gapMs: number; eventIds: string[] }
  | { kind: 'finish_before_start'; entryId: string; eventId: string }
  | { kind: 'unknown_entry'; eventId: string }
  | { kind: 'no_heat_start'; entryId: string };

export type ResultRow = {
  entry: Entry;
  status: EntryStatus;
  statusReason?: string;
  heatId?: string;
  startAt?: number;
  finishAt?: number;
  penaltyMs: number;
  elapsedMs?: number; // finish minus start plus penalties
  rank?: number; // within division, finished entries only
};

export type Results = { rows: ResultRow[]; flags: Flag[] };

/** Pick the winning event: higher authority first, then the later one. */
function pickLatestByAuthority(events: TimingEvent[]): TimingEvent | undefined {
  return [...events].sort(
    (a, b) => authority(b.actorRole) - authority(a.actorRole) || b.deviceTs - a.deviceTs || b.seq - a.seq,
  )[0];
}

/** Pick the original finish: higher authority first, then the first tap. */
function pickFinish(events: TimingEvent[]): TimingEvent | undefined {
  return [...events].sort(
    (a, b) => authority(b.actorRole) - authority(a.actorRole) || a.deviceTs - b.deviceTs || a.seq - b.seq,
  )[0];
}

/**
 * Results are derived from the timing log alone. Nothing here is stored.
 */
export function deriveResults(race: Race, rawLog: TimingEvent[]): Results {
  const log = sortLog(rawLog.filter((e) => e.raceId === race.id));
  const undone = undoneIds(log);
  const live = log.filter((e) => !undone.has(e.id) && e.payload.kind !== 'undo');
  const flags: Flag[] = [];

  const entryById = new Map(race.entries.map((e) => [e.id, e]));
  const heatOfEntry = new Map<string, string>();
  for (const h of race.heats) for (const s of h.slots) heatOfEntry.set(s.entryId, h.id);

  // Heat starts: the winning start per heat.
  const startsByHeat = new Map<string, TimingEvent[]>();
  for (const ev of live) {
    if (ev.payload.kind !== 'start') continue;
    const list = startsByHeat.get(ev.payload.heatId) ?? [];
    list.push(ev);
    startsByHeat.set(ev.payload.heatId, list);
  }
  const heatStart = new Map<string, number>();
  for (const [heatId, evs] of startsByHeat) {
    // For starts, the highest authority wins and then the first tap.
    const chosen = pickFinish(evs);
    if (chosen) heatStart.set(heatId, chosen.deviceTs);
  }

  const perEntry = new Map<string, TimingEvent[]>();
  for (const ev of live) {
    if (!ev.entryId) continue;
    if (!entryById.has(ev.entryId)) {
      flags.push({ kind: 'unknown_entry', eventId: ev.id });
      continue;
    }
    const list = perEntry.get(ev.entryId) ?? [];
    list.push(ev);
    perEntry.set(ev.entryId, list);
  }

  const rows: ResultRow[] = race.entries.map((entry) => {
    const evs = perEntry.get(entry.id) ?? [];
    const heatId = heatOfEntry.get(entry.id);
    const startAt = heatId ? heatStart.get(heatId) : undefined;

    const finishes = evs.filter((e) => e.payload.kind === 'finish');
    const edits = evs.filter((e) => e.payload.kind === 'edit');
    const statuses = evs.filter((e) => e.payload.kind === 'status');
    const penalties = evs.filter((e) => e.payload.kind === 'penalty');

    // Second device check: any two finishes further apart than the threshold.
    if (finishes.length > 1) {
      const times = finishes.map((f) => f.deviceTs);
      const gap = Math.max(...times) - Math.min(...times);
      if (gap > race.disagreeThresholdMs) {
        flags.push({ kind: 'devices_disagree', entryId: entry.id, gapMs: gap, eventIds: finishes.map((f) => f.id) });
      }
    }

    let finishAt = pickFinish(finishes)?.deviceTs;
    const edit = pickLatestByAuthority(edits);
    if (edit && edit.payload.kind === 'edit') {
      const originalAuthority = Math.max(-1, ...finishes.map((f) => authority(f.actorRole)));
      // A correction applies unless a higher authority recorded the finish itself.
      if (authority(edit.actorRole) >= originalAuthority) finishAt = edit.payload.at;
    }

    const penaltyMs = penalties.reduce(
      (sum, p) => sum + (p.payload.kind === 'penalty' ? p.payload.seconds * 1000 : 0),
      0,
    );

    const statusEv = pickLatestByAuthority(statuses);
    let status: EntryStatus = 'entered';
    let statusReason: string | undefined;
    if (startAt !== undefined) status = 'racing';
    if (finishAt !== undefined) status = 'finished';
    if (statusEv && statusEv.payload.kind === 'status') {
      if (statusEv.payload.status !== 'racing') {
        status = statusEv.payload.status;
        statusReason = statusEv.payload.reason;
      }
    }

    let elapsedMs: number | undefined;
    if (status === 'finished' && finishAt !== undefined) {
      if (startAt === undefined) {
        flags.push({ kind: 'no_heat_start', entryId: entry.id });
      } else if (finishAt < startAt) {
        const f = pickFinish(finishes);
        flags.push({ kind: 'finish_before_start', entryId: entry.id, eventId: f?.id ?? edit?.id ?? '' });
      } else {
        elapsedMs = finishAt - startAt + penaltyMs;
      }
    }

    return { entry, status, statusReason, heatId, startAt, finishAt, penaltyMs, elapsedMs };
  });

  // Rank within division.
  const byDivision = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const list = byDivision.get(r.entry.divisionId) ?? [];
    list.push(r);
    byDivision.set(r.entry.divisionId, list);
  }
  for (const list of byDivision.values()) {
    const ranked = list
      .filter((r) => r.elapsedMs !== undefined)
      .sort((a, b) => a.elapsedMs! - b.elapsedMs! || a.entry.code.localeCompare(b.entry.code, undefined, { numeric: true }));
    ranked.forEach((r, i) => {
      // Equal times share a rank.
      r.rank = i > 0 && ranked[i - 1].elapsedMs === r.elapsedMs ? ranked[i - 1].rank : i + 1;
    });
  }

  return { rows, flags };
}

export function formatElapsed(ms: number | undefined): string {
  if (ms === undefined) return '';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
