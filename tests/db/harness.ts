import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

// Real Postgres 16 in process. The shim stands in for what Supabase provides:
// the anon and authenticated roles and auth.uid() from the signed in user's token.
const SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

export async function freshDb() {
  const db = new PGlite();
  await db.exec(SHIM);
  const dir = path.resolve(__dirname, '../../supabase/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(path.join(dir, f), 'utf8'));
  }
  return db;
}

/** Run as a signed in user, as an anonymous visitor (link holder), or as the server. */
export async function as<T>(db: PGlite, who: { user?: string; anon?: boolean }, fn: () => Promise<T>): Promise<T> {
  if (who.user) {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${who.user}', false);`);
  } else if (who.anon) {
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
  }
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
