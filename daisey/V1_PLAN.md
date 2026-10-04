# Daisey v1 — build plan

Companion to `DAISEY_SPEC.md`. Written 2026-10-03. One checklist item per
session; stop after each so Mor can test.

---

## 1. Keep, change, or rebuild?

**Rebuild from scratch. Leave the old Daisey running, untouched, until v1 passes
its test week.**

Why:

- **Nothing load-bearing carries over.** The old app's data lives in Trello; v1
  owns its tasks in Firebase. The old app is a calendar-block planner; v1 is a
  single-card rule engine. The old auth is hand-rolled OAuth with server
  cookies and Netlify Blobs; v1 uses Firebase sign-in. Data layer, auth and UI
  model all change, so "changing" the old app would mean deleting nearly all of
  it while dodging what's left.
- **The old file is ~9,000 lines / 600 KB in one HTML file.** v1 should be
  small files with the engine as pure, testable code. Starting clean is cheaper
  than untangling.
- **You use the old one now.** Building alongside it means no day without a
  working tool.

**What does carry over (ideas, not code):**

- Netlify Functions as the server (already set up, already deploys).
- The "build at deploy time" pattern in `netlify.toml`.
- Plain Node test scripts (no framework).
- `daisey/functions/_daisey-lib/gcal.js` as a reference for event parsing.

**Retire later (after the test week, with your approval, not before):**
Trello webhook, `audio-sync.js` (still writes to Trello every 30 min), the old
Google/Trello OAuth functions, the old `daisey.html`, and the memory notes about
artifact publishing.

---

## 2. File structure

New code lives in `daisey/app/`. Old files stay where they are until cutover.

```
daisey/
  app/                      ← v1 source, served as-is (no bundler)
    index.html              shell: card area + chat bar
    css/app.css             logical properties (start/end) so RTL just works
    js/
      main.js               boot: sign-in → load data → show card
      firebase.js           Firebase init, sign-in/out, Firestore handles
      store.js              task read/write, live sync listeners
      model.js              task fields, defaults, size/energy guesses, repeats
      engine.js             PURE: read moment → filter → score → why line
      weights.js            every tunable number from the spec, in one place
      energy.js             energy guess (correction → recent events → pattern)
      learn.js              turns the action log into learned fit + size fixes
      calendar.js           Calendar read access token + free window
      chat.js               chat bar, sends to server, renders confirm cards
      voice.js              hold-to-talk, Hebrew + English
      i18n.js               all UI strings, he + en
      ui/card.js            Now card, Not now reasons, Something else
      ui/timer.js           running timer, Done / Stop flow
      ui/confirm.js         confirm card (✓ / edit field / ✕)
  functions/
    daisey-now-chat.js      NEW: checks sign-in, calls Gemini, returns actions
  test/v1/                  node tests for engine, model, energy, learn
  build-app.js              copies app/ into site/daisey/now/ at deploy
```

**Where it's served:** `morsedero.com/daisey/now/` during the build. Moves to
`/daisey/` at cutover.

**Data in Firestore** (each user sees only their own):

```
users/{uid}/tasks/{taskId}     one doc per task (spec's fields + auto fields)
users/{uid}/log/{entryId}      every start, skip+reason, finish, energy fix
users/{uid}/state/now          running timer, session skips, energy correction
users/{uid}/state/settings     language, draining-event tags
```

Learning reads the log rather than storing pre-baked scores, so weights can be
retuned later without losing history.

---

## 3. What you set up by hand

Do **A–D before session 1**. E–G can wait until the session that needs them.
Console screens move around occasionally; if a button isn't where described,
tell me what you see.

### A. Create the Firebase project (5 min)

1. Go to **console.firebase.google.com**. Sign in as morsedero@gmail.com.
2. Click **Create a project** (or **Add project**).
3. Name: `daisey`. Click **Continue**.
4. Google Analytics: turn the switch **off**. Click **Create project**.
5. Wait for "Your new project is ready", click **Continue**.

Stay on the free **Spark** plan. Don't click any "Upgrade" button. v1 doesn't
need Firebase's paid features (the server part runs on Netlify).

