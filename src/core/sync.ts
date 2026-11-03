import { mergeLogs } from './log';
import type { LocalStore } from './store';
import type { TimingEvent } from './types';

/** What a device needs from the server. The real one will sit on Postgres. */
export interface SyncTransport {
  push(events: TimingEvent[]): Promise<{ id: string; serverTs: number }[]>;
  pull(raceId: string): Promise<TimingEvent[]>;
}

export class OfflineError extends Error {
  constructor() {
    super('offline');
  }
}

export type SyncState = { savedOnPhone: number; waitingToSend: number; lastSyncAt?: number; online: boolean };

/** Push what is waiting, then pull what other devices sent. Never drops a local event. */
export async function syncOnce(store: LocalStore, transport: SyncTransport, raceId: string): Promise<SyncState> {
  try {
    const waiting = await store.pending(raceId);
    if (waiting.length) {
      const stamps = await transport.push(waiting);
      await store.markSent(stamps);
    }
    const remote = await transport.pull(raceId);
    await store.put(remote);
    const all = await store.all(raceId);
    return { savedOnPhone: all.length, waitingToSend: all.filter((e) => !e.serverTs).length, lastSyncAt: Date.now(), online: true };
  } catch {
    // Offline or server error. Everything stays on the phone and goes on the next try.
    const all = await store.all(raceId);
    return { savedOnPhone: all.length, waitingToSend: all.filter((e) => !e.serverTs).length, online: false };
  }
}

/** In memory server for tests and rehearsal mode. Merges by id and ignores duplicates. */
export class FakeServer {
  private log: TimingEvent[] = [];
  online = true;
  private clock: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock;
  }

  transport(): SyncTransport {
    return {
      push: async (events) => {
        if (!this.online) throw new OfflineError();
        const serverTs = this.clock();
        const known = new Set(this.log.map((e) => e.id));
        const fresh = events.filter((e) => !known.has(e.id)).map((e) => ({ ...e, serverTs }));
        this.log = mergeLogs(this.log, fresh);
        const byId = new Map(this.log.map((e) => [e.id, e]));
        return events.map((e) => ({ id: e.id, serverTs: byId.get(e.id)!.serverTs! }));
      },
      pull: async (raceId) => {
        if (!this.online) throw new OfflineError();
        return this.log.filter((e) => e.raceId === raceId).map((e) => ({ ...e }));
      },
    };
  }

  events(): TimingEvent[] {
    return this.log.map((e) => ({ ...e }));
  }
}
