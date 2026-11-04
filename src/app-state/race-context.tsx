import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { server } from '@/config';
import { makeDemoRace } from '@/core/demo';
import { EventFactory } from '@/core/log';
import { deriveResults } from '@/core/results';
import type { Results } from '@/core/results';
import type { LocalStore } from '@/core/store';
import { AsyncStorageStore } from '@/core/store-async';
import { IndexedDbStore } from '@/core/store-idb';
import { syncOnce } from '@/core/sync';
import { LINK_MESSAGES, loadRaceSnapshot, SupabaseTransport } from '@/core/sync-supabase';
import type { LinkError, RaceSnapshot } from '@/core/sync-supabase';
import type { Race, Role, TimingEvent, TimingPayload } from '@/core/types';

const SYNC_EVERY_MS = 5000;
// How often a judge phone reloads the race itself, so late entries and edits arrive.
const RACE_REFRESH_MS = 60_000;

export type Mode = { kind: 'rehearsal' } | { kind: 'live'; token: string; link: RaceSnapshot['link'] };

type RaceState = {
  ready: boolean;
  mode: Mode;
  race: Race;
  role: Role;
  setRole: (r: Role) => void;
  deviceId: string;
  events: TimingEvent[];
  results: Results;
  /** Ticks every 15 seconds so heat locks and countdowns move without a tap. */
  now: number;
  waitingToSend: number;
  serverConnected: boolean;
  online: boolean;
  lastSyncAt?: number;
  problem?: string;
  persisted: boolean | null;
  record: (payload: TimingPayload, entryId?: string, at?: number) => Promise<TimingEvent>;
  resetRehearsal: () => Promise<void>;
  joinWithLink: (token: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  leaveLiveRace: () => Promise<void>;
};

const Ctx = createContext<RaceState | null>(null);

const K = {
  deviceId: 'rib:deviceId',
  role: 'rib:role',
  rehearsalStart: 'rib:rehearsalStart',
  link: 'rib:link',
  snapshot: 'rib:snapshot',
};

function makeStore(): LocalStore {
  return Platform.OS === 'web' ? new IndexedDbStore() : new AsyncStorageStore();
}

async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(K.deviceId);
  if (existing) return existing;
  const id = `dev-${Crypto.randomUUID().slice(0, 8)}`;
  await AsyncStorage.setItem(K.deviceId, id);
  return id;
}

async function getRehearsalStart(): Promise<number> {
  const raw = await AsyncStorage.getItem(K.rehearsalStart);
  if (raw) return Number(raw);
  const start = Date.now() + 5 * 60_000;
  await AsyncStorage.setItem(K.rehearsalStart, String(start));
  return start;
}

function roleFromLink(link: RaceSnapshot['link']): Role {
  return link.role === 'head_judge' ? 'head_judge' : link.role === 'judge' ? 'judge' : 'volunteer';
}

