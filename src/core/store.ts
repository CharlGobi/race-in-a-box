import type { TimingEvent } from './types';

/** Local, append only store on the device. */
export interface LocalStore {
  /** Add events. An id that is already stored is ignored, except to record a server stamp. */
  put(events: TimingEvent[]): Promise<void>;
  all(raceId: string): Promise<TimingEvent[]>;
  pending(raceId: string): Promise<TimingEvent[]>;
  markSent(stamps: { id: string; serverTs: number }[]): Promise<void>;
}

export class MemoryStore implements LocalStore {
  private events = new Map<string, TimingEvent>();

  async put(events: TimingEvent[]) {
    for (const ev of events) {
      const existing = this.events.get(ev.id);
      if (!existing) this.events.set(ev.id, { ...ev });
      else if (!existing.serverTs && ev.serverTs) existing.serverTs = ev.serverTs;
    }
  }

  async all(raceId: string) {
    return [...this.events.values()].filter((e) => e.raceId === raceId).map((e) => ({ ...e }));
  }

  async pending(raceId: string) {
    return (await this.all(raceId)).filter((e) => !e.serverTs);
  }

  async markSent(stamps: { id: string; serverTs: number }[]) {
    for (const s of stamps) {
      const ev = this.events.get(s.id);
      if (ev && !ev.serverTs) ev.serverTs = s.serverTs;
    }
  }
}
