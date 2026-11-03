# Race in a Box: Product Requirements Document, version 2

Build brief for Claude Code. Written 2 November 2026.

Working name: Race in a Box. The final name must not contain HYROX, HY, ROX or HRX.

## 0. Read this first

1. This product starts from the timing app built for the Gobi Hybrid Games (31 October 2026, Déjà Vu Equestrian, George, 60 teams). Gobi says it worked perfectly.
2. Before building anything new, audit the existing code. Write down what already works, what is Gobi specific, and what must change for multiple gyms. Do not assume any feature below already exists.
3. Phases are called Phase 1, Phase 2 and Later. Phase 1 is the minimum multi-gym product. Phase 2 adds the ops pack and athlete features.
4. Where this document says "must", an acceptance test follows. Build the tests with the feature.

## 1. Purpose

A white label, offline first web app that lets a gym or organiser run any hybrid fitness race, with solo athletes or teams. It covers planning, delegation, volunteers, race day timing, live results and athlete sharing. It is rented per race or per month. It does not sell tickets.

## 2. Goals and non goals

Goals
- Any hybrid format can be built by the organiser, not by us.
- First time volunteers with no fitness background can use it with no training.
- A race never loses a finish time, even with no signal and a dead phone.
- Each gym sees only its own brand and its own data.
- The owner can run the business from one console.

Non goals
- Entries, ticketing and athlete payments (Entry Ninja and others do this).
- Chip or RFID hardware (leave to partners).
- Native iOS or Android apps.
- Importing or showing official HYROX results.

## 3. Users and permissions

| Role | Can do | Cannot do |
|---|---|---|
| Owner (super admin) | Everything across all gyms, log in as a gym with audit | Nothing blocked, all actions logged |
| Organiser (gym owner) | Build races, plan heats, manage people and tasks, publish results | See other gyms |
| Organiser staff | Edit plan and tasks for assigned races | Billing, delete race |
| Head judge | Approve results, take over timing, resolve protests | Edit plan |
| Judge, timekeeper | See own team or station, tap finish, add penalty, raise issue | See other heats' admin screens |
| Volunteer | Sign up, check in, see own shift and tasks | Anything else |
| Task helper | Open a task link, mark Done, Need help or Can't do | Anything else |
| Athlete, spectator | See race pass, live results, share card | Edit |

Judges, volunteers and helpers never create accounts. They use signed links or QR codes scoped to one role and one race, with an expiry.

## 4. Races it must cover

- Entry types: solo, pairs, relay of any size, team of any size. One entry is one athlete or one team.
- Divisions: gender, age group, weight class, Open or Pro, doubles. Targets (weights, reps, distances) can differ by division.
- Formats: full, half and mini sims with runs and stations, stations only, time cap with reps completed, points.
- Start styles: mass, wave, interval, rolling. Gaps from 1 minute to 30 minutes.
- Judging styles, set per race: a judge follows one team or athlete, or fixed judges stay at a station and look up athlete numbers.
- Splits: off by default, switch on per segment.
- Athlete numbers: arm writing, bib or QR code.
- Gobi template: ship a template matching the Gobi Hybrid Games, including teams of 2 and relay of 4, codes T2M, T2W, T2X, R4M, R4W, R4X, 8 stations and 3 laps of 300 m between stations. Use generic station names.

## 5. Core data model

Use Postgres with row level security on `org_id` for every table. Use UUIDs. Times are stored as UTC with the device's offset.

