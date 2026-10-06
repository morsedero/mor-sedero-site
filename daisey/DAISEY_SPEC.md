# Daisey — Now Engine Spec v1

Oct 3, 2026 · @Mor

## What Daisey is

Daisey is a Now engine: you open it, it shows the one task that fits this moment, and says why. It is not a calendar and not a list.

**Who it's for.** Anyone whose days are uneven: freelancers, people with part-time or shifting jobs, creatives juggling several projects. Built for Mor first; designed so anyone with an irregular week could use it.

**The problem.** Most task apps answer "what do I have?" or "when should I do it?". The hard question is "what should I do right now, with the time and energy I have?". Lists leave that decision to you every time. Auto-schedulers like Motion plan the whole day, then break the moment something changes, and many solo users find them rigid and overwhelming.

**What makes it different.**

- One card, not a plan. Daisey decides only the next step, so nothing breaks when the day changes.
- It explains itself. Every pick comes with a short reason you can disagree with.
- It proposes, you approve. Like Morgen's AI planner, nothing happens without your yes.
- It learns from you. Skips, starts and finishes tune future picks; no setup ritual required.

## Core principles

Five rules every feature must pass. If a feature breaks one, it doesn't ship.

1. **One thing at a time.** The main screen shows one task. Everything else is one tap away, never on top.
2. **Propose, never act.** Daisey suggests; you confirm. No task, calendar event or change is created without your yes.
3. **Guess, then correct.** Daisey fills in what it can (energy, size, project) and shows its guess. You fix only what's wrong. Each fix teaches it.
4. **No means no, without guilt.** Skipping is normal, not failure. No streaks, no red badges, no scolding. A skip is information.
5. **Explain every pick.** One plain sentence says why this task, now. If Daisey can't explain it, it shouldn't suggest it.

**The test for every new feature** (Mor, 2026-10-06, master spec): *does this help Daisey decide what I should do, or does it just help me manage more information?* More lists, tags, metadata, dashboards or things to keep up to date fail it. The user manages their life; Daisey manages the plan.

## Start, Focus and Deep Focus (Mor, 2026-10-06)

Start no longer means full screen. The Now card is **Not now ▾ · Done · Focus · Start**:

- **Start** makes the task Active (`state/now`, `mode: "inline"`) and the card becomes the running card on the dashboard: the clock, Pause, Stop, Focus and hold-to-finish. The Schedule/Projects panel stays visible, for whoever wants to work while seeing their day. Active is the same strong signal either way (reality.js).
- **Focus** (on the card, or on the running card) is **Deep Focus**: `mode: "focus"`, the old focus screen plus what a web page can honestly do (`deep.js`): full screen (on the tap), screen kept awake, and "Away 2× · 6 min" when you come back after leaving Daisey. It cannot block apps or silence the phone and says so (a "Block other apps?" note points to Android's App pinning). **Dashboard** leaves it and keeps the task running. Batches and runs from before modes existed open in Deep Focus.
- **Not now** opens Later · Switch · Pending (their asks as before). **Done** on an idle card means already finished: no time booked, with an Undo.

## Reality over plan

A calendar event, a booked slot and anything Daisey plans are **predictions**. What you actually do is **evidence**, and evidence wins. Daisey adapts on its own and asks only when a decision really needs you (Mor, 2026-10-06). The rules live in one module, `app/js/reality.js`, which both the Now card and the server's notifications read, so they can't disagree.

**Task states.** Suggested (the engine's pick, computed, never stored) · Planned (a booked slot today; Plan My Day's windows later) · **Active** (the running task, `state/now`) · Done. Pending and Not now sit beside them. Planned is a guess; Active is a fact.

**What counts as evidence:**

| Signal | Means | Effect |
| --- | --- | --- |
| A task running | You're on it | Nothing competes: no other suggestion on the card, no free-gap or booked-slot push, the brief and the evening wrap wait, a people alert only comes in the last 15 min before the meeting |
| A task paused (under 3 h) | Still your focus, you stepped away | Same as running for suggestions; says nothing about where you are |
| Work logged during an event (a Start, Done or kept time) | You weren't in it, or it ended early | The event stops counting as busy: the card picks a task, the brief isn't held back, its end isn't announced |
| A run past "Still on it?" or paused 3 h+ | A forgotten timer | Not evidence of anything |

A booked slot another event runs into is adapted silently (the task is back in the pool when the slot passes) — except one case, a **real deadline** with room to move it today: Needs you asks once, "Dentist is running into this. Move it to 15:40 · Keep current plan" (`clash.js`). Move retimes the slot's calendar event on that tap; Keep hides the question for the day. A target date never asks.

Events still ahead are never overruled: a plan for later is still the best guess about later. Daisey can't see a meeting running over (the calendar doesn't know either), so the free-gap push says "After Teaching", not "Teaching is over", and expires in 30 minutes.

**Calendar writes** stay as they are: only on a tap, plus the Daisey log (a record of what happened, in its own calendar, marked free, never read as a commitment). Recommendations never become calendar events on their own.