export function RaceProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<LocalStore | null>(null);
  const factoryRef = useRef<EventFactory | null>(null);
  const transportRef = useRef<SupabaseTransport | null>(null);
  const syncing = useRef(false);
  const raceLoadedAt = useRef(0);

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'rehearsal' });
  const [race, setRace] = useState<Race>(() => makeDemoRace());
  const [role, setRoleState] = useState<Role>('judge');
  const [deviceId, setDeviceId] = useState('');
  const [events, setEvents] = useState<TimingEvent[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [sync, setSync] = useState<{ online: boolean; lastSyncAt?: number; problem?: string }>({ online: false });

  const buildFactory = useCallback((r: Race, dev: string, who: Role, evs: TimingEvent[]) => {
    const mySeq = Math.max(0, ...evs.filter((e) => e.deviceId === dev).map((e) => e.seq));
    factoryRef.current = new EventFactory(r.id, { deviceId: dev, linkId: `local-${dev}`, role: who }, Crypto.randomUUID, Date.now, mySeq);
  }, []);

  /** Switch the screens to a race and load what this phone already has for it. */
  const activate = useCallback(
    async (r: Race, who: Role, dev: string, nextMode: Mode) => {
      const evs = await storeRef.current!.all(r.id);
      transportRef.current = nextMode.kind === 'live' && server ? new SupabaseTransport(server, nextMode.token) : null;
      setRace(r);
      setRoleState(who);
      setMode(nextMode);
      setEvents(evs);
      setSync({ online: false });
      buildFactory(r, dev, who, evs);
    },
    [buildFactory],
  );

  useEffect(() => {
    (async () => {
      storeRef.current = makeStore();
      const [dev, start, savedRole, token, snapRaw] = await Promise.all([
        getDeviceId(),
        getRehearsalStart(),
        AsyncStorage.getItem(K.role),
        AsyncStorage.getItem(K.link),
        AsyncStorage.getItem(K.snapshot),
      ]);
      setDeviceId(dev);
      if (token && snapRaw) {
        // The race was saved on the phone when the link was opened, so this works with no signal.
        const snap = JSON.parse(snapRaw) as RaceSnapshot;
        await activate(snap.race, roleFromLink(snap.link), dev, { kind: 'live', token, link: snap.link });
      } else {
        await activate(makeDemoRace(start), (savedRole as Role) || 'judge', dev, { kind: 'rehearsal' });
      }
      if (Platform.OS === 'web') setPersisted(await IndexedDbStore.requestPersistence());
      setReady(true);
    })();
  }, [activate]);

  const runSync = useCallback(async () => {
    const t = transportRef.current;
    if (!t || syncing.current || !storeRef.current) return;
    syncing.current = true;
    try {
      const st = await syncOnce(storeRef.current, t, race.id);
      setSync({ online: st.online, lastSyncAt: st.lastSyncAt, problem: st.problem });
      setEvents(await storeRef.current.all(race.id));
      if (st.online && mode.kind === 'live' && server && Date.now() - raceLoadedAt.current > RACE_REFRESH_MS) {
        raceLoadedAt.current = Date.now();
        try {
          const snap = await loadRaceSnapshot(server, mode.token);
          if (snap.race.id === race.id && JSON.stringify(snap.race) !== JSON.stringify(race)) {
            setRace(snap.race);
            await AsyncStorage.setItem(K.snapshot, JSON.stringify(snap));
          }
        } catch {
          // Keep the race the phone already has. The next minute tries again.
        }
      }
    } finally {
      syncing.current = false;
    }
  }, [race, mode]);

  // Sync every few seconds, when the app comes back to the front, and when the browser reconnects.
  useEffect(() => {
    if (mode.kind !== 'live') return;
    runSync();
    const timer = setInterval(runSync, SYNC_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && runSync());
    const onOnline = () => runSync();
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', onOnline);
    return () => {
      clearInterval(timer);
      sub.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    };
  }, [mode.kind, runSync]);

  const setRole = useCallback(
    (who: Role) => {
      if (mode.kind === 'live') return; // In a live race the link decides the role.
      setRoleState(who);
      AsyncStorage.setItem(K.role, who);
      buildFactory(race, deviceId, who, events);
    },
    [mode.kind, buildFactory, race, deviceId, events],
  );

  const record = useCallback(
    async (payload: TimingPayload, entryId?: string, at?: number) => {
      const ev = factoryRef.current!.make(payload, entryId, at);
      // Saved on the phone before the screen says so.
      await storeRef.current!.put([ev]);
      setEvents((prev) => [...prev, ev]);
      if (transportRef.current) setTimeout(runSync, 0);
      return ev;
    },
    [runSync],
  );

  const resetRehearsal = useCallback(async () => {
    const start = Date.now() + 2 * 60_000;
    await AsyncStorage.setItem(K.rehearsalStart, String(start));
    // A fresh rehearsal gets a new race id, so the old log is kept and never deleted.
    await activate({ ...makeDemoRace(start), id: `demo-gobi-${start}` }, role, deviceId, { kind: 'rehearsal' });
  }, [activate, role, deviceId]);

  const joinWithLink = useCallback(
    async (token: string) => {
      if (!server) return { ok: false as const, message: 'This build has no server set up yet.' };
      try {
        const snap = await loadRaceSnapshot(server, token);
        await AsyncStorage.multiSet([
          [K.link, token],
          [K.snapshot, JSON.stringify(snap)],
        ]);
        await activate(snap.race, roleFromLink(snap.link), deviceId, { kind: 'live', token, link: snap.link });
        return { ok: true as const };
      } catch (e) {
        const code = (e as LinkError).code;
        return { ok: false as const, message: code ? LINK_MESSAGES[code] : 'No signal. Open the link again when you have signal.' };
      }
    },
    [activate, deviceId],
  );

  const leaveLiveRace = useCallback(async () => {
    // Taps stay in the phone's store. Only the link is forgotten.
    await AsyncStorage.multiRemove([K.link, K.snapshot]);
    await activate(makeDemoRace(await getRehearsalStart()), 'judge', deviceId, { kind: 'rehearsal' });
  }, [activate, deviceId]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const results = useMemo(() => deriveResults(race, events, Math.max(now, ...events.map((e) => e.deviceTs))), [race, events, now]);
  const waitingToSend = events.filter((e) => !e.serverTs).length;
  const problem = sync.problem ? (LINK_MESSAGES as Record<string, string>)[sync.problem] ?? LINK_MESSAGES.server : undefined;

  const value: RaceState = {
    ready,
    mode,
    race,
    role,
    setRole,
    deviceId,
    events,
    results,
    now,
    waitingToSend,
    serverConnected: mode.kind === 'live' && !!server,
    online: sync.online,
    lastSyncAt: sync.lastSyncAt,
    problem,
    persisted,
    record,
    resetRehearsal,
    joinWithLink,
    leaveLiveRace,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRace(): RaceState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRace outside RaceProvider');
  return v;
}
