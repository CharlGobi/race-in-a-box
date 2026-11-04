import { useLocalSearchParams } from 'expo-router';

import { OpenLink } from '@/judge/open-link';
import { Notice, Screen } from '@/ui/kit';

// /l?t=<token> opens a race on a judge's phone.
export default function JudgeLink() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  if (!t) {
    return (
      <Screen>
        <Notice>This link is missing its code. Ask the organiser to send it again.</Notice>
      </Screen>
    );
  }
  return <OpenLink token={t} />;
}
