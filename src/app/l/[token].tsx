import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { useRace } from '@/app-state/race-context';
import { Btn, C, H1, Notice, P, Screen } from '@/ui/kit';

// A judge opens /l/<token> from a QR code or a WhatsApp message. No account, no app.
export default function OpenLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { joinWithLink } = useRace();
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    joinWithLink(token).then((r) => {
      if (cancelled) return;
      if (r.ok) router.replace('/');
      else setError(r.message);
    });
    return () => {
      cancelled = true;
    };
  }, [token, tries, joinWithLink]);

  return (
    <Screen>
      {error ? (
        <>
          <H1>Could not open this race</H1>
          <Notice>{error}</Notice>
          <Btn label="Try again" onPress={() => {
              setError(null);
              setTries((n) => n + 1);
            }} />
        </>
      ) : (
        <>
          <H1>Opening your race</H1>
          <P>Saving the race on this phone so it works without signal.</P>
          <ActivityIndicator size="large" color={C.text} />
        </>
      )}
    </Screen>
  );
}
