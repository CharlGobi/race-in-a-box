import { authority, sortLog, undoneIds } from './log';
import type { Entry, EntryStatus, Race, TimingEvent } from './types';

export type Flag =
  | { kind: 'devices_disagree'; entryId: string; gapMs: number; eventIds: string[] }
  | { kind: 'finish_before_start'; entryId: string; eventId: string }
  | { kind: 'unknown_entry'; eventId: string }
  | { kind: 'no_heat_start'; entryId: string }
  /** A judge changed a result after its heat locked. Ignored, kept in the log. */
  | { kind: 'after_lock'; entryId: string; eventId: string };

export type ResultRow = {
  entry: Entry;
  status: EntryStatus;
  statusReason?: string;
  heatId?: string;
  startAt?: number;
  finishAt?: number;
  penaltyMs: number;
  penalties: { seconds: number; reason: string; eventId: string }[];
  elapsedMs?: number; // finish minus start plus penalties
  rank?: number; // within division, finished entries only
  locked: boolean;
};

export type HeatState = {
  heatId: string;
  number: number;
  /** The planned start after any delays. */
  plannedStartAt: number;
  startAt?: number;
  /** When the last entry in the heat got a finish or a DNF, DNS or DSQ. */
  completeAt?: number;
  lockAt?: number;
  locked: boolean;
};

export type Results = { rows: ResultRow[]; flags: Flag[]; heats: HeatState[] };

const HEAD = authority('head_judge');
const TERMINAL: EntryStatus[] = ['finished', 'DNF', 'DNS', 'DSQ'];

/** Pick the winning event: higher authority first, then the later one. */
function pickLatestByAuthority(events: TimingEvent[]): TimingEvent | undefined {
  return [...events].sort((a, b) => authority(b.actorRole) - authority(a.actorRole) || b.deviceTs - a.deviceTs || b.seq - a.seq)[0];
}

/** Pick the original finish: higher authority first, then the first tap. */
function pickFinish(events: TimingEvent[]): TimingEvent | undefined {
  return [...events].sort((a, b) => authority(b.actorRole) - authority(a.actorRole) || a.deviceTs - b.deviceTs || a.seq - b.seq)[0];
}

/**
 * Results are derived from the timing log alone. Nothing here is stored.
 * `now` decides which heats are locked, so the same log gives the same answer
 * for the same moment on every phone.
 */
export function deriveResults(race: Race, rawLog: TimingEvent[], now: number = Date.now()): Results {
  const log = sortLog(rawLog.filter((e) => e.raceId === race.id));
  const heatOfEntry = new Map<string, string>();
  for (const h of race.heats) for (const s of h.slots) heatOfEntry.set(s.entryId, h.id);

  // Pass 1 on everything, to find when each heat locks.
  let pass = computePass(race, log, heatOfEntry, now);

  // Pass 2: drop changes below head judge made after their heat locked.
  const lockOf = new Map(pass.heats.map((h) => [h.heatId, h.lockAt]));
  const late = log.filter((e) => {
    if (authority(e.actorRole) >= HEAD || !e.entryId) return false;
    if (!['finish', 'edit', 'penalty', 'status', 'undo'].includes(e.payload.kind)) return false;
    const lockAt = lockOf.get(heatOfEntry.get(e.entryId) ?? '');
    return lockAt !== undefined && e.deviceTs > lockAt;
  });
  if (late.length) {
    const lateIds = new Set(late.map((e) => e.id));
    pass = computePass(
      race,
      log.filter((e) => !lateIds.has(e.id)),
      heatOfEntry,
      now,
    );
    pass.flags.push(...late.map((e) => ({ kind: 'after_lock' as const, entryId: e.entryId!, eventId: e.id })));
  }
  return pass;
}

