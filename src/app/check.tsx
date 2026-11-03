import { Platform, Share, StyleSheet, Text, View } from 'react-native';

import { useRace } from '@/app-state/race-context';
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

export default function Check() {
  const { race, deviceId, events, waitingToSend, serverConnected, persisted, resetRehearsal } = useRace();

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
      <Line label="Phone clock" value={new Date().toLocaleString('en-ZA')} ok={null} />
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
        value={serverConnected ? `${waitingToSend} waiting to send` : 'No server yet in this rehearsal build'}
        ok={serverConnected ? waitingToSend === 0 : null}
      />
      <Line label="Battery" value="Charge to full and bring a power bank" ok={null} />
      <Line label="This phone" value={deviceId} ok={null} />

      <Btn label="Export everything" onPress={exportAll} />
      <Btn label="New rehearsal (keeps old data)" kind="plain" onPress={resetRehearsal} />
    </Screen>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: 'row', gap: 12, alignItems: 'center', borderBottomWidth: 1, borderColor: C.line, paddingVertical: 10 },
  mark: { width: 96, fontSize: 16, fontWeight: '800' },
  label: { fontSize: 18, fontWeight: '800', color: C.text },
  value: { fontSize: 16, color: C.text },
});