## The Now card

Opening Daisey shows a single card. That card is the whole home screen.

**What the card shows, top to bottom:**

- **Context line** (small): free time until the next event, and the energy guess. Example: "45 min free · energy low (guess)". Tap energy to correct it.
- **Task title** (large).
- **Project** (small tag) and estimated size.
- **Why line**: one sentence. Example: "Quick one-shot, fits before teaching, due Tuesday."
- **Three buttons:** Start · Not now · Something else.
- **Chat bar** at the bottom: type or hold to talk.

**What each button does:**

| Button | What happens | What Daisey learns |
| --- | --- | --- |
| Start | Card becomes a running timer with Done and Pause. Past 2× the plan (and at least 30 min over), it asks "Still on it?" with **Still on it** or **Finished earlier**. Finished earlier asks "How long did it take?" (½× to 2× the plan, or minutes typed) and finishes the task with that time, logged as ending that long after the start. Without an answer, Done and Stop count only up to the ask. Done means finished, and is press-and-hold (1 s, the button fills) so a mis-tap can't end a task; finishing gets a confetti burst. Pause freezes the timer in place and turns into Resume. Stop ends the session with its time kept and returns to the normal card. Pending stops and asks what it's waiting on. | This task fit this time and energy. Real duration vs estimate. |
| Not now | Optional one-tap reason: too tired · no time · not in the mood · blocked. Card swaps to the next pick. Task stays hidden for this session only. | The reason adjusts that task's fit for similar moments. "Blocked" marks the task as waiting. |
| Something else | Shows 2–3 alternatives with their why lines. Pick one to start. | The picked task beat the first choice in this context. |

**Empty states.**

- No tasks fit (window too short, everything blocked): "Nothing fits the next 10 minutes. Take the break." No filler task.
- No tasks at all: the chat bar invites a brain dump.

**While a task runs**, Daisey stays quiet. No new suggestions until you stop or finish.

## Task data

Only the title is required. Gemini guesses the rest from the title (area, type, place, open hours, size, energy, stakes) and shows the guesses as chips on the confirm card. Tap a chip to fix it; each fix improves future guesses.

| Field | Required | Values | Default if missing |
| --- | --- | --- | --- |
| Title | Yes | Free text | — |
| Project | No | Any name the user uses | "Inbox" |
| Area | No | Work · Job search · Home · Admin · Social · Personal | Guessed from project and title |
| Type | No | Deep · Admin · Call · Errand · Home · Social | Guessed from title |
| Where | No | Anywhere · Computer · Home · Out · Phone | Guessed from type |
| Open hours | No | Anytime · Office hours (Sun–Thu 9:00–16:00) · Evening | Office hours for Call and most Admin; else Anytime |
| Size | No | 5 · 15 · 30 · 60 · 90+ min | Guessed from type, title and similar past tasks |
| Energy needed | No | Low · Medium · High | Guessed from type and size |
| Stakes | No | Low · Costs money · Affects someone · Deadline penalty | Guessed; else Low |
| Date | No | Date, optional time | None |
| Date kind | No | Deadline (real) · Target (wish) | Target |
| Status | Auto | Ready · Pending (stored as `waiting`) · Not now (stored as `someday`) · Done | Ready |
| Waiting on | No | Free text ("Yuval confirms") | — |
| Check again | Auto | Date: when Needs you asks "Still pending?" | 3 days after it went Pending |
| Steps | No | Checklist of short steps | None |
| Next step | Auto | The first unticked step | Asked once for 90+ min tasks and goals |
| Links | No | URLs; a file is a link to it (Drive, Dropbox) | None |
| Can split | No | Yes / No | Yes for 60+ min tasks |
| Notes | No | Free text | — |

**Fields Daisey keeps on its own** (never asked):

- Created date, last touched, times skipped and the reasons given.
- Time actually spent across all sessions.
- How many times started and stopped without finishing.

**Recurring tasks** (weekly lesson prep, invoices) use a simple repeat: every N days or on given weekdays. A recurring task appears once per cycle, not stacked.

**Goals vs tasks.** Anything that names an outcome or can't be done in one sitting ("10 treatments by 2027", "find a game-audio job") is a goal. Daisey keeps it as a project and asks once: "What's the first step?" Only the next step is ever suggested; when it's done, Daisey asks for the next one.

## Now engine logic

The engine picks like a secretary, in three gates, every time the card is shown: can it be done right now, what does leaving it cost, and does it fit this gap. All weights are starting values, kept as tunable constants in one file.

**Step 1 — Read the moment**

- **Free window**: minutes until the next calendar event, capped at 180. No calendar → 60.
- **Current block**: if a calendar event is happening now and its title matches a project, that project is the focus. If it's an unrelated event (teaching, a meeting), Daisey stays quiet until it ends, with an "I'm free now" override.
- **Where**: Home, Out or Anywhere, guessed from calendar location and time of day; one tap to correct.
- **Office hours**: open Sun–Thu 9:00–16:00, closed Fri, Sat and Israeli holidays (configurable).
- **Energy**: the current guess, or the user's correction from the last 3 hours.
- **Time bucket** and **last activity**, as before.

