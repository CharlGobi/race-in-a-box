import * as Battery from 'expo-battery';
import { useEffect, useState } from 'react';
import { Platform, Share, StyleSheet, Text, View } from 'react-native';

import { useRace } from '@/app-state/race-context';
import { server } from '@/config';
import { checkClock, describeDrift } from '@/core/clock';
import { Btn, C, P, Screen } from '@/ui/kit';

function Line({ label, value, ok }: { label: string; value: string; ok: boolean | null }) {
  return (
    <View style={s.line}>
      <Text style={[s.mark, { color: ok === null ? C.muted : ok ? C.go : C.stop }]}>{ok === null ? 'Not checked' : ok ? 'OK' : 'Fix'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.value}>{value}</Text>
      </View>
    </View>
  );
}

type BatteryInfo = { level: number; charging: boolean } | null | 'unknown';

async function readBattery(): Promise<BatteryInfo> {
  try {
    if (!(await Battery.isAvailableAsync())) return 'unknown';
    const [level, state] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
    if (level < 0) return 'unknown';
    return { level, charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL };
  } catch {
    return 'unknown';
  }
}

export default function Check() {
  const { race, deviceId, events, waitingToSend, serverConnected, online, lastSyncAt, problem, persisted, mode, resetRehearsal, leaveLiveRace } = useRace();
  const [clock, setClock] = useState<{ ok: boolean; text: string } | null>(null);
  const [battery, setBattery] = useState<BatteryInfo>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    readBattery().then((b) => alive && setBattery(b));
    if (server) {
      checkClock(server).then(
        (c) => alive && setClock(describeDrift(c.driftMs)),
        () => alive && setClock({ ok: false, text: 'No signal, so the clock could not be checked. Try again with signal.' }),
      );
    }
    return () => {
      alive = false;
    };
  }, [tick]);

  const batteryLine =
    battery === null
      ? { text: 'Checking', ok: null }
      : battery === 'unknown'
        ? { text: 'This browser does not share the battery level. Charge to full and bring a power bank.', ok: null }
        : {
            text: `${Math.round(battery.level * 100)}%${battery.charging ? ', charging' : ''}.${battery.level < 0.5 && !battery.charging ? ' Charge it before the first heat, or bring a power bank.' : ''}`,
            ok: battery.level >= 0.5 || battery.charging,
          };

  const exportAll = async () => {
    const data = JSON.stringify({ race: race.id, deviceId, exportedAt: new Date().toISOString(), events }, null, 1);
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `race-${race.id}-${deviceId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      await Share.share({ message: data, title: 'Race timing export' });
    }
  };

  return (
    <Screen>
      <P>Run this before the first heat.</P>
      <Line
        label="Phone clock"
        value={server ? (clock ? clock.text : 'Checking against the server') : 'Rehearsal, no server to check against'}
        ok={clock ? clock.ok : null}
      />
      <Line label="Battery" value={batteryLine.text} ok={batteryLine.ok as boolean | null} />
      <Line
        label="Storage"
        value={
          Platform.OS === 'web'
            ? persisted
              ? 'The browser will keep race data'
              : 'The browser may clear data when space is low. Add this page to your home screen.'
            : 'Saved in the app on this phone'
        }
        ok={Platform.OS === 'web' ? persisted : true}
      />
      <Line label="Saved on this phone" value={`${events.length} taps`} ok />
      <Line
        label="Sending"
        value={
          !serverConnected
            ? 'Rehearsal, nothing is sent'
            : problem
              ? problem
              : `${online ? 'Connected' : 'No signal'}. ${waitingToSend} waiting. Last sent ${lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString('en-ZA') : 'not yet'}`
        }
        ok={serverConnected ? online && !problem && waitingToSend === 0 : null}
      />
      <Line label="This phone" value={deviceId} ok={null} />

      <Btn label="Check again" kind="plain" onPress={() => setTick((n) => n + 1)} />
      <Btn label="Export everything" onPress={exportAll} />
      {mode.kind === 'live' ? (
        <Btn label="Leave this race (taps stay on the phone)" kind="plain" onPress={leaveLiveRace} />
      ) : (
        <Btn label="New rehearsal (keeps old data)" kind="plain" onPress={resetRehearsal} />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: 'row', gap: 12, alignItems: 'center', borderBottomWidth: 1, borderColor: C.line, paddingVertical: 10 },
  mark: { width: 96, fontSize: 16, fontWeight: '800' },
  label: { fontSize: 18, fontWeight: '800', color: C.text },
  value: { fontSize: 16, color: C.text },
});