```ts
type Org = { id; name; plan; brand: { logo; colours; appName; subdomain; emailFrom }; country; currency; poweredBy: boolean }
type Event = { id; orgId; name; date; venue; timezone; templateId; status: 'draft'|'live'|'locked'|'archived'; judgingStyle: 'follow'|'station'; startStyle; splitsOn: boolean }
type Division = { id; eventId; code; label; gender?; ageMin?; ageMax?; weightClass?; level?: 'open'|'pro' }
type Segment = { id; eventId; order; kind: 'run'|'station'|'transition'|'rest'; name; metric: 'distance'|'reps'|'calories'|'time'; timeCap?; timed: boolean }
type SegmentTarget = { segmentId; divisionId; value; weight?; unit }
type Entry = { id; eventId; divisionId; kind: 'solo'|'team'; code; displayName; members: Athlete[]; relayLegs?; status: 'entered'|'checked_in'|'racing'|'finished'|'DNF'|'DNS'|'DSQ' }
type Athlete = { id; name; showAsInitials: boolean; consent: { waiver; publicResults; at }; medicalNoteId? }
type Heat = { id; eventId; number; startAt; slots: { lane; entryId }[] }
type TimingEvent = { id; eventId; deviceId; actorLinkId; kind: 'start'|'finish'|'split'|'undo'|'penalty'|'status'|'edit'; entryId?; segmentId?; deviceTs; serverTs?; seq; payload }   // append only, never updated or deleted
type Task = { id; orgId; eventId; area; title; dueRule: { daysBefore }; dueAt; ownerLinkId?; status: 'todo'|'done'|'need_help'|'cannot'|'overdue'; dependsOn: string[]; generatedBy?: string }
type Decision = { id; eventId; text; madeBy; at; affects: ('task'|'poster'|'briefing'|'results')[] }
type Supplier = { id; eventId; name; role; contact; quote?; depositPaid?; confirmed?; contractFileId? }
type Incident = { id; eventId; kind; at; reportedBy; handledBy?; notes }
type Volunteer = { id; orgId; name; phone; role; shifts: Shift[]; checkedIn?: boolean }
type Plan = { id; orgId; tier: 'free'|'race_small'|'race_standard'|'race_large'|'club'|'series'; limits }
type UsageMeter = { orgId; eventId; entries; devices; messages; at }
type AuditLog = { id; orgId; actor; action; target; at; before?; after? }
```

Results are derived from the TimingEvent log. They are never stored as the source of truth.

## 6. Modules and acceptance tests

### A. Tenancy and white label (Phase 1)
- Org signup with email magic link.
- Branding: logo, colours, app name, login page, email branding, results page.
- Web address: `gymname.<our domain>` in Phase 1. Custom domain is Later.
- Powered by line on the free tier, removable on paid plans.
- Test: a user from org A cannot read or write org B data through any endpoint (automated cross tenant test on every table).

### B. Race builder (Phase 1)
- Build a race from segments, with per division targets and team rules (who does what, split or shared reps).
- Save and clone templates. Include the Gobi template.
- Test: build the Gobi format from scratch in under 30 minutes. Build a solo format with 16 segments and different men's and women's weights.

### C. Entries (Phase 1)
- Import CSV or XLSX with column mapping. Entry is a solo athlete or a team.
- Manual add, edit, swap athlete, move division.
- Test: import 150 solo entries and 60 team entries without error. Reject duplicates with a clear message.

### D. Heats and the day simulator (Phase 1)
- Auto heat builder: by division, lanes available, interval.
- Capacity calculator: entries on course per minute, last finish estimate.
- Clash warnings: two heats arriving at one station or kit group together beyond the lane count.
- Rehearsal mode with fake entries.
- Test: Gobi settings (5 lanes, 60 teams) flag a kit clash when the interval is too short.

### E. Access links (Phase 1)
- Signed, role scoped, expiring links and QR codes. Revoke at any time.
- Judges see only their own team or station.
- Test: a revoked link stops working within 5 seconds of the phone reconnecting. An expired link shows a clear message.

### F. Timing and finish capture (Phase 1)
- Offline first. Every tap writes a TimingEvent to IndexedDB and syncs later.
- Number keypad: stamp the time on tap, then enter the athlete number. Fast tap view for busy solo finishes.
- Second device records the same finishes. Gaps above a set threshold are flagged.
- Head judge takeover if the main phone fails.
- Penalties, DNF, DNS, DSQ with reason. Every edit is a new event with the old value kept.
- Protest window: results lock a set time after each heat.
- One tap delay for all later heats.
- Pre race system check: clock drift, storage, sync, battery.
- Test: cut the network for 20 minutes during a 150 solo athlete race, kill the main phone, restore. Zero lost finish times and a correct final result.

### G. Judging (Phase 1 and 2)
- Phase 1: follow style and station style, per race.
- Phase 2: digital judge sheet with rep and lap counters, no rep reasons.
- Test: a volunteer who has never seen the app records a team finish correctly on the first try, with no instruction beyond the briefing card.