**Gate 1 — Can it be done now?** A task is out if any is true:

- Status is Waiting or Done.
- Its Where doesn't match (a Home task while Out, a Computer task while on the phone).
- It needs office hours and offices are closed.
- Time still to do (size minus time already worked, at least 5 min) is bigger than the free window, unless it can split and the window is at least 25 min. Window fit and batches use the same time left.
- Needs High energy and current energy is Low.
- Skipped already in this session.
- The current block names a project and the task isn't in it (unless "I'm free now" was tapped).

**Gate 2 — What does leaving it cost?**

| Factor | Points | How it's computed |
| --- | --- | --- |
| Real deadline | 0–35 | Past or today: 35 · within 2 days: 25 · within 7 days: 12. Big work counts early: one day closer per 2 h still to do past the first 2 h ("deadline Fri, 6 h still to do") |
| Target date | 0–8 | Today or past: 8 · within 3 days: 4. A target is never shown as "overdue". |
| Stakes | 0–15 | Deadline penalty: 15 · costs money: 12 · affects someone: 10 · low: 0 |
| Area balance | 0–12 | The area furthest behind its weekly intent (or least touched this week) gets up to 12 |
| Neglect | 0–8 | +1 per day since real work (start, time, done), or since added; skips and edits don't reset it. Max 8 |

**Gate 3 — Does it fit this gap?**

| Factor | Points | How it's computed |
| --- | --- | --- |
| Energy fit | 0–15 | Exact match: 15 · task needs one step less: 10 · one step more: 3 |
| Window fit | 0–12 | Fills 50–100% of the window: 12 · 25–50%: 8 · under 25%: 5 · split piece: 6 |
| Momentum | 0–8 | Same project as last activity today: 8 · touched in last 2 days: 4 |
| Batch bonus | 0–10 | 2+ ready tasks of the same type (calls, admin, errands) fit the window together: 10 |
| Learned fit | −10 to +10 | How often similar tasks were started vs skipped in this time bucket and energy |
| Skip penalty | −8 each | Per skip of this task today |

**Batches.** When the winner earns the batch bonus, the card offers the batch instead of one task: "Offices are open: 3 calls, about 20 min. Do them together?" Start runs them as a checklist in focus mode.

**Tie-break:** real deadline first, then higher stakes, then smaller size.

**Something else** shows the next 2–3 by score and forces variety across areas: no two from the same area if another area scores within 15 points.

**Stale tasks.** A task skipped 5 times without starting stops being suggested, unless it has a real deadline within 7 days. Needs you asks: "Still want this?" Shrink · Keep · Let it go. Setting a task Pending is not a skip.

**Building the why line.** Take the two or three factors that added the most points and turn each into a short phrase, in first person ("I'd do this now: …"):

- Real deadline → "deadline Tuesday" / "deadline today"
- Stakes → "costs money if late" / "Sofi is waiting on it"
- Office hours → "offices close at 16:00"
- Area balance → "job search hasn't moved this week"
- Batch → "3 calls, done together"
- Energy fit → "light one, you're low"
- Window fit → "fits before teaching"
- Momentum → "keeps Monster Punk going"

The card and its alternatives never share the same why line. If two tasks lead with the same factor, the second one leads with its next factor.

## Overdue triage and weekly intents

Only real deadlines can be overdue. Target dates that pass roll forward quietly and lose urgency, so a pile of old wish dates never floods the card.

**The sweep.** When more than 3 deadlines or 5 targets have passed, Daisey offers a 2-minute sweep, at most once a day. One task at a time, four buttons: Today · This week · Someday · Drop. "Someday" tasks are never suggested until moved back.

**Weekly intents.** Optional, one per area, set in chat: "I want to send 3 CVs a week", "2 home tasks a week". They feed the Area balance factor so neglected parts of life get a turn. Progress is shown quietly, never as streaks or red numbers.

**Someday comes back.** Someday is not a graveyard. Once a week (default Sunday morning, or whenever fewer than 3 tasks are active), Daisey shows a short card: "Pick 1–2 from Someday for this week", listing Someday tasks with stakes first. Tasks that cost money or affect someone get a gentle mark. Picked tasks move to This week.

## Energy guessing and learning

Daisey guesses energy from three signals, shows the guess as a chip, and learns from every correction and every choice you make.

**The guess, in order of strength:**

1. **Your correction.** If you set energy in the last 3 hours, use that. Nothing overrides it.
2. **What just happened.** A calendar event that ended in the last 60 min lowers energy one step if it was 2+ hours long or tagged as draining (teaching, rehearsal). No events today and it's before noon → no change.
3. **Your pattern.** Average of past corrections for this time bucket and weekday type. Before enough data (fewer than 5 corrections in that bucket), start from Medium.

**Learning from actions (no extra effort from you):**

