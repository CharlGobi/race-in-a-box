import { useLocalSearchParams } from 'expo-router';

import { ShareCardPage } from '@/public/share-card-page';

// Older links in the /r/<race link>/<number> form still work.
export default function ShareCardByPath() {
  const { slug, code } = useLocalSearchParams<{ slug: string; code: string }>();
  return <ShareCardPage slug={slug} code={code} />;
}
