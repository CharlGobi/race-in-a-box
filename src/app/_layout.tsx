import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { RaceProvider, useRace } from '@/app-state/race-context';
import { C } from '@/ui/kit';

SplashScreen.preventAutoHideAsync();

function Nav() {
  const { ready } = useRace();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: C.bg },
        headerTintColor: C.text,
        headerTitleStyle: { fontWeight: '800' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: C.bg },
      }}>
      <Stack.Screen name="index" options={{ title: 'Race in a Box' }} />
      <Stack.Screen name="start" options={{ title: 'Start a heat' }} />
      <Stack.Screen name="finish" options={{ title: 'Finish line' }} />
      <Stack.Screen name="results" options={{ title: 'Live results' }} />
      <Stack.Screen name="judge" options={{ title: 'Head judge' }} />
      <Stack.Screen name="r/index" options={{ title: 'Results' }} />
      <Stack.Screen name="l/index" options={{ title: 'Race link' }} />
      <Stack.Screen name="r/[slug]/index" options={{ title: 'Results' }} />
      <Stack.Screen name="r/[slug]/[code]" options={{ title: 'Result' }} />
      <Stack.Screen name="check" options={{ title: 'Phone check' }} />
      <Stack.Screen name="l/[token]" options={{ title: 'Race link' }} />
      <Stack.Screen name="admin/index" options={{ title: 'Organiser' }} />
      <Stack.Screen name="admin/new-race" options={{ title: 'New race' }} />
      <Stack.Screen name="admin/race/[id]" options={{ title: 'Race' }} />
      <Stack.Screen name="admin/formats" options={{ title: 'Formats' }} />
      <Stack.Screen name="admin/format" options={{ title: 'Format' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <RaceProvider>
      <StatusBar style="dark" />
      <Nav />
    </RaceProvider>
  );
}
