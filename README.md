# Race in a Box

Offline first race timing for hybrid fitness races. One Expo codebase runs as a web link for volunteers and in Expo Go for previews on a phone. The product brief is `docs/prd-v2.md`.

## What works now

1. Gobi Hybrid Games template: T2M, T2W, T2X, R4M, R4W, R4X, 8 stations, runs of 3 laps of 300 m.
2. Rehearsal race with 60 fake teams in 12 heats of 5 lanes.
3. Start a heat with one tap, and undo it if no team has finished.
4. Finish line: tap as a team crosses to save the time, then type the number. Times that are waiting for a number survive a phone call or a crash.
5. Every tap is an append only timing event saved on the phone first (IndexedDB on the web, AsyncStorage in Expo Go).
6. Live results by division, built from the event log alone. Athletes who chose it show as initials.
7. Head judge corrections win over judges. Two phones more than 2 seconds apart on one finish raise a flag.
8. Phone check screen and a one tap export of everything on the phone.
9. Server in `supabase/migrations`: row level security on every table, judge links, append only timing log.
10. Live mode: open `/l/<token>` and the phone syncs every 5 seconds. With no signal it keeps everything and sends it later.

11. Organiser screens at `/admin`: sign in by email link, set up the gym, create a race from a pasted team list, build heats with a kit clash warning, make judge links with a QR code and WhatsApp button, switch links off, and watch finishes come in.

12. Race builder at `/admin/formats`: any mix of solo, team and relay divisions, runs and stations in any order, targets and weights per division, saved per gym. Ships with the Gobi Hybrid Games format and a solo sim.

13. Entries from a CSV or Excel file with column and division matching, and on the race page: find, edit, swap an athlete, move division, add a late entry, remove.

14. Head judge screen: settle phones that disagree, penalties, DNF, DNS and DSQ with a reason, correct a time, delay later heats, lock a heat, and see which phones are still sending. Heats lock after a protest window the organiser sets.

See `docs/phase-1-plan.md` for what comes next.

## Run it

```bash
npm install
```

```bash
npm test
```

```bash
npx expo start
```

Scan the QR code with Expo Go on your phone. Phone and computer must be on the same Wi-Fi.

## Server setup (once)

1. Create a Supabase project in the London region.
2. In GitHub, Settings, Secrets and variables, Actions:
   1. Variables: `SUPABASE_URL` (Project URL) and `SUPABASE_ANON_KEY` (publishable or anon key).
   2. Secret: `SUPABASE_DB_URL` (Connect, Session pooler connection string with the password filled in).
3. In Supabase, Authentication, URL Configuration: set Site URL to `https://charlgobi.github.io/race-in-a-box/` and add `https://charlgobi.github.io/race-in-a-box/**` under Redirect URLs. Without this the sign in email link goes nowhere.
4. Run the Database workflow once from the Actions tab. After that it runs on every merge that changes a migration.

## Phone preview link

Every push to `main` runs the tests and publishes the web app to GitHub Pages. Turn it on once under Settings, Pages, Source: GitHub Actions. The link is `https://<your-user>.github.io/<repo-name>/`.
