# Daisey v1 — simulated 3-week user test (2026-10-11)

How it ran: the real app (`daisey/app/`), **guest mode** (real `store.js` on
localStorage), phone viewport 390×844, Playwright fake clock driven from
Mon 12 Oct to Sun 1 Nov. AI (Tell Daisey) and Google Calendar were offline
(guest has neither). Persona: freelance sound designer, ~35 tasks over the
period across 8 projects (client work, job search, admin, home, routines),
plus 3 events. Included a 2-day absence, a 3-day "ignore the app" stretch,
overruns, accidental taps and Hebrew titles.

## What worked

- **Morning proposal** shows up by itself and reflows around a new event
  (lunch at 13:00 moved everything correctly). ✕ on a row, Fewer/More work.
- **Event handling**: "Coming up · In 14 min. Nothing else fits before it",
  then "Now · 34 min left… I'm free now". Clear and calm.
- **Needs-you deck** (Still pending? / Still doing this? / Still want this?)
  looks good and the stale-task card ("Put off 5 times… make it 15 min") is
  the best moment in the app.
- **Later menu** (Later today / Tomorrow / This week / On hold) + reason chips
  (Too big / Not here) in the toast. Pending sheet is simple.
- **Focus mode** is clean. Hebrew titles render fine. Delete has an inline
  "Really delete?". Reopen exists for an accidental Done.
- **Night/early pages** ("Late, … Here's tomorrow") read well.

## Bugs (confirmed)

1. **Undo after a partial Done doesn't undo the progress.** `stepAside`'s
   snapshot (`model.js skipSnapshot`) has no `progress`, so Undo on
   "63% done: …" leaves 63% and a skip counted. `now.js:978`.
2. **"Done in 1 min" on every card Done.** `now.js:989` sets `minutes: 0`
   when no timer ran, the hero shows `max(1, 0)`, while the toast below says
   "Counted ~120 min". Seen on every completion for 3 weeks.
3. **Undo toast covers "Do it"** on the post-Done screen for ~5 s; tapping
   "Do it" in that window hits the toast and does nothing.
4. **Guest mode TDZ error on every load**: `main.js:365` reads `dayDrag`
   before `let dayDrag` (`main.js:448`) because the guest store fires the
   settings callback synchronously. Visible fallout: Settings → "Meal breaks"
   is empty, "Log finished tasks" shows checked for a guest. Firebase users
   unaffected (async snapshot).
5. **Reopen restores the task as 95% done** ("5 min left"), not its real
   progress (it was 0%, an accidental Done).
6. **Card flips to the next task at the slot boundary.** Overrun task A,
   hold Done → task B gets completed. Happened twice (arnona→portfolio reel
   3 h; song 1→song 2). The "Counted ~180 min" then inflates Week stats.

## Behaviour that confused me as a user

7. **"Not now" on the post-Done screen skips the *next* task for hours.**
   It's the only way to dismiss the screen (no ✕/Back), so I used it to
   close it and an admin task vanished from the card for 3 h while the Today
   list still showed it at 14:05.
8. **Reason lines name the guessed area, not my project**: Portfolio tasks
   say "Job search is behind", "Email Tamar about scope" (Tamar app) shows
   as "Admin · Admin is behind", an Inbox task shows as "Work".
9. **Hidden guesses I can't see or fix drive scheduling.** "Q3 tax report"
   was guessed `openHours: office` → on Friday (offices closed) the card said
   "Nothing fits the next 3 h · Take the break" with 13 h free and a 2 h
   deadline task open; no override on the card. Same plan later booked
   "Book dentist" (also `office`) at 21:50. "Fix bike brakes" guessed
   computer/deep work.
10. **Partial Done = Later.** After "50% done", the task leaves the card for
    ~2 h even if it's the deadline task and the only thing left → "Nothing
    fits, take the break". And the plan still books the full original size
    (75%-done tax report got a 2 h slot; 50% demo got 3 h).
11. **New tasks don't enter an open proposal.** Added 6 deadline tasks
    (~11 h) in the morning; proposal and Rethink ignored them. Only "More
    tasks" or reopening Plan my day pulled them in. Opening Projects silently
    closed the proposal; the card kept saying "First in the plan below".
12. **No order inside a project.** "Send rough mixes" was proposed first,
    before any mix existed — twice.
13. **Triage dates ignore context.** Overdue "Prep questions for interview"
    → "I'd move it to Thu" (interview was today 11:00). Overdue money
    deadline → "Move to Thu" while the plan had it first today.
14. **Coming back after 2 days**: no welcome-back/overdue sweep on the card;
    the 2-day-late invoice just said "costs money". Triage only behind the
    "3 need you" chip.
15. **Ignoring the app for 3 days**: same "Gym" card every morning and still
    at 13:30 ("First in the plan below"); deadline project never escalated;
    "Rough day? Want a lighter plan?" arrived only at 21:30.
16. **"Rough day?" fires while I'm working.** Picked the tax report via
    Focus, worked 90 min → "Rough day? Nothing's moved since 13:44" replaced
    my focus card. Picking/Focus doesn't start a run, so Daisey thinks I'm idle.
17. **"Repeats weekly" means 3× a week.** Ticked it on guitar/gym; Daisey
    then said "Keeps your 3× a week going" and brought it back the next day.
18. **Hold-to-Done**: a natural ~1.5 s press gives 63%. 100% needs 2.4 s.
    First tap only shows a hint. Easy to under-complete by accident.

## Smaller things

- Proposals have no lunch on 3 of the days (Mon, Tue, Sun 25); 4 h blocks
  with no break; "More tasks" jumps 2 h 35 → 10 h until 21:55.
- "Fewer tasks" kept passport renewal (due Nov 15) and dropped both Tamar
  packs (due Fri 23).
- Today list shows "☕ Breather · 7 h 40 min" for the rest of the day.
- Break card "Next: Call mom at 12:15" while the list's next item was
  arnona at 11:30.
- "Again? Next week / Next month" after one-off tasks (recruiter reply).
- Event form starts at 00:00, not the current time.
- Guest greeting "Late, Guest."; "1 need offices open" grammar.
- Escape doesn't close the Switch list; it stays open across views.
- Offline Tell Daisey drops the sentence into a new *task* title (fine),
  but "lunch with Dana at 13:00" can't become an event.
- Week stats inflate (accidental Done counted 180 m; a 75%-done task
  counted as full 120 m on completion).

## Suggested order

Fix 1, 2, 3, 6, 7 first (cheap, they hit every day). Then 10 + 11 (plan
honesty), then show/allow-correcting the guessed fields (8, 9).
