import type { LocalStore } from './store';
import type { TimingEvent } from './types';

// IndexedDB store for the web app (PRD section 7).

const DB_NAME = 'race-in-a-box';
const STORE = 'timing_events';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IndexedDbStore implements LocalStore {
  private dbPromise: Promise<IDBDatabase>;

  constructor(private readonly idb: IDBFactory = indexedDB, name = DB_NAME) {
    this.dbPromise = new Promise((resolve, reject) => {
      const open = this.idb.open(name, 1);
      open.onupgradeneeded = () => {
        const os = open.result.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('raceId', 'raceId');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  /** Ask the browser not to clear our data under storage pressure. */
  static async requestPersistence(): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) return await navigator.storage.persist();
    } catch {
      // Not available. The app still works, the system check shows it.
    }
    return false;
  }

  async put(events: TimingEvent[]) {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    for (const ev of events) {
      const existing = (await req(os.get(ev.id))) as TimingEvent | undefined;
      if (!existing) os.put(ev);
      else if (!existing.serverTs && ev.serverTs) os.put({ ...existing, serverTs: ev.serverTs });
    }
    await done(tx);
  }

  async all(raceId: string) {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE, 'readonly');
    const rows = (await req(tx.objectStore(STORE).index('raceId').getAll(raceId))) as TimingEvent[];
    return rows;
  }

  async pending(raceId: string) {
    return (await this.all(raceId)).filter((e) => !e.serverTs);
  }

  async markSent(stamps: { id: string; serverTs: number }[]) {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    for (const s of stamps) {
      const ev = (await req(os.get(s.id))) as TimingEvent | undefined;
      if (ev && !ev.serverTs) os.put({ ...ev, serverTs: s.serverTs });
    }
    await done(tx);
  }
}
