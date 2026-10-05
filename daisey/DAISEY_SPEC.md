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
| Start | Card becomes a running timer with Done and Pause. Done means finished, and is press-and-hold (1 s, the button fills) so a mis-tap can't end a task; finishing gets a confetti burst. Pause returns to the main screen with the task on the card: Resume, or Later · Switch · Pending, which end the session with its time kept. | This task fit this time and energy. Real duration vs estimate. |
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
| Status | Auto | Ready · Waiting · Done | Ready |
| Waiting on | No | Free text ("Yuval confirms") | — |
| Next step | Auto | Short text | Asked once for 90+ min tasks and goals |
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
- Size is bigger than the free window, unless it can split and the window is at least 25 min.
- Needs High energy and current energy is Low.
- Skipped already in this session.
- The current block names a project and the task isn't in it (unless "I'm free now" was tapped).

**Gate 2 — What does leaving it cost?**

| Factor | Points | How it's computed |
| --- | --- | --- |
| Real deadline | 0–35 | Past or today: 35 · within 2 days: 25 · within 7 days: 12 |
| Target date | 0–8 | Today or past: 8 · within 3 days: 4. A target is never shown as "overdue". |
| Stakes | 0–15 | Deadline penalty: 15 · costs money: 12 · affects someone: 10 · low: 0 |
| Area balance | 0–12 | The area furthest behind its weekly intent (or least touched this week) gets up to 12 |
| Neglect | 0–8 | +1 per day untouched, max 8 |

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

**Stale tasks.** A task skipped 5 times without starting stops being suggested. Daisey asks once in chat: "Still want 'X'? Keep, shrink, or drop?"

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

**Meetings to set up (v2).** A task like "set a meeting with X" becomes: Daisey suggests 3 free slots from the calendar and drafts the message. You approve, then send it yourself.

## Day hours, booked tasks and calendar tasks

Daisey only plans inside your waking day, never pushes a task that already has a time, and helps tasks that ended up in the calendar become real tasks.

**Day hours.** Default 08:00–22:00, set once in settings. Free time is counted only inside them. Outside them, the card switches to night mode: "Late. Tomorrow first: <task> — <why>." with no Start button; "I'm free now" still overrides. The day's free-time line counts from now (or 08:00) to 22:00.

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
- [ ] Overdue triage sweep, weekly Someday pick, weekly intents
- [x] Energy guess from time bucket + corrections; learning from start, skip, finish
- [ ] Voice input in chat (browser speech recognition, Hebrew + English)

**Out of v1 (parked):**

- Game layer, combos, streaks
- Pencil schedule (suggestions placed in calendar gaps): dropped
- Calendar writes other than deadline blocks and chat-requested events
- Meeting scheduling with others (find slots, draft message)
- Evening wrap and notifications when a gap opens
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
