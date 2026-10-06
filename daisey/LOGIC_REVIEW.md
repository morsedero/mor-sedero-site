# Daisey v1: logic review (2026-10-06)

Read: `engine.js`, `weights.js`, `model.js`, `triage.js`, `needs.js`, `context.js`,
`day.js`, `store.js`, `now.js` (moment, Later/Pending, render), `focus.js`, `sw.js`,
`daisey-now-chat.js`. A1–A5 fixed 2026-10-06 (same day); the rest is open.

---

## Status (end of 2026-10-06)

Built and live the same day: everything marked ✅. In 9 (smaller ones), fixed: the unused `capacity()` sums (they feed the brief now), "This week" ignoring day hours and holidays, the sweep's "Do it today" nag, Bring back keeping a passed date, and the missing buffer before events (10 min).

Still open:
- B2: overload warning and proposing deadline blocks in the calendar.
- B8: after-the-fact checks ("did the booked slot happen?", "anything from that meeting?").
- From 9: `dueTime` has no UI; holidays still miss the eve-of-holiday early closing and Chol HaMoed.

## A. Bugs: things that silently go wrong today

Ranked by how much they hurt "Daisey as a secretary".

### ✅ 1. A deadline can die quietly in Someday
- `now.js later("someday")` has **no deadline guard** (Tomorrow and This week both have one).
- Someday tasks are outside the sweep: `triage.isOpen` = ready | waiting only.
- The weekly Someday pick shows **one** task, sorted by stakes, not by date.

**Result:** "Pay arnona, deadline 15 Oct" → Not now → never seen again, even after the deadline passes.
**Fix:** a Someday task with a deadline comes back N days before it (or goes into Needs you). Sweep includes someday + deadline.

### ✅ 2. Stale filter hides deadline tasks
- `filterOut`: `skipsSinceStart >= 5` → out, **before** any urgency check.
- The "Still want it?" ask is only a tip under the card. It loses to the Undo toast, the `asked` set is in memory only, and it isn't in Needs you.
- `blockTask` (Pending) calls `skipTask`, so **setting Pending counts as a skip** toward the 5.

**Result:** a deadline task you've dodged 5 times vanishes as the deadline gets close.
**Fix:** never stale-filter a deadline within 7 days; move the stale ask into Needs you; don't count Pending as a skip.

### ✅ 3. Night mode says "Nothing needs you tonight" even when a deadline is due today
`nightView` text is hard-coded. At 22:00 with "submit form, deadline today" still open, Daisey says all clear. Next morning it shows as "deadline passed".
**Fix:** at night, if a deadline today is open, say so (one line, Start allowed).

### ✅ 4. Pending check date ignores the deadline
`checkOn` default = +3 days, always (card, chat, "Still pending? yes"). If a pending task is due in 2 days, Daisey asks *after* it's too late.
**Fix:** `checkOn = min(+3 days, due − 1 day)`.

### ✅ 5. Forgotten timer
No cap on a running timer. If you Start and walk away, the next morning:
- the app is still in focus mode (no suggestions at all),
- Done books 14 h to `spentMinutes`, writes a 14 h event to "Daisey log",
- and `guessSize` uses that real time for every similar future task.

**Fix:** after ~2× the estimate (or 3 h), ask "Still on X?". If there's no answer, cap the booked time at the estimate.

### ✅ 6. Neglect resets every time you skip or edit
`engine.neglect` reads `touchedAt`, which skip, Later, edits and "Still pending? yes" all move. `workedAt` exists for exactly this (context.js says so) but neglect doesn't use it. A task you keep dodging never looks neglected.
**Fix:** `workedAt ?? createdAt`.

### ✅ 7. Engine uses full size, not what's left
`filterOut` and `windowFit` use `task.size`. A 90-min task with 80 min already spent still needs a 90-min window, or a 25+ window if splittable. `capacity()`/`roomOn()` already use `size − spentMinutes`, so the two disagree.

### ✅ 8. Big deadline work starts too late
Deadline points are 0 until 7 days out. A 6-hour, non-splittable job due in 10 days gets no urgency, and it's filtered out of every window under 6 h. There's no "work left vs free hours left before the deadline" check. (The old TIGHT rule was dropped 2026-10-04; nothing replaced it.)

