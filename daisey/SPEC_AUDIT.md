# Master spec audit (2026-10-06)

The "Daisey — Master Product & UX Specification" checked against what's built,
and the plan that came out of it.

## Decisions (Mor, 2026-10-06)

1. **Daisey log: keep.** It records what happened, in its own calendar, marked
   free; never read as a future commitment.
2. **Project deadlines: stay off** (the 10-06 decision holds; the core test applies).
3. **Plan My Day: yes**, as a Daisey plan only: flexible, adaptive, nothing in
   Google Calendar unless the user explicitly chooses it.
4. **Deep Focus: web-only**, and good at what it can control. No pretend blocking.
5. **Now lines: yes, mockup first.** "Next: 19:30 — Dinner" / "Free: 2h 15m this
   evening", useful rather than informational; exact UI follows the Now card.

And the framing: Reality over plan is the behaviour underneath all of it, with
the server-side active-task state as a core part, not a one-notification fix.

## Progress

- ✅ P0 1. Principles, Reality over plan and the state table in `DAISEY_SPEC.md`.
- ✅ P0 2. Reality over plan, built: `app/js/reality.js` (shared by the Now card
  and `_daisey-lib/notify.js`); the running task in the push snapshot; work
  during an event overrules it on the card and on the server. Tests:
  `test/v1/reality.test.mjs`.
- ✅ P0 3. "Start task" on the gap and booked-slot notifications.
- ✅ P0 4. Header: "N need you", no zero chips.
- ✅ P0 5. Now lines: option A (two rows under the card; Next opens the event, Free opens Schedule).
- ✅ P0 6. Tell Daisey examples.
- ✅ P1 7. Booked slot run into by a meeting: silent unless a real deadline can move today (Needs you, clash.js).
- ✅ P1 8. "I have 30 minutes" (moment.free, counts down) and "Plan my afternoon" (query plan).
- ✅ P1 9. Plan my day: plan.js + plan-view.js on today's Schedule; Daisey-only, recomputed, nothing stored or written.
- P1 10–12: not started (10 project %, 11 Deep Focus web-only, 12 Settings regroup).

Scope: Daisey v1, `daisey/app/` (served at morsedero.com/daisey/now/) and its
functions in `daisey/functions/`. The old `daisey/daisey.html` (morsedero.com/daisey/)
is legacy and out of scope.

## What Daisey is, technically

- **A PWA, not a native app.** Vanilla ES modules, no framework, no bundler for
  the page. Installed to the Android home screen from Chrome. Service worker
  (`app/sw.js`) exists only for install + push; caches nothing.
- **Data:** Firebase Auth (Google) + Firestore. The running task is a Firestore
  doc (`state/now`), so it's shared live across phone and computer.
- **Calendar:** read live through Netlify functions (`daisey-now-calendar*`).
- **Chat:** Gemini Flash-Lite via `functions/daisey-now-chat.js`, returns proposed
  actions; nothing applies without a tap.
- **Push:** Web Push. `daisey-now-morning` runs every 5 min and decides with the
  app's own engine (`_daisey-lib/notify.js`). The server can't read Firestore; it
  sees only a task snapshot the app sends (`app/js/push.js`).
- **Tests:** node tests in `daisey/test/v1/*.test.mjs` (engine, push, focus, chat…).

### The hard constraint: what a web app can't do on Android

A PWA cannot block other apps, stop app switching, turn on Do Not Disturb, see
which app is in front, or read Digital Wellbeing. No browser API exists for any of
these. It **can**: go fullscreen (hides status/nav bars; a swipe exits), hold the
screen awake (Wake Lock), notice when you leave and come back (`visibilitychange`),
and keep its own notifications quiet. Android's built-in **App pinning** and
**Focus mode** do real blocking, but only the user can turn them on; Daisey can
only point to them.

Real blocking needs a native Android app (Kotlin; Accessibility Service or
lock-task mode, DND access), which is a separate project with Play Store policy
limits on Accessibility use. Not something to bolt onto this repo.

### Notification actions

Android Chrome supports up to 2 action buttons on a Web Push notification. A tap
on an action reaches the service worker, which can open/focus Daisey with a
parameter. The SW can't easily write Firestore itself (auth lives in the page), so
"Start task" = open Daisey with `?start=<taskId>` and let the page start it. That
takes about a second; it's the honest version and it reuses the existing Start path.

## Spec → what exists

