# Daisey v1: user-behaviour review (2026-10-10)

Things real users do that the app (`daisey/app/js/`) doesn't expect. Found by
reading the code, none fixed yet. Ranked by harm.

## 1. Starting a task while another one runs loses the first one's time
- Task sheet → **Focus** (`addtask.js:433`) → `now.start()` (`now.js:2005`) →
  `begin()` overwrites `run` with no check for a run already going.
- Task A running, open task B, tap Focus: A's minutes are never booked, A stays
  "started", B's timer starts.
- Same task: tap Focus on the task that's already running → timer resets to 0.
- Two devices: Start on the phone overwrites the laptop's run the same way
  (`store.startRun` writes `state/now` whole).
- Fix: in `start()`, if a run exists, end it (`endSession`) first, or ignore when
  it's the same task.

## 2. Undo of a tier move doesn't stick (signed in only)
- `saveProjectTiers` = `setDoc(..., { merge: true })`. Firestore merge is DEEP:
  keys missing from the new `tiers` map stay on the server.
- Project with no tier (Keep going) → drag to Focus → Undo: Undo writes `tiers`
  without that key, server keeps `"focus"`, the snapshot flips it back to Focus.
- Guests work (their merge is shallow), so it won't show in guest testing.
- Same root: rename (`projects.js:318`) leaves the old name in `tiers`/`ranges`;
  a new project with the old name inherits its tier and date range.
- Fix: `deleteField()` for removed keys, or write the projects doc without merge.
- **Fixed 2026-10-10:** `store.js` merged writes use `mergeFields` (each given
  top-level field replaced whole), same as the guest path. Rename saves the
  tiers/ranges maps without the old name. `test/v1/store.test.mjs`.

## 3. Meal answers leak into the next day
- `needs.js:165` saves `mealToday: { date: today, Dinner: … }` with merge, so
  yesterday's `Lunch: "14:00"` stays in the map under today's date.
- Result: today's plan moves Lunch to 14:00 unasked and never asks about Lunch.
- Fix: same as 2 (replace `mealToday` whole).
- **Fixed 2026-10-10:** by the #2 change; `mealToday` is replaced whole.

## 4. Nights past midnight
- Tell Daisey "I can work until 1am": replies "day ends 01:00 today", but
  `dayHours` (`day.js:32`) drops any end before the start. Nothing changes.
- Settings caps day end at 23:59 (`main.js:431`): a day can't cross midnight.
- At 00:30, "Later → Tomorrow" (`now.js:598`) = date + 1, so the task skips the
  whole coming day. Tell's "tomorrow" has the same problem.
- At 00:00 the approved plan and today's Laters vanish (both keyed by date).
- Fix: treat times before day start as the previous day (a "logical day").

## 5. Reopen then Done counts twice
- Sheet **Reopen** (`addtask.js:423`) sets status ready but doesn't remove the
  Done's work-log entry (`unlogDone` only runs from Undo, same session).
- Done again → second entry: Week stats and bloom count the task and its
  minutes twice.
- **Fixed 2026-10-10:** Reopen calls `store.unlogReopened`, which removes the
  newest `d:1` entry for the task from the log docs around `doneAt`.

## 6. Rename a project: it jumps
- Rename updates tasks, names, tiers, range, but not `order` (the dragged
  order), so the project drops to the end of its tier.
- Work-log entries keep the old name (`entry.p`), so history may split
  between old and new names in stats.
- **Fixed 2026-10-10 (order):** rename swaps the name in `order` in place and
  saves it. Old log names still split stats (not fixed).

## 7. "I'm free now" is forgotten
- `freeFrom` is in memory only (`now.js:85`). iOS kills the PWA in the
  background, a reload, or the other device: the card goes back to "busy".

## 8. Deleting the running task
- Delete in the sheet doesn't stop the run: Focus shows "this task" with no
  title, the minutes are lost.

## 9. Offline / two-tab edge cases
- Guest mode, two tabs: no `storage` listener, so tab A never sees tab B's
  changes and acts on a stale list.
- Add a Set-days routine offline: its weekly calendar event is written in
  `addDoc(...).then` (`addtask.js:463`), which only resolves on server ack.
  Close the app before reconnecting and the event is never made.
- Offline device taps Pause / +15 on a run the other device already ended:
  `saveRun` writes `state/now` whole and brings the ended run back on reconnect.
- **Fixed 2026-10-10 (two tabs, Pause/+15):** guest `storage` listener
  re-notifies watchers. `saveRun`/`extendRun` use `updateDoc` (fails on an
  ended run, not-found swallowed); guests check `taskId`. The routine event
  (second bullet) is not fixed.