### H. Volunteers (Phase 1 and 2)
- Phase 1: roles and shifts from the heat plan, sign up page, QR check in, briefing card, issue button.
- Phase 2: WhatsApp reminders (SMS and email fallback), relief rota.
- Test: a shift report shows filled, empty and no show counts live.

### I. Planning and delegation (Phase 1 and 2)
Phase 1
- Race plan template: tasks from 12 weeks before to 1 week after, in areas Venue, Permits, Medical, Kit, Judges, Volunteers, Sponsors, Marketing, Food, Results. Includes a forgotten items library.
- Countdown due dates. Changing the race date recalculates every due date.
- Tasks sent by link: WhatsApp message with a signed link. Helper taps Done, Need help or Can't do this. Overdue tasks flag to the organiser, with a gentle reminder first.
- My tasks today: first screen for each helper.
- Ready to race score: a traffic light per area. Checks waivers signed, judges per heat filled, kit against lanes, medic confirmed, permits approved, backup phones charged. Visible the day before.

Phase 2
- Area leads: one owner per area, scoped view.
- Tasks that create tasks: rules such as add station creates test kit task, add sponsor creates collect logo task, add supplier creates confirm booking task.
- Dependencies: heat plan waits for entries to close. Kit count warns when entries need more lanes than owned.
- Decisions log: record change and who made it. A decision can update linked tasks, the briefing and the results page.
- Copy last race: copies tasks, suppliers, volunteers and decisions into a new plan.
- Supplier tracker, day of run sheet with named owners, incident log, debrief notes that become next race tasks.

Later
- Permit tracker, race profit (entry income against costs).

Tests
- Move the race date by 14 days and every due date moves.
- A helper with no account completes a task from a WhatsApp link in under 20 seconds.
- Copy last race produces a plan with zero tasks lost.

### J. Results and sharing (Phase 1)
- Live results page and embeddable widget, filterable by division. Cache at the edge.
- Athletes shown by initials if they chose it.
- Share card with finish time, rank, sponsor logos and a Join a free class button.
- Heat call board and big clock view (Phase 2).

### K. Athlete features (Phase 2)
Race pass link, heat call alerts, family tracker, finish photo, personal results history, next race invite, bring a friend link, team plan helper, feedback, charity link.
- Visitor capture (Phase 1): non members get a Book a trial class button and the gym sees visitors who finished.
- No accounts for under 13s. A parent or the organiser holds consent.

### L. Owner console (Phase 1 and 2)
Phase 1: race day war room (live events, phones online, last sync, errors, finish counts), customers (create, suspend, view, log in as with audit), money (recurring income, renewals, failed payments, free to paid), usage metering, support tools (read only timeline, log export, restore), per gym feature switches, template library, announcements, brand word flag.
Phase 2: growth numbers (time to first event, activation, churn, referral signups), staff roles with money hidden from support, deletion request queue, status page.
- Test: when a phone goes offline during a live event, the war room shows it within 30 seconds.

### M. Billing and plans (Phase 1)
- Free first event, up to 30 entries.
- Race passes by entries: Small 50, Standard 150, Large 400. Over cap per entry fee.
- Club (monthly or yearly), Series (monthly).
- Local currency pricing. Use a seller of record for tax, or a local gateway for rand.
- Plan gating through feature flags. The planning template and Ready to race score are on every plan. Delegation, supplier tracker and race profit are Club and Series.
- Test: a Standard plan race with 151 entries bills the overage and shows it before race day.

Price list (excluding tax, planning rates R16 per US$, R22 per £, R11.50 per A$):

| Plan | South Africa | UK | Australia | US |
|---|---|---|---|---|
| Small race, 50 entries | R750 | £89 | A$149 | $119 |
| Standard, 150 | R1,950 | £199 | A$329 | $249 |
| Large, 400 | R4,500 | £399 | A$649 | $499 |
| Club per month | R490 | £35 | A$59 | $45 |
| Series per month | R1,900 | £129 | A$219 | $169 |
| Extra entry | R10 | £0.90 | A$1.75 | $1.25 |

