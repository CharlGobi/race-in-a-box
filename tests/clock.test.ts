import { describe, expect, it } from 'vitest';

import { checkClock, describeDrift } from '@/core/clock';

describe('section 6F: pre race clock check', () => {
  it('works out how far the phone clock is from the server, using the fastest reply', async () => {
    let t = 1_000_000;
    const server = 1_000_000 - 3000; // the phone is 3 seconds fast
    const delays = [400, 40, 200];
    let call = 0;
    const fetchImpl = (async () => {
      const d = delays[call++]!;
      t += d / 2;
      const body = JSON.stringify(server + (t - 1_000_000));
      t += d / 2;
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const res = await checkClock({ url: 'https://x.supabase.co', anonKey: 'k', fetch: fetchImpl }, () => t);
    expect(res.roundTripMs).toBe(40);
    expect(res.driftMs).toBe(3000);
  });

  it('says it in plain words', () => {
    expect(describeDrift(300)).toEqual({ ok: true, text: 'The phone clock matches the server.' });
    expect(describeDrift(4200).text).toBe('The phone clock is 4.2 seconds fast. Turn on automatic date and time in the phone settings.');
    expect(describeDrift(-180_000).text).toMatch(/3 minutes slow/);
  });
});
