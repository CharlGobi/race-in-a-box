import { useLocalSearchParams } from 'expo-router';

import { OpenLink } from '@/judge/open-link';

// Older links in the /l/<token> form still work.
export default function JudgeLinkByPath() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <OpenLink token={token} />;
}