### B. Register the web app (2 min)

1. On the project home page, find the row of round icons under "Get started by
   adding Firebase to your app". Click the **`</>`** (Web) icon.
2. App nickname: `daisey-web`. Leave "Firebase Hosting" **unticked**.
   Click **Register app**.
3. You'll see code with `const firebaseConfig = { apiKey: ..., authDomain: ...,
   projectId: ... }`. **Copy that whole `{ ... }` block and paste it to me in
   session 1.** It is not a secret; it's meant to sit in page code. (Security
   comes from the rules in step D.)
4. Click **Continue to console**.

### C. Turn on Google sign-in (3 min)

1. Left menu: **Build → Authentication**. Click **Get started**.
2. Tab **Sign-in method** → click **Google** in the list.
3. Flip **Enable** on. "Project support email": pick morsedero@gmail.com.
   Click **Save**.
4. Tab **Settings** → **Authorized domains** → **Add domain** → type
   `morsedero.com` → **Add**. (`localhost` is already listed; leave it.)

### D. Create the database (3 min)

1. Left menu: **Build → Firestore Database**. Click **Create database**.
2. Edition (if asked): **Standard**.
3. Location: pick **me-west1 (Tel Aviv)** if listed, otherwise **eur3
   (Europe)**. ⚠ This can never be changed later.
4. Choose **Start in production mode** (locks everything; we open only your
   own data in session 1). Click **Create**.
5. In session 1 I'll give you a short rules text. You'll open the **Rules** tab,
   replace what's there, and click **Publish**.

### E. Calendar permission (before session 8, ~10 min)

Firebase quietly created a Google Cloud project with the same name. Calendar
settings live there.

1. Go to **console.cloud.google.com**. Top bar, left: click the project picker
   and choose **daisey**.
2. Search bar at top: type `Google Calendar API` → click it → **Enable**.
3. Left menu (☰): **APIs & Services → OAuth consent screen** (may be labelled
   **Google Auth Platform**).
   - **Audience**: should say *External* and *Testing*. Under **Test users**
     click **Add users** → `morsedero@gmail.com` → **Save**.
   - **Data access** → **Add or remove scopes** → filter for
     `calendar.readonly` → tick `.../auth/calendar.readonly` → **Update** →
     **Save**.
4. Left menu: **Credentials**. Under "OAuth 2.0 Client IDs" click **Web client
   (auto created by Google Service)**.
   - **Authorized JavaScript origins** → **Add URI** → `https://morsedero.com`,
     then **Add URI** → `http://localhost:8888`. Click **Save**.
   - Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and give it
     to me in session 8. Not a secret.

When you first connect the calendar you'll see "Google hasn't verified this
app". Click **Advanced → Go to daisey**. Normal for a personal app. Letting
*other people* use Calendar access later needs Google's verification review
(takes weeks); that's out of v1 scope anyway.

### F. Gemini API key (before session 6, 3 min)

1. Go to **aistudio.google.com**. Sign in.
2. Click **Get API key** (left side or top) → **Create API key**.
3. When asked which project, choose **daisey** (keeps everything together).
4. Copy the key. **Do not paste it to me or into any file.** It goes straight
   into Netlify (step G).

⚠ **Privacy decision for you:** on the free tier, Google may use what you send
Gemini to improve its products. The spec says "nothing is shared". To close
that, enable billing on the `daisey` project in AI Studio (paid tier isn't used
for training). At your volume it's likely cents a month. Your call; v1 works
either way.

### G. Put secrets in Netlify (before session 6, 3 min)

1. Go to **app.netlify.com** → open the morsedero site.
2. **Site configuration → Environment variables → Add a variable → Add a single
   variable**.
3. Add these three, one at a time (tick **Contains secret values** for the
   first):

   | Key | Value |
   | --- | --- |
   | `GEMINI_API_KEY` | the key from F |
   | `FIREBASE_PROJECT_ID` | the `projectId` from B (e.g. `daisey-1a2b3`) |
   | `DAISEY_ALLOWED_EMAILS` | `morsedero@gmail.com` |

   The last one means only you can spend the key during v1. Without it, anyone
   who signs in could run up your Gemini bill.
