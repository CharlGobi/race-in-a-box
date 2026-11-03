import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { makeDemoRace } from '@/core/demo';
import { EventFactory } from '@/core/log';
import { deriveResults } from '@/core/results';
import type { Results } from '@/core/results';
import type { LocalStore } from '@/core/store';
import { AsyncStorageStore } from '@/core/store-async';
import { IndexedDbStore } from '@/core/store-idb';
import type { Race, Role, TimingEvent, TimingPayload } from '@/core/types';

type RaceState = {
  ready: boolean;
  race: Race;
  role: Role;
  setRole: (r: Role) => void;
  deviceId: string;
  events: TimingEvent[];
  results: Results;
  waitingToSend: number;
  serverConnected: boolean;
  persisted: boolean | null;
  record: (payload: TimingPayload, entryId?: string, at?: number) => Promise<TimingEvent>;
  resetRehearsal: () => Promise<void>;
};

const Ctx = createContext<RaceState | null>(null);

function makeStore(): LocalStore {
  return Platform.OS === 'web' ? new IndexedDbStore() : new AsyncStorageStore();
}

async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem('rib:deviceId');
  if (existing) return existing;
  const id = `dev-${Crypto.randomUUID().slice(0, 8)}`;
  await AsyncStorage.setItem('rib:deviceId', id);
  return id;
}

async function getRaceStart(): Promise<number> {
  const raw = await AsyncStorage.getItem('rib:rehearsalStart');
  if (raw) return Number(raw);
  const start = Date.now() + 5 * 60_000;
  await AsyncStorage.setItem('rib:rehearsalStart', String(start));
  return start;
}

export function RaceProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<LocalStore | null>(null);
  const factoryRef = useRef<EventFactory | null>(null);
  const [race, setRace] = useState<Race>(() => makeDemoRace());
  const [ready, setReady] = useState(false);
  const [role, setRoleState] = useState<Role>('judge');
  const [deviceId, setDeviceId] = useState('');
  const [events, setEvents] = useState<TimingEvent[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const buildFactory = useCallback((r: Race, dev: string, who: Role, evs: TimingEvent[]) => {
    const mySeq = Math.max(0, ...evs.filter((e) => e.deviceId === dev).map((e) => e.seq));
    factoryRef.current = new EventFactory(r.id, { deviceId: dev, linkId: `local-${dev}`, role: who }, Crypto.randomUUID, Date.now, mySeq);
  }, []);

  useEffect(() => {
    (async () => {
      const store = makeStore();
      storeRef.current = store;
      const [dev, start, savedRole] = await Promise.all([getDeviceId(), getRaceStart(), AsyncStorage.getItem('rib:role')]);
      const r = makeDemoRace(start);
      const who = (savedRole as Role) || 'judge';
      const evs = await store.all(r.id);
      setRace(r);
      setDeviceId(dev);
      setRoleState(who);
      setEvents(evs);
      buildFactory(r, dev, who, evs);
      if (Platform.OS === 'web') setPersisted(await IndexedDbStore.requestPersistence());
      setReady(true);
    })();
  }, [buildFactory]);

  const setRole = useCallback(
    (who: Role) => {
      setRoleState(who);
      AsyncStorage.setItem('rib:role', who);
      buildFactory(race, deviceId, who, events);
    },
    [buildFactory, race, deviceId, events],
  );

  const record = useCallback(async (payload: TimingPayload, entryId?: string, at?: number) => {
    const ev = factoryRef.current!.make(payload, entryId, at);
    // Saved on the phone before the screen says so.
    await storeRef.current!.put([ev]);
    setEvents((prev) => [...prev, ev]);
    return ev;
  }, []);

  const resetRehearsal = useCallback(async () => {
    const start = Date.now() + 2 * 60_000;
    await AsyncStorage.setItem('rib:rehearsalStart', String(start));
    // A fresh rehearsal gets a new race id, so the old log is kept and never deleted.
    const r = { ...makeDemoRace(start), id: `demo-gobi-${start}` };
    setRace(r);
    const evs = await storeRef.current!.all(r.id);
    setEvents(evs);
    buildFactory(r, deviceId, role, evs);
  }, [buildFactory, deviceId, role]);

  const results = useMemo(() => deriveResults(race, events), [race, events]);
  const waitingToSend = events.filter((e) => !e.serverTs).length;

  const value: RaceState = {
    ready,
    race,
    role,
    setRole,
    deviceId,
    events,
    results,
    waitingToSend,
    serverConnected: false, // Postgres sync arrives with step 2 of the build order.
    persisted,
    record,
    resetRehearsal,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRace(): RaceState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRace outside RaceProvider');
  return v;
}
