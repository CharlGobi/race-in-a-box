import type { Role, TimingEvent, TimingPayload } from './types';

// Rules from PRD section 7:
// every write is an append only event with a unique id, device id and sequence number,
// the server merges by id, duplicates are ignored.

export type Actor = { deviceId: string; linkId: string; role: Role };

export class EventFactory {
  private seq: number;

  constructor(
    private readonly raceId: string,
    private readonly actor: Actor,
    private readonly newId: () => string,
    private readonly now: () => number = () => Date.now(),
    startSeq = 0,
  ) {
    this.seq = startSeq;
  }

  make(payload: TimingPayload, entryId?: string, at?: number): TimingEvent {
    this.seq += 1;
    return {
      id: this.newId(),
      raceId: this.raceId,
      deviceId: this.actor.deviceId,
      actorLinkId: this.actor.linkId,
      actorRole: this.actor.role,
      entryId,
      deviceTs: at ?? this.now(),
      tzOffsetMin: -new Date().getTimezoneOffset(),
      seq: this.seq,
      payload,
    };
  }
}

/** Merge any number of logs. Same id means same event, so duplicates are dropped. */
export function mergeLogs(...logs: TimingEvent[][]): TimingEvent[] {
  const byId = new Map<string, TimingEvent>();
  for (const log of logs) {
    for (const ev of log) {
      const existing = byId.get(ev.id);
      // Keep the copy the server has stamped, if any. Content is otherwise identical.
      if (!existing || (!existing.serverTs && ev.serverTs)) byId.set(ev.id, ev);
    }
  }
  return sortLog([...byId.values()]);
}

/** Stable order: device time, then device, then sequence. */
export function sortLog(log: TimingEvent[]): TimingEvent[] {
  return [...log].sort(
    (a, b) => a.deviceTs - b.deviceTs || a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq,
  );
}

const AUTHORITY: Record<Role, number> = {
  owner: 5,
  organiser: 4,
  head_judge: 4,
  staff: 2,
  judge: 2,
  volunteer: 1,
  helper: 0,
};

export function authority(role: Role): number {
  return AUTHORITY[role];
}

/** Ids of events cancelled by an undo. An undo from a lower authority cannot cancel a higher one. */
export function undoneIds(log: TimingEvent[]): Set<string> {
  const byId = new Map(log.map((e) => [e.id, e]));
  const undone = new Set<string>();
  for (const ev of log) {
    if (ev.payload.kind !== 'undo') continue;
    const target = byId.get(ev.payload.targetId);
    if (target && authority(ev.actorRole) >= authority(target.actorRole)) undone.add(target.id);
  }
  return undone;
}
