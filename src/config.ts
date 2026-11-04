import type { ServerConfig } from '@/core/sync-supabase';

// Public values, safe to ship in the web app. Row level security and the link
// checks in the database are what protect the data.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const server: ServerConfig | null = url && anonKey ? { url, anonKey } : null;
