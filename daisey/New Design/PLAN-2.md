# Layout round 2 — calm home, everything one pull away

Scope: `daisey/app/` (v1, morsedero.com/daisey/now/). Mockups 6–10 are the
reference; rebuilt from real data, not copied. Engine, scheduling, skips,
runs, learning untouched. Each step: build → preview screenshots at 390 px
(`test/v1/preview`) → `npm test` (v1 node tests) → commit → push master →
curl-verify live → stop for your phone test.

## Step 0 — global (folded into step 1's commit)
- "Waiting" → "Pending" in every UI label (Tasks fold, Tell Daisey card,
  focus aria text, form). `status: "waiting"` stays. "Waiting on Yuval"
  phrasing stays (it's in mockup 8).
- CSS: no multi-column layout under 600 px. Anything two-column today
  (card + day side by side, `ac04efa`) becomes one column below 600.
  Exception the mockups ask for: the 2-col project grid and the 2 date
  boxes — small tiles inside one column, not page columns.

## 1. Home (mockup 6)
- Header: daisy (petals = done today, no badge; count moves to aria-label)
  + "Daisey" 22/700 | avatar. Clock tile, "X left today"/free line and
  place/energy chips go. Place still pickable in the account menu
  (Places…); energy still corrected through Switch.
- "Good evening, Mor" 22/600.
- Count chips removed.
- Now card full width: dot + "Area · project" one line | size. Title is a
  button → task screen (step 4; until then it opens today's edit dialog).
  Pencil goes. Why = one sentence (reason tags → plain text). Start, then
  Later / Switch / Pending. Peek-in NEXT card (`c528b2d`) goes — Switch
  covers it.
- "After this": next 1–2 items from the calendar + wind-down (day end).
  Night divider between today and tomorrow when the day ends first.
- Night divider component (cream pill, bud icon, "Night · 22:00 – 08:00"
  from Day hours) — one `nightDivider()` in `ui.js`, used everywhere.
- "Needs you: N quick decisions" amber row, only N > 0 (opens step 5;
  until then it opens the existing ask on the card).
- Day timeline (`schedule.js`) and Tasks list (`tasks.js`) leave the home
  screen. Their data moves: projects → pull-up/project screen.
- Bottom resting sheet: handle + "Projects · N projects · N tasks", inside
  it one pill [ + | Tell Daisey… | mic ]. + opens New task / New event
  (existing menu). Floating + gone.

## 2. Pull-up (mockup 7)
- Drag the handle/sheet up (or tap) → full sheet; mini Now bar on top
  ("Now: <task>" + Start). "Projects" + "+ New", 2-col grid of project
  cards in their area colour (area = project's most common area): name,
  open count, one status line ("Next: <top pick in project>" or
  "3 pending · 6 someday"), progress bar (done / all).
- Drag down or tap handle to close. Pointer events, 200 ms snap, no
  animation under reduced motion.

## 3. Project screen (mockup 8)
- Full screen view (history state, so phone Back returns home). Back arrow
  + horizontal chip row (current filled in its colour). Tap chip = switch;
  horizontal swipe on empty space = next/previous. A swipe that starts on a
  task card belongs to the card.
- Project card: name 22, area tag, bar "X of Y done".
- Next (ready, engine order; NOW tag on the current card; size · "n of m
  steps"), "+ Add a task" (new task pre-set to this project), Pending
  (waiting on + initial), Someday N ▸, Done N ▸ (each folds open).
- Swipe card right → green Done reveal → `completeTask` + 5 s Undo toast.
- Tap card → task screen.

## 4. Task screen (mockup 9)
- Bottom sheet over the current view. Project dot + name, title 26
  (editable inline).
- Start (not before) box, then Due box with Deadline/Target tag — both
  open native date pickers; tag toggles kind.
- "Details: size, energy, place" collapsed row → existing guessed chips.
- Steps checklist. **New field** `steps: [{ text, done }]`. First unticked
  step gets "next step" tag and is written to `nextStep`, so the engine and
  the Now card keep working unchanged. Migration: an existing `nextStep`
  becomes step 1.
- Links & notes: **new field** `links: [{ url, label }]`; chips open in a
  new tab; "+ Link or file" takes a URL (Drive/Dropbox link for files).
  Notes = existing `notes`.
- "Worked N sessions · Xh so far" from `starts` / `spentMinutes` (hidden
  at 0). Amber Start at the bottom.
- No status switcher. Delete = quiet line under Start.
- "New task" from + opens the same sheet empty (title focused, Start
  becomes Add). `addtask.js` save/guess logic reused.

## 5. Needs you (mockup 10)
- Full screen, one card at a time, dots, close X. Card: tint, icon,
  question, item, Daisey's suggestion. Primary (amber) / secondary / Ask me
  later. End: "That's everything. Nothing else needs you."
- Sources, in this order:
  1. Calendar event that looks like a task (`caltask.js nextOffer`):
     "Is this a task?" → Yes (create, existing flow) / No, it's an event
     (marks it offered).
  2. Pending past check date: "Still pending?" → Yes, still waiting (moves
     check date +3 d) / No, it's ready (status ready). **New field**
     `checkOn` (date), set to +3 days when a task goes Pending; the
     Pending ask gets an optional "Check again" date.
  3. Weekly Someday pick (existing `somedayDue` rule): "Bring one back?"
     → Bring back / Not this week.
- These asks leave the Now card (calm card). Energy-learning ask stays on
  the card.
- Ask me later = gone for today.

## Last
- DAISEY_SPEC.md "Visual design": home, pull-up, project, task, needs you;
  tick finished v1 items (Someday pick; Pending check).
- Model comment "No repeating tasks" stays.

## Decided (Mor, 2026-10-05)
- Repeat: dropped. Details row = "size, energy, place".
- Day timeline: dropped from the UI; calendar shows only as "After this".
- Overdue sweep: folded into Needs you as source 4 ("Still doing this?"),
  same answers as today's sweep dialog; `sweepdlg` retired.
- Pending check date: `checkOn` = +3 days, editable in the Pending ask.
