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

## Next steps, in PRD order

1. Server: Postgres with row level security on `org_id` (Supabase is the likely host, to be confirmed). Org signup by magic link. Cross tenant test on every table.
2. Real sync: the `SyncTransport` interface in `src/core/sync.ts` gets a Postgres implementation. The tests in `tests/sync.test.ts` run against it unchanged.
3. Race builder screens and saved templates.
4. Entries import from CSV and XLSX with column mapping.
5. Signed, expiring access links and QR codes per role. Revoke within 5 seconds of reconnecting.
6. Penalty, DNF, DNS, DSQ screens, protest window, one tap delay for later heats, head judge takeover screen.
7. Results page for the public, share card, visitor capture.
8. Volunteers, planning, owner console, billing, privacy.

## Data model migrations (first cut)

Every table has `id uuid primary key` and `org_id uuid not null` with a row level security policy on `org_id`.

1. `orgs`, `org_members`
2. `events`, `divisions`, `segments`, `segment_targets`
3. `entries`, `athletes`, `entry_members`, `heats`, `heat_slots`
4. `timing_events`: insert only. Updates and deletes revoked for every role. Unique on `id`.
5. `access_links`: role, event, scope, expiry, revoked_at
6. `audit_log`

## Open questions

1. Hosting: Supabase in which region (Cape Town is not offered, closest is likely Europe or Mumbai)?
2. Does the head judge need to see the finish keypad on the same phone, or a separate takeover screen?
3. Final product name.