function computePass(race: Race, log: TimingEvent[], heatOfEntry: Map<string, string>, now: number): Results {
  const undone = undoneIds(log);
  const live = log.filter((e) => !undone.has(e.id) && e.payload.kind !== 'undo');
  const flags: Flag[] = [];
  const entryById = new Map(race.entries.map((e) => [e.id, e]));

  // Heat starts: the highest authority wins, then the first tap.
  const startsByHeat = new Map<string, TimingEvent[]>();
  for (const ev of live) {
    if (ev.payload.kind !== 'start') continue;
    const list = startsByHeat.get(ev.payload.heatId) ?? [];
    list.push(ev);
    startsByHeat.set(ev.payload.heatId, list);
  }
  const heatStart = new Map<string, number>();
  for (const [heatId, evs] of startsByHeat) {
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
    const penaltyEvs = evs.filter((e) => e.payload.kind === 'penalty');

    // Second device check. A head judge correction made after the taps settles it.
    if (finishes.length > 1) {
      const times = finishes.map((f) => f.deviceTs);
      const gap = Math.max(...times) - Math.min(...times);
      const lastTap = Math.max(...finishes.map((f) => f.deviceTs));
      const settled = edits.some((e) => authority(e.actorRole) >= HEAD && e.deviceTs >= lastTap);
      if (gap > race.disagreeThresholdMs && !settled) {
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

    const penalties = penaltyEvs.flatMap((p) => (p.payload.kind === 'penalty' ? [{ seconds: p.payload.seconds, reason: p.payload.reason, eventId: p.id }] : []));
    const penaltyMs = penalties.reduce((sum, p) => sum + p.seconds * 1000, 0);

    const statusEv = pickLatestByAuthority(statuses);
    let status: EntryStatus = 'entered';
    let statusReason: string | undefined;
    if (startAt !== undefined) status = 'racing';
    if (finishAt !== undefined) status = 'finished';
    if (statusEv && statusEv.payload.kind === 'status' && statusEv.payload.status !== 'racing') {
      status = statusEv.payload.status;
      statusReason = statusEv.payload.reason;
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

    return { entry, status, statusReason, heatId, startAt, finishAt, penaltyMs, penalties, elapsedMs, rank: undefined, locked: false };
  });

  // Heats: planned start after delays, completion, lock.
  const windowMs = (race.protestWindowMin ?? 15) * 60_000;
  const delays = live.filter((e) => e.payload.kind === 'delay' && authority(e.actorRole) >= HEAD);
  const locks = live.filter((e) => e.payload.kind === 'lock' && authority(e.actorRole) >= HEAD);
  const rowsByHeat = new Map<string, ResultRow[]>();
  for (const r of rows) if (r.heatId) rowsByHeat.set(r.heatId, [...(rowsByHeat.get(r.heatId) ?? []), r]);

  const heats: HeatState[] = race.heats.map((h) => {
    const startAt = heatStart.get(h.id);
    // A delay moves every heat that had not started when it was given.
    const delayMs = delays.reduce((sum, d) => {
      if (d.payload.kind !== 'delay') return sum;
      const started = startAt !== undefined && startAt <= d.deviceTs;
      return started ? sum : sum + d.payload.minutes * 60_000;
    }, 0);
    const hr = rowsByHeat.get(h.id) ?? [];
    let completeAt: number | undefined;
    if (hr.length && hr.every((r) => TERMINAL.includes(r.status))) {
      completeAt = Math.max(
        ...hr.flatMap((r) =>
          (perEntry.get(r.entry.id) ?? []).filter((e) => ['finish', 'status', 'edit'].includes(e.payload.kind)).map((e) => e.deviceTs),
        ),
      );
    }
    const explicit = locks.filter((l) => l.payload.kind === 'lock' && l.payload.heatId === h.id).map((l) => l.deviceTs);
    const candidates = [...explicit, ...(completeAt !== undefined ? [completeAt + windowMs] : [])];
    const lockAt = candidates.length ? Math.min(...candidates) : undefined;
    return { heatId: h.id, number: h.number, plannedStartAt: h.startAt + delayMs, startAt, completeAt, lockAt, locked: lockAt !== undefined && lockAt <= now };
  });
  const lockedHeats = new Set(heats.filter((h) => h.locked).map((h) => h.heatId));
  for (const r of rows) r.locked = !!r.heatId && lockedHeats.has(r.heatId);

  // Rank within division.
  const byDivision = new Map<string, ResultRow[]>();
  for (const r of rows) byDivision.set(r.entry.divisionId, [...(byDivision.get(r.entry.divisionId) ?? []), r]);
  for (const list of byDivision.values()) {
    const ranked = list
      .filter((r) => r.elapsedMs !== undefined)
      .sort((a, b) => a.elapsedMs! - b.elapsedMs! || a.entry.code.localeCompare(b.entry.code, undefined, { numeric: true }));
    ranked.forEach((r, i) => {
      // Equal times share a rank.
      r.rank = i > 0 && ranked[i - 1]!.elapsedMs === r.elapsedMs ? ranked[i - 1]!.rank : i + 1;
    });
  }

  return { rows, flags, heats };
}

/** Which phones have recorded what, and when each was last heard from. */
export function deviceActivity(log: TimingEvent[]): { deviceId: string; role: string; lastAt: number; lastSentAt?: number; count: number }[] {
  const by = new Map<string, { deviceId: string; role: string; lastAt: number; lastSentAt?: number; count: number }>();
  for (const e of log) {
    const d = by.get(e.deviceId) ?? { deviceId: e.deviceId, role: e.actorRole, lastAt: 0, count: 0 };
    d.count++;
    d.lastAt = Math.max(d.lastAt, e.deviceTs);
    if (e.serverTs) d.lastSentAt = Math.max(d.lastSentAt ?? 0, e.serverTs);
    by.set(e.deviceId, d);
  }
  return [...by.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/** "47:05" or "1:02:03" to milliseconds. Undefined when it does not read as a time. */
export function parseElapsed(text: string): number | undefined {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return undefined;
  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, ...nums];
  if (m! > 59 || s! > 59) return undefined;
  return ((h! * 60 + m!) * 60 + s!) * 1000;
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
