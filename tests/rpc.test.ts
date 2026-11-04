import { describe, expect, it } from 'vitest';

import { rpc } from '@/core/sync-supabase';

// Found in the live test on 4 November 2026: Supabase answers 204 with an empty
// body for functions that return nothing, and the app reported those as failures.
describe('reading Supabase replies', () => {
  const cfg = (res: () => Response) => ({ url: 'https://x.supabase.co', anonKey: 'k', fetch: (async () => res()) as unknown as typeof fetch });

  it('treats 204 No Content as success', async () => {
    await expect(rpc(cfg(() => new Response(null, { status: 204 })), 'submit_visitor', {})).resolves.toBeNull();
  });

  it('treats an empty 200 as success', async () => {
    await expect(rpc(cfg(() => new Response('', { status: 200 })), 'x', {})).resolves.toBeNull();
  });

  it('still reads JSON replies', async () => {
    await expect(rpc(cfg(() => new Response('{"a":1}', { status: 200 })), 'x', {})).resolves.toEqual({ a: 1 });
  });
});