| You do | Daisey records |
| --- | --- |
| Correct the energy chip | Strongest signal. Updates the pattern for this time bucket. |
| Start a task | This task type fits this moment. Raises learned fit for similar tasks here. |
| Finish it | Real time spent. Updates size guesses for similar tasks. |
| Not now · too tired | Energy was likely lower than guessed. Nudges the bucket down. |
| Not now · no time | Size estimate or window was off. Nudges the size guess up. |
| Something else, then pick | The picked task beat the first in this context. |

**Calendar tags for draining events** are set once in settings (e.g. any event with "teaching" or "שיעור" in the title). Daisey suggests tags after seeing patterns, and you approve.

**Privacy.** All learning stays in the user's own data. Nothing is shared.

## Chat

One bar under the Now card, text or hold-to-talk. It turns plain language into changes, always shows what it understood, and waits for your tap before anything changes.

**Minimal by design.** No chat history screen in v1. Replies are one short line plus a confirm card. Voice is transcribed to text first, so both inputs follow the same path.

**What it handles:**

| You say | Daisey shows | On confirm |
| --- | --- | --- |
| "Mix review for Reprise, 2 hours, by Thursday" | Task card: title, project, 120 min, due Thu | Task added |
| "Lesson prep, invoices, call Uri, fix the boss loop" (brain dump) | List of 4 parsed tasks, each editable | All added |
| "I have 30 minutes and I'm wrecked" | New Now card using 30 min + Low energy | Card shown (no data changed) |
| "Push the mix review to next week" | Due date change: Thu → next Thu | Updated |
| "Waiting on Yuval for the pre-attack cue" | Status → Waiting, waiting on: Yuval | Updated |
| "What's next after this?" | Top 3 with why lines | Nothing changes |
| "Drop the old jingle idea" | Task to archive | Archived |

**Confirm pattern.** Every change appears as a small card with the parsed fields. Tap ✓ to apply, tap a field to fix it, or tap ✕ to cancel. One tap, no forms.

**When it's unsure** (two tasks match a name, no project given), it asks one short question with buttons, never an open question.

**Tone.** Short, friendly, neutral. Suggests, never pushes. No praise, no guilt.

**Engine.** A language model parses messages into structured actions (add, edit, set context, query). The Now engine logic itself stays rule-based, so picks are explainable and predictable.

**Built (Oct 5, 2026).** The Tell Daisey bar at the bottom of the app (`app/js/tell.js`). Server side: `functions/daisey-now-chat.js` calls Gemini Flash-Lite (`gemini-3.5-flash-lite`, override with `GEMINI_MODEL`; 3.5 beat 3.1 on the same messages, ~1 s each) through `generateContent` with a JSON schema, and returns proposed actions: add (one or several), update (dates, title, project, size), waiting, drop, and moment (energy/place right now). Nothing is written server-side; the app shows one card per action and applies only on Apply. The key is `GEMINI_API_KEY` in Netlify's environment; without it the bar falls back to opening Add task with the text. Each user gets 60 messages a day (Netlify Blobs). The message, today's date and the open tasks' titles, projects and dates go to Google with each request. Voice uses the browser's own speech-to-text. "I have 30 minutes" (a moment with minutes) sets the Now card's window, counting down from when it was said; it only ever shortens the window. A "new project" message gets its own card whose button opens the first task with the project set — projects exist only through their tasks.

**Adding by hand.** A round + at the start of the bar opens Task or Event: the one place to add either without Tell Daisey (Mor, Oct 5). Event opens on the day the Today panel is showing; it is off while the calendar isn't connected. There is no other add button in the app.

## Google Calendar

The calendar becomes context, not a plan to obey. Daisey reads it freely and writes to it only when you say yes.

**Reads (automatic):**

- Events today and tomorrow, to compute the free window.
- Event titles, to apply draining-event tags for the energy guess.
- All-day events are ignored for the window unless marked busy.

**Writes (only on approval):**

| Situation | Daisey proposes | Default |
| --- | --- | --- |
| A task with a real deadline has no realistic window before it | "Block 90 min Wed 10:00 for mix review?" | Off until tapped |
| You ask in chat to schedule something | The event, shown as a confirm card | Requires ✓ |
| You finish a task | Logs it as a past event ("Done: boss SFX · 47 min") | Setting, off by default |

**What's gone from the old approach:**

- No colour-coded planning blocks that must be followed.
- No auto-filling the day with tasks.
- No Trello sync. Daisey owns the task list.

**Calendar used:** writes go to a separate "Daisey" calendar, so they're easy to hide or delete without touching other events.

**Done log:** every task finished with Done (and every finished batch) is written to a second calendar, "Daisey log", as the time actually spent, ending at Done. Marked free, so it never blocks anything; untick the calendar in Google Calendar to hide the lookback. On by default (Mor said yes, 2026-10-05), switch in the account menu: "Log finished tasks in Google Calendar". The one write that happens without a tap at that moment.