4. They take effect on the next deploy; nothing else to click.

### Already done on your computer

Node and the Netlify CLI are installed. Local testing runs with `netlify dev`
(serves the site + functions at `http://localhost:8888`). I'll run it for you.

---

## 4. Build order (one per session)

Every session ends with: what to test, then a stop. I ask before each push to
`master` (a push is a deploy). v1 is isolated at `/daisey/now/`, so nothing you
use today is touched.

| # | Session | Needs | You test |
|---|---|---|---|
| 1 | **Sign-in + Firebase storage.** Page with Google sign-in; `build-app.js` + `netlify.toml` change; Firestore rules. A throwaway "note" field proves sync. | A–D | Sign in on computer and phone. Type a note on one, see it on the other within seconds. Sign out → nothing shows. |
| 2 | **Task data model.** `model.js` + `store.js`: all spec fields, defaults, first-pass size/energy guesses. Temporary debug list at `?debug`. Node tests. | — | Add a task with only a title; see project=Inbox, size and energy guessed. Done leaves the list. |
| 3 | **Now engine.** `engine.js` + `weights.js`: filter, score table, tie-break, Something-else variety rule, stale rule, why line. Manual window + energy inputs on the debug page. Urgency: a due turns hard on its own when time left gets tight for the task's size (no stored hard-due field). Node tests for every table row. | — | Set "20 min, low" and see the ranking and why lines change sensibly. |
| 4 | **Now card UI.** Single card, three buttons, Not now reasons, 2–3 alternatives, both empty states, energy chip, he/en switch, full RTL. | — | On phone in Hebrew and English: skip, pick something else, check mixed-language titles read right. |
| 5 | **Timer + Done.** Running state saved in Firestore (survives reload, visible on the other device). Done → "Finished, or more left?". Stop. Real minutes logged. | — | Start on computer, see it running on phone, finish there. |
| 6 | **Server function.** `daisey-now-chat.js`: rejects anyone not signed in or not allow-listed, calls Gemini, returns structured actions only. | F, G | A test button returns parsed actions; signed out it refuses. |
| 7 | **Text chat.** Chat bar, confirm cards (✓ / tap field / ✕), all seven spec examples, one-question-with-buttons when unsure. | — | Say each spec example; add a task in under 15 s. |
| 8 | **Calendar read.** Connect button, today+tomorrow events, free window (cap 180, all-day ignored unless busy, 60 with no calendar). | E | Make an event 40 min from now; card says "40 min free". |
| 9 | **Energy guess.** Correction wins for 3 h; draining events (tags in settings, e.g. "teaching", "שיעור"); bucket average after 5 corrections. | — | Correct energy, reload, see it held; check guess after a long event. |
| 10 | **Learning.** Learned fit from starts/skips, size updates from finish times, too-tired / no-time nudges, Something-else wins, stop-twice → offer split, skipped-5× → "keep, shrink, or drop?". | — | Tests on synthetic history; then a few days of normal use. |
| 11 | **Voice.** Hold-to-talk, Hebrew and English, feeds the same chat path. | — | Hold and speak both languages on phone. Note: works in Chrome (Android, desktop); iPhone Safari support is patchy; Firefox has none. |

**Changed after session 2 (Mor, 2026-10-03):** energy is never asked when
adding a task (set when choosing tasks; how is still open); hard due is
computed, not a field; no repeating tasks; Waiting only by acting on an
existing task; Done tasks leave the list, with a separate Done list "for
satisfaction" later. `model.js`'s header has the same list.

**Changed during session 3 (Mor, 2026-10-03):** two windows, tabs "Now" and
"Tasks". **Now**: the Now card on top (only the current task: title, why,
Not now, Something else), and under it the **day planner** — you give hours
free today, Daisey shows its read-only take on the day (urgent first, as much
as fits, each with why), live as tasks change. The user never picks what
matters; that's the app's job. No popup check-in. **Tasks**: one column per
project, like Google Tasks — circle to complete, "Completed (n)" fold per
column, ⋯ for Waiting / Delete, "+ Add a task" per column; the task on the
Now card is set aside from its column while it's there. "+" floating button
adds a task anywhere. Account is an avatar in the top corner. The ?debug list
is gone. Until the calendar exists, the window is today's hours (60 if none)
and window fit scores 0.

