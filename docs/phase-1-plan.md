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

## Step 3 done: organiser screens

| PRD | Status |
|---|---|
| 6A Org signup with email magic link | Done at `/admin` |
| 6B Race builder | Done in step 4 below |
| 6C Entries | Paste a team list (number, name, division). Duplicates and bad lines are named with their line number. CSV and XLSX upload with column mapping is next |
| 6D Heat builder and kit clash warning | Done, by division, with a last finish estimate |
| 6E Links and QR codes | Done. Timekeeper and head judge links, QR, WhatsApp share, switch off |
| 6J Results | Organiser race page shows progress and the fastest teams. Public results page is next |

Every organiser write goes through one database function, so a race is saved whole or not at all.

## Step 4 done: race builder

| PRD | Status |
|---|---|
| 4 Entry types | Solo, team or relay per division, with team size. Solo must be 1 |
| 4 Targets by division | Each run or station has one target for everyone, or a target and weight per division |
| 4 Team rules | Per station: split as they like, share the work, or each does it all |
| 6B Build a race from segments | Add, name, reorder and remove runs, stations and rests. One tap puts a run before every station |
| 6B Save and clone templates | Saved per gym in `race_templates`, with row level security. Built in: Gobi Hybrid Games and a solo sim |
| 6B Test: Gobi format from scratch | Automated test builds it with the builder steps and matches the shipped template |
| 6B Test: solo, 16 segments, different weights | Automated test, and checked by hand in a phone browser down to the weights in the database |
| N No HYROX in any template | Checked in the app and again in the database when saving |

## Step 5 done: entries

| PRD | Status |
|---|---|
| 6C Import CSV or XLSX with column mapping | Done. Columns are guessed from the headings and can be changed. Division names in the file are matched to the race's divisions. Numbers can be given out for you |
| 6C Solo athlete or team | First and last name columns for solo, athlete columns for teams, with a warning when a team has the wrong number of people |
| 6C Manual add, edit, swap athlete, move division | Done on the race page. A late entry can go into a heat. An entry with times can not be removed |
| 6C Test: 150 solo and 60 team entries | Automated, the team file as a real .xlsx. Also checked by hand: 60 teams uploaded through the file picker |
| 6C Reject duplicates with a clear message | Duplicate numbers and the same name twice in a division, each with its spreadsheet row |
| N Collect the minimum | Athlete names stay with the organiser. Judge phones get team names only. A swapped out athlete is deleted |

Judge phones reload the race every minute while they have signal, so late entries and edits reach them.

Known gap: a late entry can take a lane past the race's lane count. The heat builder screen in a later step will show and fix that.

## Next steps, in PRD order

1. Penalty, DNF, DNS, DSQ screens, protest window, one tap delay for later heats, head judge takeover screen.
2. Results page for the public, share card, visitor capture.
3. Volunteers, planning, owner console, billing, privacy.

## Data model

The tables live in `supabase/migrations/20261103000001_init.sql`. The PRD's Event is called `races` in the database and the app, to keep it apart from timing events.

## Open questions

1. Does the head judge need to see the finish keypad on the same phone, or a separate takeover screen?
2. Final product name.