### 9. Smaller ones
- `capacity()` ("2 h free, 8 open, realistic 3") is **dead code**: nothing calls it.
- `dueTime` is supported by the engine, but no UI and no chat action can set it.
- `pickWeekDay` / `roomOn` use the default 08–22 hours, not the user's day hours. The office-day check is Sun–Thu without holidays (the comment says "until the engine brings the holiday list"; it has one now).
- Sweep "Do it today" on a passed deadline keeps `dateKind: deadline`. It's overdue again tomorrow, so it nags daily.
- Bringing a task back from Someday clears `notBefore` but keeps a passed `due`, so it lands straight in the sweep.
- Zero buffer before events: a 60-min task "fills" a 60-min gap and ends exactly when teaching starts. There's no travel time for events with a location either.
- Holidays: no erev-chag early closing, no Chol HaMoed.

---

## B. Secretary gaps: what it should push and suggest

The core problem: **Daisey only speaks when opened.** `sw.js` is a pass-through, and there are no notifications anywhere. A secretary that waits to be asked is a list.

### ✅ 1. Push (highest value)
Options: Web Push (works on an installed iOS PWA), or a Telegram/WhatsApp bot. A scheduled Netlify function already exists (`audio-sync`), so the pattern is known.
- **Morning brief** (at day start): "3 h free today. Deadline: X. Realistic: 3 of 5." `capacity()` already computes it.
- **Gap opening:** "Teaching ended. 45 min free, energy probably low → Y." (Out of v1 scope per spec; this is the case for pulling it in.)
- **Deadline tomorrow and not started.**
- **Booked slot starting now.**
- **Evening wrap** (once, at day end): what got done, and what moves to tomorrow (one tap).

### 2. Overload warning + deadline blocking (spec item, not built)
On Sunday or each morning: deadline work this week vs free hours this week. If it's short, say so early and propose blocks: "Block 90 min Wed 10:00 for mix review?" `createEvent` + `taskId` + bookings already exist. Only the proposer is missing.

### ✅ 3. People, not just tasks
"Waiting on Yuval" is free text that nothing reads back.
- A calendar event with Yuval coming up → "Before your 14:00 with Yuval: 2 things pending on him, 1 thing for him."
- Pending past its check date → **draft the nudge**: a `wa.me` / `mailto` link with a short message. You send it. That's still "propose, never act".

### ✅ 4. Chat can't close the loop
`KINDS` = add, update, waiting, drop, moment, project. Missing:
- **done**: "paid the arnona" should tick it off.
- **query**: "what's due this week?", "what's next?" (spec says not built).
- **event**: "dentist Thu 15:00" should create a calendar event, not a task.
- steps, notes, due time.

### ✅ 5. Capture from anywhere
Add `share_target` to `manifest.webmanifest`. Then you can share a WhatsApp message, email or link into Daisey, and it goes through the Tell Daisey parse. That's the biggest friction cut for "dump it on my secretary".

### ✅ 6. Deferral pattern detection
Later → Tomorrow / This week don't count toward anything. A task pushed to "tomorrow" 6 days running is invisible procrastination. Count deferrals; after 3, ask "Shrink, first step only, or let go?" (in Needs you).

### ✅ 7. Weekly intents (spec, not built)
Without them, area balance is just "least done this week", so job search weighs the same as laundry. One sentence per area in chat is enough.

### 8. After-the-fact checks
- A booked slot passed and the task isn't done → "Did X happen?"
- A calendar event ended → "Anything to add from it?" (one tap, optional). Meetings make tasks; nothing catches them now.

### ✅ 9. Repeats (open decision, flagged only)
v1 says no repeats. A secretary still handles monthly bills and weekly lesson prep. Minimal version that keeps the rule: on Done, "Again next month?" makes one fresh copy. No repeat engine.

---

## C. If only three things

1. **Fix A1–A4.** These are the "Daisey let a deadline slip" bugs, which is the one failure a secretary can't have.
2. **Morning brief + evening wrap as push.** That turns it from pull to push. `capacity()` is half of it already.
3. **Pending → nudge draft + people context before meetings.** This is the thing a list app can't do.
