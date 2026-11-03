import AsyncStorage from '@react-native-async-storage/async-storage';

import { MemoryStore } from './store';
import type { LocalStore } from './store';
import type { TimingEvent } from './types';

// Phone store for the Expo Go preview. The whole log for a race is one key,
// written after every change. A race is a few thousand small events at most.

export class AsyncStorageStore implements LocalStore {
  private mem = new MemoryStore();
  private loaded = new Set<string>();

  private key(raceId: string) {
    return `rib:events:${raceId}`;
  }

  private async load(raceId: string) {
    if (this.loaded.has(raceId)) return;
    const raw = await AsyncStorage.getItem(this.key(raceId));
    if (raw) await this.mem.put(JSON.parse(raw) as TimingEvent[]);
    this.loaded.add(raceId);
  }

  private async save(raceId: string) {
    await AsyncStorage.setItem(this.key(raceId), JSON.stringify(await this.mem.all(raceId)));
  }

  async put(events: TimingEvent[]) {
    const races = [...new Set(events.map((e) => e.raceId))];
    for (const r of races) await this.load(r);
    await this.mem.put(events);
    for (const r of races) await this.save(r);
  }

  async all(raceId: string) {
    await this.load(raceId);
    return this.mem.all(raceId);
  }

  async pending(raceId: string) {
    await this.load(raceId);
    return this.mem.pending(raceId);
  }

  async markSent(stamps: { id: string; serverTs: number }[]) {
    await this.mem.markSent(stamps);
    for (const r of this.loaded) await this.save(r);
  }
}