**Meetings to set up (v2).** A task like "set a meeting with X" becomes: Daisey suggests 3 free slots from the calendar and drafts the message. You approve, then send it yourself.

## Notifications and the Today chip

Daisey speaks first (Mor, Oct 6, 2026; Android, app notifications; no daily limit for now). Switched on per device in the account menu ("Notifications on this device"); each kind can be turned off there, for all devices. Nothing is sent outside the day hours.

| Kind | When | Says |
| --- | --- | --- |
| Morning brief | First check after the day starts that isn't inside a calendar event (up to 4 h late) | "9 h 55 min free today. 4 open, about 3 fit. Deadline today: Pay arnona. Deadline tomorrow, not started: Send stems. 2 things need you. First: Teaching at 10:00." |
| End of the day | The day's last hour, not inside an event | "Done today: 4. Still open for today: 2, deadline: X. Tap to sort them." The tap opens the wrap: one question per task (deadline: I'll do it tonight · Move it to tomorrow · Let it go; target: Move to tomorrow · Not now · Let it go) |
| Free time after a meeting | A busy event ended in the last 10 min and 30+ free min follow, nothing is running, and you didn't work through the event | "After Teaching. 1 h 25 min free. Next: Send invoice to Uri. <why>" (the Now card's own pick for that window), with **Start task** |
| Booked task starting | A booked slot starts (within a few minutes), nothing else running | "Mix review, booked 14:00–15:30.", with **Start task** |

| Before meetings | Up to 45 min before an event that names someone a Pending task waits on | "Coffee with Yuval at 14:00: You're waiting on Yuval for: Pre-attack cue." |

**Built Oct 6 (second round):** a 10-min buffer before the next event; tasks pushed to a later day twice get "Keeps sliding" in Needs you (shrink · keep · not now · let go); weekly goals per area, asked in Needs you when missing and kept in Settings; "Again? Next week · Next month" after Done (a fresh copy, no repeat engine); "Nudge on WhatsApp" on Pending tasks (a check-in in the task's language, you send it); Tell Daisey handles done, events at a time, and questions (what's next / due today or this week / what am I waiting on); sharing text or a link into Daisey from the phone reads it like a Tell message.

**Start task** (2026-10-06): a notification that names one task (free gap, booked slot) has a Start task button. It opens Daisey with `?start=<id>` (an open Daisey is told instead) and goes straight into focus mode — unless something is already running (that stays, and its focus screen is what opens) or the task was done, parked or set Pending since. Those two kinds expire quickly (30 and 15 min), so a phone that was off doesn't get a suggestion for a moment long gone.

**Today chip** (header, next to ✓ N): tap to open the same brief, live from now, as a small message; ✕, Escape or a tap elsewhere closes it.

**How it works**: Web Push. `functions/daisey-now-morning.js` runs every 5 minutes; `_daisey-lib/notify.js` decides, using the app's own engine, brief and Needs-you modules (required from `app/js`, bundled with esbuild), so the server and the app can't disagree. The server can't read Firestore, so while notifications are on the app sends `daisey-now-push` a snapshot of its open tasks (and those done in the last 2 days) and the running task whenever they change: scoring fields only, never notes, links or steps. The calendar is read live. Keys: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in Netlify's environment.

## Can it be done online? (2026-10-06)

A task whose open hours are only a guess at "Office hours" (a call, a school, an office) gets one quiet web check when it's added (`research.js`, `functions/daisey-now-research.js`: Gemini with Google Search, 40 a day). If the web finds an online way, the guess becomes "Anytime" so the task isn't held back until the offices open; either way the one-line reason ("Daisey checked: can be done online — …") sits in the task sheet. No question, no spinner, a failure leaves the task as it was; a task you set to Office hours yourself is never touched. Only the title and project name go out.

## Day hours, booked tasks and calendar tasks

Daisey only plans inside your waking day, never pushes a task that already has a time, and helps tasks that ended up in the calendar become real tasks.

**Day hours.** Default 08:00–22:00, set once in settings. "My day can run until 11 pm today" in Tell Daisey stretches (or shortens) today's end only (`settings.dayEndToday`, read by `dayHours`); tomorrow the usual hours are back. Free time is counted only inside them. Outside them, the card switches to night mode: "Late. Tomorrow first: <task> — <why>." with no Start button; "I'm free now" still overrides. The day's free-time line counts from now (or 08:00) to 22:00.

**Booked tasks.** A task linked to a calendar event (created from Daisey, or matched by title) is not suggested before its slot. The card shows it as "Booked for 19:00" only when nothing else fits. When its slot starts, it becomes the card.

**Calendar events that are really tasks.** When an event title reads like a task (a verb plus an object, or words like "לבטל", "להתקשר", "לשלם", "until the 20th"), Daisey offers once: "Make this a task? Cancel LinkedIn Premium · 10 min · deadline 20 Oct". On ✓ it creates the task with guessed fields and asks whether to keep or delete the event.

## v1 scope

v1 is done when the Now card picks a task you actually start, most days, for one full week, with no other planning tool open.

