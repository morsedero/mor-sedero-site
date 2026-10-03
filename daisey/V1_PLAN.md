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

**After 11:** the one-week test from the spec. Then cutover: move v1 to
`/daisey/`, retire the old pieces listed in section 1, with your approval.
