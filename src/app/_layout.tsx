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
      <Stack.Screen name="check" options={{ title: 'Phone check' }} />
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
