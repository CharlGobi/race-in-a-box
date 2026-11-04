import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { server } from '@/config';
import { readBody } from '@/core/sync-supabase';

// Organisers sign in with an email link. Judges never do: they use access links.
// The Supabase client is only used for sign in. Data goes through the database
// functions in supabase/migrations, called with the organiser's token.

export const supabase: SupabaseClient | null = server
  ? createClient(server.url, server.anonKey, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'implicit',
      },
    })
  : null;

const PAGES_URL = 'https://charlgobi.github.io/race-in-a-box';

/** A full web address for a path in this app, for links that leave the phone. */
export function appUrl(path: string): string {
  const base = (Constants.expoConfig?.experiments?.baseUrl as string | undefined) ?? '';
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}${base}${path}`;
  return `${process.env.EXPO_PUBLIC_APP_URL || PAGES_URL}${path}`;
}

export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, loading };
}

export async function sendSignInLink(email: string): Promise<string | null> {
  if (!supabase) return 'This build has no server set up yet.';
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: appUrl('/admin'), shouldCreateUser: true },
  });
  return error ? error.message : null;
}

export class AdminError extends Error {}

const MESSAGES: Record<string, string> = {
  not_allowed: 'Your account can not do that for this gym.',
  name_required: 'Give the race a name.',
  duplicate: 'That web address or number is already taken.',
};

/** Call an organiser database function as the signed in user. */
export async function adminRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!server || !supabase) throw new AdminError('This build has no server set up yet.');
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new AdminError('Please sign in again.');
  let res: Response;
  try {
    res = await (server.fetch ?? fetch)(`${server.url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: server.anonKey, Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    throw new AdminError('No signal. Try again when you are connected.');
  }
  if (!res.ok) {
    let message = '';
    try {
      message = String(((await res.json()) as { message?: string }).message ?? '');
    } catch {
      // Not JSON.
    }
    const key = Object.keys(MESSAGES).find((k) => message.includes(k)) ?? (message.includes('unique') ? 'duplicate' : '');
    throw new AdminError(key ? MESSAGES[key]! : message || 'The server had a problem. Try again.');
  }
  return readBody<T>(res);
}