✅ built · 🟡 partly · ❌ missing · ⚠ conflicts with an earlier decision

| § | Spec asks | Today | |
|---|---|---|---|
| 1 | Answer "what should I do now?" | Now card + three-gate engine with a why line (`engine.js`, `now.js`) | ✅ |
| 2 | "Does this help Daisey decide?" as a permanent rule | DAISEY_SPEC has 5 core rules; this question isn't written down | 🟡 doc only |
| 3–4 | Calendar = constraints, not proof; Plan → Reality → Adapt | Window recomputed from *now* on every render, so the card adapts silently. But a running calendar event is trusted (card goes quiet till it ends; "I'm free now" overrides), and the server trusts event end times (see §8) | 🟡 |
| 5 | Don't pollute Google Calendar | Pencil schedule was dropped 10-05. Writes only on tap (book a slot, chat events) **except** the "Daisey log": every Done is written to a separate "Daisey log" calendar, marked free, on by default (Mor said yes 10-05) | ⚠ decide |
| 6 | Suggested / Planned / Active / Done | Suggested = engine pick (computed). Active = the `state/now` run doc. Done ✅. **Planned** exists only as a booked slot, which *is* a calendar event. Pending and Not now are extra states the spec doesn't name; keep them | 🟡 |
| 7 | Start → Focus; active task stops competing picks | Start → `focusView`, run synced across devices; card stays quiet while running. **But the server doesn't know a task is running**, so a "free gap" push can fire mid-focus suggesting a different task | 🟡 bug |
| 8–9 | Adapt without nagging; ask only when needed | Silent adaptation on the card ✅. Interruptions today are justified ("Still on it?" at 2× plan; Needs you is batched, never pushed). Missing: anything for "the meeting ate my booked slot / deadline at risk". Server can't detect overruns: at 15:00 it pushes "Meeting is over, 1h free" even if you're still in it | 🟡 |
| 10 | Flexible windows, not a timetable | One card, never a timetable ✅. Schedule shows "Free" gaps but says nothing about using them | 🟡 |
| 11 | Now: Right now / Next / Today / Available time | Right now ✅. Next and Today live in the Schedule tab and the "Today" header chip (brief popup). No "2h 15m free tonight → I'd do X" line | 🟡 |
| 12 | Clear counters / empty states | Header shows "☀ Today" next to "✓ 0", which reads as "Today 0" (likely the "0 Today 0"). Needs-you chip hides at 0. Now's empty states already explain themselves ("Nothing fits…", free-day copy, 10-05/10-06) | 🟡 |
| 13 | Tell Daisey as core; dynamic examples | Bar handles add, update, pending, drop, moment, project, done, event, query (next/due/waiting). Placeholder is static "Tell Daisey…". **"Plan my afternoon" and "I have 30 minutes" aren't handled** | 🟡 |
| 14 | Natural-language task creation | ✅ Gemini fills date, time, minutes, deadline vs target; guessed fields are chips | ✅ |
| 15 | Schedule as reasoning; Plan My Day | Schedule = 7-day agenda + Free boxes. No conflicts, no "fits here". Plan My Day not built; pencil schedule (its ancestor) dropped 10-05 | ❌ |
| 16 | Projects: progress, next action, deadline, remaining effort | Grid card: open count, "Next: …", progress bar. Project screen: list in Daisey's order. No % number, no remaining effort. **Project-level date removed on purpose 10-06** ("a date belongs to its task") | 🟡 ⚠ |
| 17 | Don't over-organise | Projects exist only through tasks; no tags/folders. Many task fields, all guessed and hidden under Details | ✅ |
| 18 | "Start task" on notifications with a specific task | No actions at all; payload is title/body/url. Gap and booked pushes name a task; brief, wrap and people don't | ❌ |
| 19 | Keep Start → Focus | ✅ (focus, pause, extend, batches, "Still on it?", hold-to-finish) | ✅ |
| 20–22 | Deep Focus / Zen; exceptions | Not built. See the constraint above | ❌ |
| 23 | AI where smart, UI where fast | Already the split: chat proposes, buttons do | ✅ |
| 24 | Settings grouped Personal/Notifications/Goals/Integrations/Appearance/Data | Settings dialog has Notifications, Weekly goals, Google Calendar, plus theme, day hours, Places, Trello import scattered. Notification kinds: brief, wrap, gap, booked, people | 🟡 |
| 25 | Clarify Places | `places.js`/`where.js`: phone location + named saved places. Home = Home vs Out; other names boost tasks mentioning them while you're there. Label doesn't say that | 🟡 |
| 26 | Now · Schedule · Projects | Already: Now card on top, [Schedule \| Projects] panel below, Tell bar always visible | ✅ |

