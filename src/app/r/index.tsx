import { useLocalSearchParams } from 'expo-router';

import { ResultsPage } from '@/public/results-page';
import { ShareCardPage } from '@/public/share-card-page';
import { Notice, Screen } from '@/ui/kit';

// /r?s=<race link>            live results
// /r?s=<race link>&n=<number>  one finisher's share card
// /r?s=<race link>&embed=1     results for a gym's website
export default function PublicRoute() {
  const { s, n, embed, div } = useLocalSearchParams<{ s?: string; n?: string; embed?: string; div?: string }>();
  if (!s) {
    return (
      <Screen status={false}>
        <Notice>This results link is missing its race. Check the link with the organiser.</Notice>
      </Screen>
    );
  }
  return n ? <ShareCardPage slug={s} code={n} /> : <ResultsPage slug={s} embed={embed} div={div} />;
}
