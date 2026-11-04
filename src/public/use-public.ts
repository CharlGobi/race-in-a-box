import { useEffect, useState } from 'react';

import { server } from '@/config';
import { loadPublicResults } from '@/core/public';
import type { PublicRace } from '@/core/public';
import { LinkError } from '@/core/sync-supabase';

const REFRESH_MS = 20_000;

/** Public results for a race link, refreshed every 20 seconds while the page is open. */
export function usePublicResults(slug: string): { data: PublicRace | null; error: string | null } {
  const [data, setData] = useState<PublicRace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!server) return;
    let alive = true;
    loadPublicResults(server, slug).then(
      (d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      },
      (e) => {
        if (!alive) return;
        // Keep showing the last results if a refresh fails.
        setError(e instanceof LinkError ? 'These results are not available. Check the link with the organiser.' : 'No signal. Showing the last results we had.');
      },
    );
    return () => {
      alive = false;
    };
  }, [slug, tick]);

  return { data, error: server ? error : 'Results are not set up yet.' };
}