**Energy is gone entirely (Mor, 2026-10-03: "feels pointless").** No energy
field, guess, filter, score factor or UI. Session 9 (energy guess) is
dropped; the spec's energy sections no longer apply.

**Now-screen pass (Mor, 2026-10-03):** the day planner under the card is
gone — Daisey picks one task at a time, never lays out the day. Above the
card, a time-of-day greeting. **Free time is never asked for**: no hours
chips, no manual window. It comes only from the calendar. Calendar read was
pulled forward: `functions/daisey-now-calendar.js` reuses old Daisey's stored
Google token, so step E isn't needed yet — but old Daisey's Google auth must
not be retired until v1 has its own.

**After 11:** the one-week test from the spec. Then cutover: move v1 to
`/daisey/`, retire the old pieces listed in section 1, with your approval.

---

## 5. Spec update build (written 2026-10-04, waiting for OK)

`DAISEY_SPEC.md` was rewritten 2026-10-03/04 (task fields, three-gate engine,
overdue triage, pencil schedule, weekly intents). This section is the gap
between it and the code, then the 7 steps Mor ordered. One step per session;
each ends with node tests, push to `master`, a live check at
`morsedero.com/daisey/now/`, then a stop for a phone test.

### What's built now (vs the new spec)

| Area | Built | Spec wants |
|---|---|---|
| Fields | project, title, size, due + dueTime, notBefore, status, waitingOn, canSplit, notes, counters | + area, type, where, openHours, stakes, dateKind, nextStep |
| Size guess | similar past task → keyword list → **flat 30** (most Trello imports are 30) | guessed from type too, never a flat default |
| Hard due | computed (`TIGHT`: time left vs size) | explicit Deadline / Target per date |
| Filter | done, waiting, stale, not-before, skipped, size | + where, office hours, energy, project block |
| Score | urgency 35/25/20/12/6, window 15/10/6/8, momentum 10/5, neglect ≤10, learned = 0 stub, skip −8 | deadline 35/25/12, target 8/4, stakes ≤15, area balance ≤12, neglect ≤8, energy ≤15, window 12/8/5/6, momentum 8/4, batch 10, learned ±10, skip −8 |
| Variety | by project | by area |
| Why line | plain string; alternatives may repeat the card's line; names not isolated | no repeats; names in `<bdi>` |
| In an event | meeting card + "I'm free now" | same for unrelated events; project-named event → that project's best task |
| Tasks tab | Overdue = any passed date | Overdue = deadlines only; Someday folded at bottom |
| Schedule tab | events + gaps; move/delete/create on primary | + pencil per gap, Accept → "Daisey" calendar, capacity line |
| Intents | none | per-area weekly count |
| Gemini | not wired (no chat function yet) | step 1 uses keyword rules |

The Google token already has the full `calendar` scope and the read function
already reads every calendar, so a "Daisey" calendar needs no new consent.
The read doesn't pass `location` yet (needed for the place guess).

### Decisions (Mor, 2026-10-04)

Answered: 1 energy **back**; 2 OK; 3 n/a; 4 yes; 5 n/a; 6 holidays **computed
for the current year** (Hebrew calendar via `Intl`), not a fixed list; 7 yes;
8 OK; learned fit: **build the simple counters now**; sweep "This week":
**fit it where the schedule has room** (Gemini later, engine-picked day now).
Original proposals below, kept for the record.

### Decisions as proposed

1. **Energy.** The spec and the step list bring it back (Gate 1 High-vs-Low,
   Gate 3 energy fit, chip on the card). On 2026-10-03 Mor removed it
   entirely ("feels pointless"). Proposal: one chip on the card (Low · Medium
   · High), default Medium, tap to correct, held 3 h; each task's energy is
   guessed from type + size, shown as a chip in the form. Alternative: keep
   it out — energy weights sit in `weights.js` at 0, no chip.
