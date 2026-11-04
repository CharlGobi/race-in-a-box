import { rpc } from './sync-supabase';
import type { ServerConfig } from './sync-supabase';

export type ClockCheck = { driftMs: number; roundTripMs: number };

/**
 * How far this phone's clock is from the server's. Positive means the phone is
 * ahead. Takes the best of three tries, because a slow reply blurs the answer.
 */
export async function checkClock(cfg: ServerConfig, now: () => number = Date.now): Promise<ClockCheck> {
  let best: ClockCheck | null = null;
  for (let i = 0; i < 3; i++) {
    const t0 = now();
    const server = Number(await rpc<number | string>(cfg, 'server_time', {}));
    const t1 = now();
    const check = { driftMs: Math.round((t0 + t1) / 2 - server), roundTripMs: t1 - t0 };
    if (!best || check.roundTripMs < best.roundTripMs) best = check;
  }
  return best!;
}

/** Plain words for the phone check. Within 1 second is fine for race timing. */
export function describeDrift(driftMs: number): { ok: boolean; text: string } {
  const s = Math.abs(driftMs) / 1000;
  if (s < 1) return { ok: true, text: 'The phone clock matches the server.' };
  const amount = s < 60 ? `${s.toFixed(1)} seconds` : `${Math.round(s / 60)} minutes`;
  return { ok: false, text: `The phone clock is ${amount} ${driftMs > 0 ? 'fast' : 'slow'}. Turn on automatic date and time in the phone settings.` };
}