**In v1 (build in this order):**

- [x] Google sign-in + Firebase storage, synced across phone and computer
- [x] Task data model (fields above, including type, where, open hours, stakes, date kind)
- [x] Now card UI with Start · Later · Switch · Pending, Hebrew and RTL ready
- [x] Running timer and Done flow
- [x] Google Calendar read: free window, current block, project focus, "I'm free now"
- [x] Day hours and night mode; booked tasks not suggested early
- [x] Calendar events that look like tasks offered as tasks
- [ ] Server function holding the Gemini key
- [ ] Chat via Gemini: add task, brain dump, edit, with guessed chips on the confirm card
- [x] Three-gate Now engine with why line and batching
- [x] Overdue triage sweep and weekly Someday pick (both in Needs you, Oct 5, 2026)
- [ ] Weekly intents
- [x] Energy guess from time bucket + corrections; learning from start, skip, finish
- [ ] Voice input in chat (browser speech recognition, Hebrew + English)

**Out of v1 (parked):**

- Game layer, combos, streaks
- Pencil schedule (suggestions placed in calendar gaps): dropped
- Calendar writes other than deadline blocks and chat-requested events
- Meeting scheduling with others (find slots, draft message)
- (Built after all, Oct 6: evening wrap and notifications when a gap opens; see Notifications)
- Multiple users, sharing, accounts for others
- Wearables or sleep data

**Done criteria (one test week):**

- Started the suggested task, or one from Something else, in at least 7 of 10 opens.
- Every task added through chat in under 15 seconds.
- No other list or planner used to decide what to do.

**Decisions:**

- **Storage:** synced via Firebase, Google sign-in. The same login grants Calendar read access.
- **Chat model:** Gemini API. The key never sits in page code; a small server function (Netlify Function if the site is on Netlify) calls Gemini.
- **Language:** Hebrew and English from day one: RTL layout, mixed-language task titles, chat and voice in both.
- **Finished-task history:** used for learning only in v1; no history screen.

## Visual design

The Now screen redesign (Oct 5, 2026; references in `daisey/New Design/`). Calm, warm, light. One loud thing per screen: the amber button.

### Layout (round 3, Oct 6, 2026: mockups 6-home-schedule-tab, 7-home-projects-tab, 8–10)

A fixed split screen: nothing pulls up, nothing scrolls but the panel's pages. One column at every width; never two columns under 600 px (the project grid and the two date boxes are tiles inside one column, not page columns). In the UI, Waiting is called **Pending** everywhere; the stored status stays `waiting` ("Waiting on <who>" stays as the phrase for who it waits on).

**Header** (`index.html`, `main.js`): the full daisy logo (always five white petals, softer at night, never a bare dot) + "Daisey" 21/700 at the start. At the end: the amber **"N need you"** chip (only when > 0; opens Needs you; `now.js` counts), the **Today** chip, the green **"✓ N"** done-today chip (only when > 0), the avatar. No greeting, no clock. Words on Needs you and no zeros (2026-10-06): bare numbers beside "Today" read as "0 Today 0". Under 430 px, while Needs you shows, Today keeps only its sun so the wordmark fits.