## Proposed plan

Small steps, each tested and shipped on its own. Order follows the spec's P0 → P1.

### P0

1. **Write the principles down** (doc only). Add the "does this help Daisey
   decide?" test, Reality over plan, and the state glossary (Suggested / Planned /
   Active / Done + Pending / Not now) to `DAISEY_SPEC.md`.
2. **Server stops talking over a running task** (bug). App adds the run (task id,
   started) to the push snapshot; `notify.js` skips gap and booked pushes while a
   run is active. Test in `push.test.mjs`.
3. **"Start task" on notifications.** Gap and booked payloads carry `taskId` and
   one action, "Start task". SW opens/focuses Daisey with `?start=<id>`; the page
   checks the task is still open and nothing else runs, then calls the existing
   Start → Focus. If another task is already running, it opens that focus and
   offers "Switch to X?" instead of switching silently. If the task is gone, the
   plain Now card. Brief, wrap, people: no button.
4. **Header counters.** Give "✓ N" a meaning on sight (e.g. hide at 0, or
   "0 done"), so it no longer reads as "Today 0". Review the remaining empty-state
   copy against §12.
5. **Now: Next + Available time.** Under the card, at most two quiet lines from
   data that already exists: "Next · 19:30 Dinner" and "2 h 15 m free tonight".
   No new panel. Needs a mockup first: the compact card's height was a round-3
   design decision.
6. **Tell Daisey examples.** Rotating placeholder from things it really handles
   ("Remind me to send the mix tomorrow at 10", "What's next?", "Waiting on Yuval
   for the cue"). Only add "I have 30 minutes" / "Plan my afternoon" as examples
   once they work (P1, step 8).

### P1

7. **Booked slot eaten by reality.** If a booked task's slot passes without a
   start (and a calendar event overlapped, or you were in another task), quietly
   drop it back into the pool. Only when it has a real deadline that no longer
   fits: one Needs you item, "Your meeting ran into the trailer. Move it to
   tonight · Keep". No push for this.
8. **Chat: "I have 30 minutes" and "Plan my afternoon".** The first sets the
   window for the card (it's already in the spec as not built). The second returns
   a plan in windows (step 9), shown as a card, nothing written.
9. **Plan My Day = Daisey-only windows.** Morning / afternoon / evening, each with
   its free time and 1–3 tasks ("Afternoon · 2 h free · SFX pass + admin"),
   shown in the Schedule tab's Free boxes. Stored in Firestore as today's plan
   (this is the **Planned** state), re-made silently when tasks or calendar change.
   Writes to Google Calendar only through the existing "Book" tap per task.
10. **Projects:** % done and time left (sum of tasks' remaining size) on the
    project card. Deadline: see decision 2.
11. **Deep Focus (web-honest).** Opt-in from the focus screen. Fullscreen + screen
    awake + Daisey's own pushes silenced + "You left 3 times · 12 min away" on
    return, and a one-time guide to Android App pinning / Focus mode for real
    blocking. A clear Exit. Never shows "apps blocked". The switch lives behind
    one function so a native shell could take over later.
12. **Settings regroup** into Personal (my day, places) · Notifications · Goals ·
    Integrations (Calendar, Trello import) · Appearance · Data. Move, don't add.
    Rename Places with a one-line explainer of what it does.

### P2

Not planned until P0 feels right in daily use.

## Decisions needed from Mor

1. **Daisey log** writes every finished task into a separate, marked-free
   Google calendar automatically. It records reality, not a plan, so it doesn't
   break §5 in spirit. **Recommend: keep.**
2. **Project deadline.** The spec wants one; on 10-06 you removed it ("a date
   belongs to its task"). Option: show the nearest task deadline on the project
   card as derived, not a project field. Keep removed, or show derived?
3. **Plan My Day brings back a version of the pencil schedule** (dropped 10-05),
   but with no calendar writes and no per-minute times. OK?
4. **Deep Focus:** web version only now; a native Android app is a separate,
   later project. OK?
5. **Now screen space:** fine to add two short lines under the card (step 5),
   with a mockup first?