2. **Computed hard due goes.** Deadline / Target replaces `TIGHT`; points use
   the spec's day thresholds only.
3. **Where matrix** (now = the place chip; Anywhere = no filter):

   | task \ now | Home | Out |
   |---|---|---|
   | Anywhere, Phone | ✓ | ✓ |
   | Home, Computer | ✓ | ✗ |
   | Out (errand) | ✓ | ✓ |

   Place guess: Home, or Out if an event with a location is running or ended
   in the last 30 min. Correction held 3 h.
4. **Someday** = a new status: never on the card, folded at the bottom of
   Tasks, back to Ready from the sheet.
5. **Drop** in the sweep = status `dropped` (kept for learning, hidden
   everywhere), with Undo. Not a hard delete.
6. **"This week"** in the sweep = target Thursday of this week (end of the
   office week); Thursday–Saturday → next Thursday.
7. **Israeli holidays**: a dated list for 2026–2027 in `weights.js` (Rosh
   Hashana ×2, Yom Kippur, Sukkot 1st, Simchat Torah, Pesach 1st + 7th,
   Shavuot, Independence Day). Edit the list; no settings screen.
8. **Learned fit**: no action log exists yet. Proposal: per (type × time of
   day) start and skip counters in `state/learn`; learned =
   round(10 × (starts − skips) / (starts + skips + 3)). Alternative: stays 0
   until the learning session.
9. **Marking deadlines after migration**: a one-time list "Which of these
   dates are real deadlines?" (checkbox per dated task), plus a
   Deadline/Target chip in the sheet from then on.

### Step 1 — Task fields + migration

- `model.js`: `AREAS`, `TYPES`, `WHERE`, `OPEN_HOURS`, `STAKES`,
  `DATE_KINDS`. Guesses, English + Hebrew word lists (same `hasWord` matcher):
  - type: call/phone/להתקשר → Call; buy/pick up/post office/pharmacy/לקנות/דואר
    → Errand; invoice/form/tax/renew/pay/apply/חשבונית/טופס/לחדש → Admin;
    clean/laundry/fix/cook/לנקות/כביסה/לתקן → Home; meet/dinner/birthday/
    פגישה/יום הולדת → Social; else Deep.
  - where from type: Call → Phone, Errand → Out, Home → Home, Admin/Deep →
    Computer, Social → Anywhere.
  - open hours: Call → Office; Admin naming bank/clinic/insurance/
    municipality/בנק/ביטוח/עירייה/קופת חולים → Office; else Anytime.
  - stakes: pay/fine/rent/tax/קנס/לשלם → Costs money; submit/apply/register/
    הגשה/הרשמה → Deadline penalty; "for X"/"send to X" → Affects someone;
    else Low.
  - area: job/CV/apply/interview/portfolio/משרה/קורות חיים → Job search; else
    from type (Home/Admin/Social); else the project's most common area; else
    Work.
  - size: similar past task → word list → **type default** (Call 15, Admin
    15, Errand 45, Home 30, Social 60, Deep 60).
  - energy (if decision 1 = yes): Deep 60+ → High; Call/Admin/Errand ≤15 →
    Low; else Medium.
- Every guessed field is listed in `guessed`; a title edit re-guesses only
  those; a tap makes it yours.
- `dateKind` defaults to Target. `nextStep`: a sheet field, offered when size
  is 90+; the card shows "Next: …" under the title when set.
- Migration: pure `migrateTask(task, history)` → patch. Runs once per task on
  load (marks `v: 2`), fills missing fields, re-guesses anything still in
  `guessed` (so the flat-30 sizes get real guesses), dates → Target.
- Sheet (`addtask.js`): Title first and focused; under it one row of guess
  chips — Area · Type · Where · Hours · Size · Stakes (· Energy). Tap a chip
  → small picker. Guess = dashed chip, yours = solid. Date with a
  Deadline/Target toggle; project, not before, notes, next step under "More".
- Then the one-time deadline list (decision 9).
- Tests: every guess list, migration, edit re-guess rules.
- **You test:** open Tasks, check guesses on real tasks; add "call the bank"
  → Call · Phone · Office hours · 15 min.

