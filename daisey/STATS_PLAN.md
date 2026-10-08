# Garden — Daisey's progress page (plan, 2026-10-08)

A place to see how each project is growing, how routines are going, and a few
overall numbers. Cute and fun, never a dashboard. Proposal only; nothing built.
Replaces the "Stats tab" idea (time per project today/week/month).

## The idea: your projects are a garden

Daisey is a daisy, so the page is a small garden. Each project is a flower.
Time given to it makes it grow; tasks finished add petals. Routines are the
watering can. Nothing ever wilts or turns red: a project with no time this week
is just a closed bud. Progress shows as growth, never as a shortfall.

## Where it lives

A third chip in the right column beside the Now card (`#side`), under Plan and
Projects: a little flower icon + "Garden". It opens `#gardenPage` in the home
panel, same toggle pattern as Projects (`main.js` syncPanel). No new screen,
no new navigation.

## What's on the page (top to bottom, one scroll on a phone)

1. **Period pills** — Today · Week · Month. Default Week (Sunday–Saturday, as
   routines already count it).
2. **Daisey's one line** — a single friendly sentence, e.g. "Band got 4h this
   week. Your Focus projects had most of your time 🌼". Picks the one most
   interesting fact; never a list.
3. **The garden** — one flower per project in its project colour, Focus
   projects in the front row, then Keep going, then Background (smaller).
   - Stem height = minutes in the period (scaled to the biggest project).
   - Petals = tasks done in the period (cap at 12; "+3" beyond).
   - Zero = closed bud. Inbox isn't a flower.
   - Tap a flower → small sheet: time, tasks done (the list, ticked), what's
     left open, its due date if any. Read-only.
4. **Routines** — one row each: name, the week as 7 dots (done = filled,
   planned on calendar = outline, rest = faint), "2 of 3", and a week streak
   ("4 weeks in a row") only when ≥ 2. Reuses `routine.js` weekState /
   calendarWeek, so it matches what the Now card already says.
5. **Three tiny tiles, max** — Focused time · Tasks done · Days you showed up
   (days with any work). Under them a 7-day row of little daisies whose size is
   that day's time. No axes, no percentages, no charts beyond that.

Rules that keep it calm: max 3 numbers on screen at once; no red, no
"behind", no goals the user didn't set (routines are the only targets, and
they're the user's own); empty states are encouraging ("Plant something —
start any task and it shows up here").

Delight, small: flowers sway gently (same idle bob as the Now card,
reduced-motion respected); a flower blooms with a little pop the first time
the page opens after it gained petals; finishing a routine week puts a tiny
bee on its row.

## The data it needs

Today Daisey only keeps a running `spentMinutes` per task, with no dates, so
"this week" can't be answered. One new thing fixes it:

**A dated work log** — `users/{uid}/log/{YYYY-MM-DD}`, one doc per day:
`{ entries: [{ taskId, project, min, at, done }] }`. Written at the points
that already book time, in `store.js`: `endRun`, `tickBatch`, `endBatch`,
`cancelRun` (kept minutes), and Done without a timer (`finishTask`, min 0,
done true). Project name is copied in so renaming/deleting a task doesn't
lose history. Guest mode uses the same guest-state path as everything else.

**Backfill once** from what exists: each done task's `doneAt` + `spentMinutes`
becomes an estimated entry on its done day (`est: true`). Routine sessions are
already dated in `routine.log`. So the garden isn't empty on day one.

Month reads ≤ 31 small docs; fine.

## Code shape

- `app/js/garden-data.js` — pure: `periodRange`, `byProject(log, period)`,
  `tiles`, `oneLine`. No DOM, so it's testable.
- `app/js/garden.js` — the page (mount/render, flower SVG, sheets).
- `store.js` — `logWork` + `watchLog(range)`; hooks at the write points above.
- CSS in `app.css`; tests `daisey/test/v1/garden.test.mjs`.

## Build order

1. **Work log, invisible** — writes + backfill. Ship first so real data
   starts piling up while the page is being made.
2. **Garden page** — chip, period pills, flowers, flower sheet.
3. **Routines rows + tiles + Daisey's line.**
4. **Delight pass** — sway, bloom, bee. Then, later and only if wanted: a
   Sunday "your week" note, and a gentle nudge when a Focus project got no
   time for N days.

## Decided (Mor, 2026-10-08)

- **Week starts Sunday**, same as routines.
- **Done without a timer → Daisey guesses the time**, never asks. Order of
  evidence: the task's slot in today's approved plan or its booked calendar
  slot, if it ended near Done → that slot's length; else time since the last
  logged work on that day, capped at the task's size; else its size estimate
  minus `spentMinutes` already logged. Logged with `guess: true`; the flower
  sheet shows guessed time with a soft "~". Same act-first rule as the rest of
  the app.

## Open questions for Mor

1. Name — "Garden" is close; candidates in chat.
2. Calendar time that Daisey never timed: count it? (see chat)
