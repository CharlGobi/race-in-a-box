# Phase 1 plan

Written 3 November 2026 against `prd-v2.md`.

## Audit

Skipped by decision on 3 November 2026. The Gobi Hybrid Games code was not available, so Race in a Box starts fresh from the PRD. The Gobi format lives on as the built in template.

## Platform decision

Expo SDK 58 with Expo Router. The same code serves:

1. The web app that volunteers, judges and athletes open from a link or QR code, as sections 2 and 8 require. No install.
2. Expo Go on the organiser's phone during development.

Native app store builds stay out of scope, as section 2 says.

## Step 1 done: timing core

| PRD | Status |
|---|---|
| 4 Gobi template | Done, with a brand word test |
| 5 TimingEvent, append only | Done |
| 6D Heat builder, kit clash warning | Done, basic. Gobi settings flag a clash at a 3 minute interval |
| 6F Keypad finish, undo, penalties, DNF | Keypad and undo in the app. Penalty and status rules in the core, no screen yet |
| 6F Second device flag | Done in the core, shown to the head judge on results |
| 7 Merge by id, duplicates ignored | Done and tested |
| 7 Head judge wins, later correction wins, both kept | Done and tested |
| 7 Results from the log alone | Done and tested |
| 7 Saved on phone and Sent always visible | Done |
| 7 Export from any device in one tap | Done |
| 11 Network cut 20 minutes, main phone killed, takeover | Passes against an in memory server |

## Step 2 done: server and sync

Hosting: Supabase, London region (decided 3 November 2026).

| PRD | Status |
|---|---|
| 5 Postgres, row level security on `org_id`, UUIDs | Done in `supabase/migrations`. Every table has RLS |
| 6A Cross tenant test on every table | Done. 14 tables, read, change, delete and forged inserts. Checked by breaking RLS on purpose |
| 6A Org signup | Database function `create_org` done. Magic link sign in screen not built |
| 6E Signed, role scoped, expiring links | Done. Only a SHA-256 hash of the token is stored. Role and race come from the link, never the phone |
| 6E Revoked link stops within 5 seconds of reconnecting | Checked on every call. Phones sync every 5 seconds and on reconnect |
| 6E Expired link shows a clear message | Done |
| 7 Server merges by id, duplicates ignored | Done in `push_timing_events` |
| 7 Append only | Updates and deletes blocked by a trigger, even for the server |
| 11 Network cut 20 minutes, main phone killed, takeover | Passes against the real database functions |

The phone opens `/l/<token>`, saves the race on the phone, and works with no signal from then on.

## Next steps, in PRD order

1. Organiser sign in by magic link, create a gym, create a race, and make judge links with a QR code.
2. Race builder screens and saved templates.
3. Entries import from CSV and XLSX with column mapping.
4. Penalty, DNF, DNS, DSQ screens, protest window, one tap delay for later heats, head judge takeover screen.
5. Results page for the public, share card, visitor capture.
6. Volunteers, planning, owner console, billing, privacy.

## Data model

The tables live in `supabase/migrations/20261103000001_init.sql`. The PRD's Event is called `races` in the database and the app, to keep it apart from timing events.

## Open questions

1. Does the head judge need to see the finish keypad on the same phone, or a separate takeover screen?
2. Final product name.