### Step 2 — Overdue triage

- Tasks tab: Overdue = passed **deadlines** only. A passed target shows under
  Today, quietly ("from Oct 1", no colour), scored as a today-target (8) so it
  never grows. Rolled at read time; the stored date isn't rewritten.
- Someday section at the bottom, folded.
- `sweep.js`: sheet, one task at a time, Today · This week · Someday · Drop,
  "3 of 9", Undo on the last answer.
- Offered as a quiet line above the card when passed deadlines > 3 or passed
  targets > 5, at most once a day (`state/settings.sweepOffered`).
- Someday and Dropped never reach the card.
- **You test:** a few old dates → line appears → sweep them.

### Step 3 — Three-gate engine

- `weights.js` rewritten to the spec's numbers; every new number there too
  (office hours Sun–Thu 9–16, holidays, place rules, batch types).
- Moment: window, place, office open/closed, energy, current block, bucket.
- Gate 1 / 2 / 3 exactly as the spec tables. Tie-break: deadline, stakes,
  size.
- Something else: variety by **area**, within 15 points.
- Context line: "45 min free · Home · energy medium (guess)"; place and
  energy are chips, tap to correct.
- Card meta: project · size · where chip (Home / Out / Anywhere).
- Why line: top 2–3 factors, first person, the spec's phrase table plus
  office-hours/stakes/area/energy phrases. Built as parts with names in
  `<bdi>`, so a Hebrew title in an English project (and the reverse) reads in
  order. Card + alternatives deduped: same lead factor → the second leads
  with its next factor; same full line → next phrase.
- Tests: one per table row, dedupe, the bidi DOM shape; Playwright
  screenshots of both mixed-language cases.
- **You test:** card at 10:00 on a weekday vs Friday (calls vanish Friday);
  switch Home/Out; Switch shows no repeated why.

### Step 4 — Project blocks

- Event running whose title matches a project (case-insensitive, equal or
  whole-word contained): Gate 1 keeps only that project, window = until it
  ends, context line "Working on daisey until 14:00".
- Nothing in it fits → "Nothing in daisey fits right now" + "I'm free now".
- Unrelated events: today's meeting card, unchanged.
- **You test:** make an event called "daisey" now → card shows a Daisey task.

### Step 5 — Batches

- Same type in Call · Admin · Errand, 2+ ready that fit the window together
  (top by score, max 5): each earns the batch bonus (10).
- Winner in a batch → card offers it: "Offices are open: 3 calls, ~20 min.
  Together?" with the titles; "Just this one" falls back to the single.
- Start → focus mode as a checklist (`state/now` holds `batch` + `done`);
  time booked per task by when it was ticked.
- **You test:** add 3 calls on a weekday morning.

### Step 6 — Pencil schedule

- Schedule tab, today: each free gap ≥ 20 min gets one faded suggestion from
  an engine run for that gap (its length, office hours then, place guess,
  energy guess after the event before it). A task penciled in an earlier gap
  isn't reused. The current gap's pencil = the Now card.
- Tap → Accept (writes a block to a "Daisey" calendar, found or created by
  the write function; the block carries the task id) · Swap (next candidate)
  · Dismiss (gone for today). Nothing is written without a tap.
- An accepted block, while it's running, puts that task on the card.
- Re-sketches on every task/calendar change (data is already live).
- Capacity line on top: "2 h free today, 8 open. Realistic: 3." — free = gaps
  from now to 22:00; open = ready tasks dated today or earlier; realistic =
  how many fit greedily. "Move the rest" opens the sweep on the ones that
  don't fit.
- **You test:** accept a pencil, see it in Google Calendar under "Daisey".

### Step 7 — Weekly intents

- `state/settings.intents = { area: perWeek }`; a small sheet (account menu)
  with a stepper per area.
- Area balance: the area furthest behind its intent gets 12, others scaled;
  no intents → least done this week (Sun–Sat).
- Tasks tab top: one quiet line, "Job search 1 of 3 · Home 2 of 2". No red,
  no streaks.
- Finally: tick the finished "In v1" items in `DAISEY_SPEC.md`.