### N. Safety, privacy and compliance (Phase 1)
- POPIA, UK GDPR, Australian Privacy Act and US state laws. Collect the minimum.
- Medical notes off by default. If on, visible only to the medic role and deleted after the event.
- Waivers store the organiser's acceptance record. The organiser is the responsible party and we are the operator.
- Full export per event and per org.
- Do not use HYROX in any name, domain, template or handle. Use generic station names (ski erg, sled push).
- Test: delete request removes personal data within 30 days and keeps anonymised results if the organiser chooses.

### O. Messaging (Phase 1 and 2)
- WhatsApp templates for task links, heat reminders and results. SMS and email fallback by country. Track message cost per org.

## 7. Offline and sync rules (write the tests first)

- Local store: IndexedDB. Ask the browser for persistent storage.
- Every write is an append only TimingEvent with a unique ID, device ID and sequence number.
- Server merges by ID. Duplicates are ignored. Tombstones for deletes.
- Conflicts: head judge wins over judge. A later correction wins over an earlier one on the same field. Both versions stay in the log.
- The UI always says Saved on phone and Sent. It never hides a pending sync.
- Results rebuild from the log alone.
- Export everything from any device in one tap.

## 8. Usability rules (apply to every volunteer facing screen)

- No account and no app. Open a link and start.
- One job per screen. Home shows the active task.
- Touch targets at least 48 px, 56 px for primary actions. No swipe gestures. Haptic feedback on tap.
- Contrast at least 7:1, dark text on white, no shadows or gradients on text or buttons. Test outside in direct sun.
- Plain words. Say Team finished, not log segment.
- Keep the state if a call or notification interrupts.
- Test on a low cost Android phone from the last five years.

## 9. Non functional

- Core timing screens load in under 2 seconds on a 3G connection after the first visit.
- Results page serves 500 athletes opening the link at once.
- Daily backups and a restore drill. Error tracking. Uptime page.
- Hosting: start in one region. Add regional hosting (UK or EU, Australia, US) later.
- Security: role based access, signed expiring links, audit log, rate limits.

## 10. Build order

Phase 1 (10 to 14 weeks part time)
1. Audit the Gobi code and write the gap list.
2. Tenancy, auth, brand and the cross tenant test.
3. Data model, append only log and sync with conflict tests.
4. Race builder and Gobi template.
5. Entries import, heat builder and simulator.
6. Access links, judge and timekeeper screens, keypad, backup and takeover.
7. Results page, share card and visitor capture.
8. Volunteers and the issue button.
9. Planning: template, due dates, task links, Ready to race.
10. Owner console v1 and billing.
11. Privacy, consent and export.
12. Full tests, then three pilot races.

Phase 2 (8 to 10 weeks)
Volunteer WhatsApp reminders, call board, optional splits, digital judge sheet, athlete features, area leads, task rules, decisions log, copy last race, supplier tracker, run sheet, incident log.

Later
Series boards, athlete profiles across gyms, custom domains, button box, QR or NFC at stations, integrations (Entry Ninja, Octiv, Wodify, Paystack, Stripe, Simvoly, WordPress), permit tracker, race profit.

## 11. Test plan

- Gobi replay: 60 teams, 5 heats, 5 lanes.
- Solo field: 150 athletes, wave starts every 2 minutes, keypad finish.
- Network cut for 20 minutes mid heat. Main phone killed. Head judge takeover.
- Two phones disagree on a finish. The flag appears.
- Cross tenant tests on every table and link type.
- First time volunteer test: five people who have never seen it, no help.
- Sun and old Android test.
- Planning: date shift, task link from WhatsApp, copy last race.
- Load: 500 people open the results link at once.

## 12. Open questions

- What the Gobi code already covers for solo entries and multi gym use (answer from the audit).
- Final product name and registration.
- What HYROX South Africa allows for sim timing tools and event wording.
- Tax treatment of UK business customers, and when to register.
- Hybrid Racing Platform's pricing and whether it works offline.
- Who covers Saturday support.

## 13. Kickoff prompt for Claude Code

Read this PRD. Audit the existing Gobi Hybrid Games timing app and write a gap list against sections 4 to 6. Do not change code yet. Then propose the Phase 1 plan with the order in section 10, the data model migrations, and the sync tests for section 7. Ask me about anything unclear before building.
