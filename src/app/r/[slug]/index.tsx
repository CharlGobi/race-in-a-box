import { useLocalSearchParams } from 'expo-router';

import { ResultsPage } from '@/public/results-page';

// Older links in the /r/<race link> form still work.
export default function PublicResultsByPath() {
  const { slug, embed, div } = useLocalSearchParams<{ slug: string; embed?: string; div?: string }>();
  return <ResultsPage slug={slug} embed={embed} div={div} />;
}
