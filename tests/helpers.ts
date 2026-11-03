import { randomUUID } from 'node:crypto';

import { EventFactory } from '@/core/log';
import { MemoryStore } from '@/core/store';
import type { LocalStore } from '@/core/store';
import type { Role } from '@/core/types';

export function device(raceId: string, deviceId: string, role: Role, clock: () => number, store: LocalStore = new MemoryStore()) {
  const factory = new EventFactory(raceId, { deviceId, linkId: `link-${deviceId}`, role }, randomUUID, clock);
  return { store, factory, deviceId };
}

export function makeClock(start: number) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
      return t;
    },
  };
}