**Home = top: Now card, bottom: panel** (`now.js`, `panel.js`, mockups 6 and 7)
- The compact Now card (~214px, radius 22): area dot + "Area · project" on one line (the project opens its project screen), size at the end; the title 26/600 is the button that opens the task screen; "Next: <step>" when it has steps; a one-line why; ONE row: the wide amber Start + three 50px square buttons with an icon and a 10px label: Later, Switch, Pending. Their asks (When?, Waiting on, Switch's list) open under the row and push the panel down; the card area scrolls if it gets tall.
- Inside a project block or a booked slot, one quiet line above the card: "Working on X until 14:00 · I'm free now".
- The panel fills the rest down to the pill: a rounded card (radius 22) with a segmented control **[Schedule | Projects]** and two small page dots under it. Tap a tab or swipe sideways inside the panel to switch; the track follows the finger. The last tab is remembered on the device (`localStorage daisey.panel`).
- **Schedule** (`schedule.js`): a label row per day ("Tonight · Tue 6 Oct" after 18:00 or past the day's end, else "Today"; "Tomorrow · Wed 7 Oct"; then the weekday), seven days. Each row: start–end ONCE in an 88px left column, then a block tinted with the event's Google colour holding only its name (tap = its details), or a dashed "Free" box for a gap of 15 min+ inside the day hours. All-day events say "All day". Past events drop off. The night divider sits between today and tomorrow; a day with nothing on it says "Nothing scheduled". Soft fade at the bottom edge. Labels follow the real clock: after midnight the coming day is "Today" with the night divider above it.
- **Projects** (`projects.js`): "N projects · N tasks" + "+ New", a 2-column grid of project cards (name, open count, one status line: "Next: …" or "3 pending · 6 not now", progress bar done / all), then the **Inbox** row (dashed: "Inbox · N · no project yet"), only when it has tasks.
- **Every project has its own colour**: its tasks' most common area when no other project has it yet, else the next free colour (`.pc-<key>`: the six area colours, then teal, orange, slate, brick, lime). Taken in name order, so colours don't move as counts change. The grid card, the project screen's chip and its card use it.
- **Plan my day** (`plan.js`, `plan-view.js`; Mor, 2026-10-06): the top of today's Schedule page shows Daisey's plan: the free time left, in Morning / Afternoon / Evening windows ("Afternoon · 2 h free"), each with up to 3 tasks it would use it for and their sizes; a tap opens the task. It is a Daisey plan only: no times for tasks, nothing in Google Calendar, nothing stored. It is worked out fresh from the tasks and calendar every time, with the Now card's own engine, window by window, a task planned once. A running task is left out, a meeting you worked through isn't busy (reality.js), so when the day changes the plan just comes out different. "Plan my afternoon" in Tell Daisey shows the same block for that window. Putting a task in the calendar stays a separate, explicit act.
- **Under the card, two quiet rows** (`now.js glance`, Mor picked mockup A, 2026-10-06): "NEXT 19:30 Dinner" (opens the event) and "FREE 2 h 15 min this evening" (opens the Schedule tab; Plan My Day will answer it). Free time counts to the day's end; a row with nothing to say is left out; none without a calendar.
- At the bottom, in the flow (nothing ever sits under it): one pill [ + | Tell Daisey… | mic ], 54px. + opens New task / New event. While it's empty and not in use, the placeholder turns between "Tell Daisey…" and an example of something it really handles ("What's next?", "Call Uri tomorrow at 10"; a brain dump when there are no tasks, "What am I waiting on?" when something is Pending) — `tell.js hintsFor`.

**Night** (`now.js nightView`): the panel steps aside; the night screen fills the card area. A real deadline due today and still open is named above "Tomorrow first" ("Due today", with Start), never "Nothing needs you tonight". "Tomorrow first" shows each time once (start–end) on the left. "I'm free now, show me something" and the night divider sit at the bottom of that area, always above the pill.

**Night divider** (`ui.js nightDivider`, used everywhere today meets tomorrow): a thin line with a centred cream pill (`#F1ECDF`, ink-2 text, 12px) "Night · 23:45 – 08:00" and a small closed daisy bud. The hours are the day hours from settings.

**Project screen opens full screen** (Mor, 2026-10-06): not inside the panel's tab. The tab has ~400px at 390px wide, sideways swipe there already means Schedule ↔ Projects, and a back arrow inside a tab is ambiguous.

**Project screen** (`projects.js`, mockup 8)
- Back arrow + horizontal project chips (the current one filled in its colour). Tap a chip to switch; swipe left/right anywhere that isn't a task for the next/previous project. Phone Back closes it.
- Project card: name and progress bar only. No project-level date badge (Mor, 2026-10-06): a date belongs to its task. In the list, a deadline within a week shows its date yellow (amber ink), within 2 days orange, passed red and bold; targets stay plain. A date more than 2 weeks away isn't shown in the list at all, only in the task sheet. A task with a start date still ahead shows "Starts Thu" (card dimmed) and, when it has one, its due date after it: "30 min · Starts Thu · due Sat". The start disappears once that day comes. List dates are words where a word works: today / tomorrow / yesterday, a weekday within 6 days either side, else "12 Oct" — never numbers (8/10 is a different day in another locale). The two toggles always sit on one row: they shrink and ellipsize rather than wrap.
- Under the project card's progress bar, two toggles: **"X of Y done"** and **"Not now · N"** (only when it has tasks). Each opens its drawer inside the card, one at a time: done tasks with a filled tick that reopens the task (Undo toast); Not now tasks with "Off your plate. Daisey offers one back on Sunday." and a **Bring back** button each. (Mor, 2026-10-06: Done couldn't be undone from the project, and four status sections read as messy.)
- Below the card, **one list, no section headers**, in the order Daisey hands tasks out: ready tasks by urgency (size, "n of m steps", date; NOW on the card's task), then Pending tasks, dashed and quieter ("Waiting on Yuval · I'll ask you Thu", with an initial), then "+ Add a task".
- Swipe a task right = done (green reveal, Undo toast). Tap = the task sheet.

**Task sheet** (`addtask.js`, mockup 9), opened by tapping a task's title anywhere; the same sheet, empty, is New task.
- Project dot + name, title 26 (edited in place).
- Two date boxes side by side: Start (not before) first, then Due with a Deadline/Target tag (tap to switch).
- One collapsed row "Details: size, energy, place" that opens Daisey's guessed chips. Hidden by default.
- Steps: a checklist; the first unticked step has a "next step" tag and is the Now card's "Next:" line. "+ Add step".
- Links & notes: link chips + "+ Link or file", a notes field.
- "Worked N sessions · Xh so far", the amber Start at the bottom, Delete as a quiet line under it.
- No status switcher and no Save button: every change saves as it's made. A pending task shows its "Waiting on" and "Ask me again" fields.

**Needs you** (`needs.js`, mockup 10)
- Full screen, one decision at a time, progress dots at the top, close X (phone Back closes it too).
- A big card in a soft tint with an icon, a plain question, the item, and Daisey's suggestion in one line. Big buttons: the primary answer (amber), the secondary answer, "Ask me later" (hides it for the rest of the day).
- Sources, in order: a task in Not now whose real deadline is 3 days away or passed ("Deadline coming up": Bring it back · Let it go), calendar events that read like tasks ("Is this a task?" → then "Keep the event?"), Pending tasks past their check date ("Still pending?"; the check date is 3 days on, or the day before a real deadline if that's sooner), tasks put off 5 times ("Still want this?"), the weekly Someday pick ("Bring one back?"), and old dates ("Still doing this?": today · this week · Someday · let it go — this replaced the Old dates sheet).
- After the last one: "That's everything. Nothing else needs you."

Built (round 2, Oct 5; round 3, Oct 6, 2026):
- [x] Pending everywhere in the UI; one column under 600 px
- [x] Pull-up sheet and its mini Now bar removed (round 3)
- [x] Header: full daisy, Needs you chip, ✓ done chip
- [x] Home split screen: compact Now card + [Schedule | Projects] panel, swipe, remembered tab
- [x] Schedule page; Projects page with Inbox row; a colour per project
- [x] Project screen
- [x] Task screen (no status switcher)
- [x] Needs you
- [x] Greeting follows the real clock; night "Tomorrow first" time once; "I'm free now" above the pill
- [ ] "repeat" in the task screen's Details: not built — v1 has no repeating tasks (Mor, 2026-10-03); waiting on a decision

**Tokens (light)** — `daisey/app/css/app.css` `:root`

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FBF8EF` | page |
| `--card` | `#FFFDF6` | cards |
| `--ink` | `#1F1D1A` | text |
| `--ink-2` | `#6B665D` | quiet text |
| `--line` | `#E6E0D2` | borders |
| `--chip` | `#EFE9DA` | chip and segmented-control fill |
| `--accent` | `#F5B301` with `--ink` text | Start, Hold to finish, Bring back: never decoration |
| `--nowline` | `#C0392B` | the Today timeline's now line |

**Dark** — bg `#141310`, card `#201E1A`, ink `#F3EEE3`, ink-2 `#A8A193`, line `#2E2B25`; area tints darkened, strong text lightened. Dark follows the phone (Auto) or the account menu's Light/Dark, and night mode is always dark whatever the theme.

**Areas (tint / border / strong text)**

| Area | Light | Dark |
|---|---|---|
| Admin | `#EAF1FC` / `#CFDDF5` / `#2F64C0` | `#18212F` / `#2F4A73` / `#8FB2EE` |
| Work | `#EFEAFD` / `#DCD3FA` / `#5B47B8` | `#1F1B2E` / `#3A3163` / `#B9ABF5` |
| Home | `#E7F4EA` / `#C9E6D1` / `#2F7A47` | `#16241A` / `#28482F` / `#8ED1A3` |
| Social | `#FCEAF2` / `#F5CFE0` / `#B23A73` | `#2A1820` / `#55293D` / `#F09AC2` |
| Job search | `#FFF4D6` / `#F5DFA0` / `#8A5A00` | `#2A2210` / `#574414` / `#F0C35A` |
| Personal | `#E3F3F3` / `#C4E3E3` / `#24706F` | `#142625` / `#24504D` / `#7CC9C6` |

A card takes its task's area with `.area-<key>`; inside it everything reads `--tint`, `--aline`, `--aink` and `--sub` (the area's quiet text). A task with no area keeps the plain card colours. Calendar events are tinted with the colour they have in Google Calendar.

**Type** — Rubik 400/500/600/700 (Google Fonts; it covers Hebrew). Header "Daisey" 21/700, Now card title 26/600, task-sheet title 26/600, project name 22/600, Needs you question 28/600, focus title 30/600, focus timer 46/600 tabular, body 14–15, small labels 12–13.

**Shape** — radius: cards 24, buttons 16, chips 999. Every touch target is at least 44px (chips that look smaller get an invisible hit area).

**Text direction** — every title is `dir="auto"`; a task row takes its title's direction as a whole, so a Hebrew row puts its checkbox on the right.

**The daisy** — the header logo is always the full five-petal daisy (round 3); the done-today count is the green "✓ N" chip beside it.

**Motion**

- 150–250 ms for UI changes (card slide, chip, tab, selection).
- Springs only for celebrations: the Done daisy's pop and its drifting petals (2.6 s).
- Ambient motion is slow and small: the hero breathes 3px over 5 s (and stops while an ask is open), the empty-state daisy sways, the night stars twinkle.
- Never in the way of a tap: nothing animates a button out from under a finger, and nothing waits on an animation to act.
- All of it is off under `prefers-reduced-motion`.
- Done vibrates once (15 ms) on phones.
