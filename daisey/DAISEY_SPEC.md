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
| Start | Card becomes a running timer with the task and a Done / Stop button. On Done, asks "Finished, or more left?" | This task fit this time and energy. Real duration vs estimate. |
| Not now | Optional one-tap reason: too tired · no time · not in the mood · blocked. Card swaps to the next pick. Task stays hidden for this session only. | The reason adjusts that task's fit for similar moments. "Blocked" marks the task as waiting. |
| Something else | Shows 2–3 alternatives with their why lines. Pick one to start. | The picked task beat the first choice in this context. |

**Empty states.**

- No tasks fit (window too short, everything blocked): "Nothing fits the next 10 minutes. Take the break." No filler task.
- No tasks at all: the chat bar invites a brain dump.

**While a task runs**, Daisey stays quiet. No new suggestions until you stop or finish.

## Task data

Only the title is required. Everything else has a default or a guess, so adding a task takes one sentence.

| Field | Required | Values | Default if missing |
| --- | --- | --- | --- |
| Title | Yes | Free text | — |
| Project | No | Any name the user uses | "Inbox" |
| Size | No | 5 · 15 · 30 · 60 · 90+ min | Guessed from title and similar past tasks; else 30 |
| Energy needed | No | Low · Medium · High | Guessed from size and type; else Medium |
| Due | No | Date, optional time | None |
| Hard due | No | Yes / No | No (soft target) |
| Status | Auto | Ready · Waiting · Done | Ready |
| Waiting on | No | Free text ("Yuval confirms") | — |
| Can split | No | Yes / No | Yes for 60+ min tasks |
| Notes | No | Free text | — |

**Fields Daisey keeps on its own** (never asked):

- Created date, last touched, times skipped and the reasons given.
- Time actually spent across all sessions.
- How many times started and stopped without finishing.

**Recurring tasks** (weekly lesson prep, invoices) use a simple repeat: every N days or on given weekdays. A recurring task appears once per cycle, not stacked.

## Now engine logic

The engine runs in three steps every time the card is shown: read the moment, filter out what can't fit, score the rest. Highest score wins. All weights are starting values, kept as tunable constants in one place.

**Step 1 — Read the moment**

- **Free window**: minutes until the next calendar event, capped at 180. No calendar connected → 60.
- **Energy**: the current guess, or the user's correction if made in the last 3 hours.
- **Time bucket**: morning (before 12) · afternoon (12–17) · evening (after 17), plus weekday vs weekend.
- **Last activity**: which project was last started or finished today.

**Step 2 — Filter (a task is out if any is true)**

- Status is Waiting or Done.
- Size is bigger than the free window, unless it can split and the window is at least 25 min.
- Skipped already in this session.
- Needs High energy and current energy is Low.

**Step 3 — Score (0–100 plus adjustments)**

| Factor | Points | How it's computed |
| --- | --- | --- |
| Urgency | 0–35 | Hard due today or overdue: 35 · hard due within 2 days: 25 · soft due today: 20 · due within 3 days: 12 · within 7 days: 6 · no due: 0 |
| Energy fit | 0–25 | Exact match: 25 · task needs one step less: 18 · task needs one step more: 5 |
| Window fit | 0–15 | Task fills 50–100% of window: 15 · 25–50%: 10 · under 25%: 6 · split piece: 8 |
| Momentum | 0–10 | Same project as last activity today: 10 · touched in last 2 days: 5 |
| Neglect | 0–10 | +1 per day untouched, max 10 |
| Learned fit | −10 to +10 | From history: how often tasks like this were started vs skipped in this time bucket and energy |
| Skip penalty | −8 each | Per skip of this task today |

**Tie-break:** sooner due date first, then smaller size.

**Something else** shows the next 2–3 by score, but forces variety: no two from the same project if another project scores within 15 points.

**Stale tasks.** A task skipped 5 times without starting stops being suggested. Daisey asks once in chat: "Still want 'X'? Keep, shrink, or drop?"

**Building the why line.** Take the two or three factors that contributed most points and turn each into a short phrase, joined with commas:

- Urgency → "due Tuesday" / "overdue"
- Energy fit → "light one, you're low" / "good for high energy"
- Window fit → "fits before teaching" / "fills your free hour"
- Momentum → "keeps Monster Punk going"
- Neglect → "untouched for 6 days"
- Learned fit → "you usually do these in the morning"

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
| Stop without finishing, twice | Task may be too big. Daisey offers to split it. |

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
| A task with a hard due date has no realistic window before it | "Block 90 min Wed 10:00 for mix review?" | Off until tapped |
| You ask in chat to schedule something | The event, shown as a confirm card | Requires ✓ |
| You finish a task | Logs it as a past event ("Done: boss SFX · 47 min") | Setting, off by default |

**What's gone from the old approach:**

- No colour-coded planning blocks that must be followed.
- No auto-filling the day with tasks.
- No Trello sync. Daisey owns the task list.

**Calendar used:** writes go to a separate "Daisey" calendar, so they're easy to hide or delete without touching other events.

## v1 scope

v1 is done when the Now card picks a task you actually start, most days, for one full week, with no other planning tool open.

**In v1 (build in this order):**

- [ ] Google sign-in + Firebase storage, synced across phone and computer
- [ ] Task data model (fields above)
- [ ] Now engine: filter + score + why line, with manual window and energy (no calendar yet)
- [ ] Now card UI with Start · Not now · Something else, Hebrew and RTL ready
- [ ] Running timer and Done flow
- [ ] Server function holding the Gemini key
- [ ] Text chat via Gemini: add task, brain dump, set context, edit, with confirm cards
- [ ] Google Calendar read: free window
- [ ] Energy guess from time bucket + corrections
- [ ] Learning from start, skip reasons, finish times
- [ ] Voice input in chat (browser speech recognition, Hebrew + English)

**Out of v1 (parked):**

- Game layer, combos, streaks
- Calendar writes (blocks and logs)
- Up-next list on the home screen (available via Something else only)
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

## UX additions (built Oct 3, 2026)

What the Now screen actually does, after a pass with Mor. Where this differs
from the sections above, this wins.

**The day plan is gone.** The "Today" panel — hours-free chips plus Daisey's
numbered take on the day — was removed. Daisey picks one task at a time and
never lays out the day, so there is nothing to keep in step when the day
changes. There is no daily check-in either; it was folded into that panel
earlier the same day and went with it.

**Layout.** The Now card stays put at the top of the screen. Under it, one
pane with two tabs — **Schedule** and **Tasks** — both the same height, so
switching never moves the card. Tasks keeps the column-per-project board,
scrolling sideways inside the pane. (An earlier version put all of it in one
sideways slider; the card drifted off screen.)

**Calendar sync.** One shared poll serves the card and the panel: once a
minute while the tab is in front, and again whenever it comes back, so a
change made in Google Calendar shows up within about a minute without being
asked for.

**Schedule panel.** Google Calendar's own day, read-only. One day fills the
panel and the week slides sideways — swipe, or use ‹ › — up to seven days
ahead, with "Back to today" to return. Each event shows its start and end,
a dot in the colour it has in Google Calendar, and the free gaps between
events spelled out; all-day entries are marked, what's running is
highlighted, what's finished is greyed, and a red line marks where now falls
(today only, as Google draws it).
It comes from the same read as the free window, so the panel and the greeting
can never disagree. All-day entries and events marked free never block a pick
— only real, timed, accepted events do.

**Clock.** The local date and time sit in the top bar, beside the name and
the avatar, ticking each minute. Nothing sits above the card but a warning
when there is one. Free time is never asked for; it comes only from the calendar,
and the Schedule panel below says what the day holds. Without a connected
calendar Daisey assumes 60 minutes, which filters out what cannot fit but
earns no points for fitting.

During an event the card is empty — "Nothing to pick until it ends" — with
an **I'm free now** button beside it, because meetings end early and get
cancelled. It ignores that one event (a line under the clock says so, and
offers to put it back) and clears itself once the event is over.

**The card.** It is the hero and the only yellow thing on the screen: project
and size, title, why line, a big **Start**, and three quiet icon actions
under it, each with its sentence as the tooltip:

| Action | What happens |
| --- | --- |
| Later | The card slides out, the next slides in. The skip is counted. |
| Switch | 2–3 alternatives with their why lines; tap one to put it on the card. |
| Pending | Same slide, and the task is set to Waiting. |

After Later or Pending, a toast sits for five seconds offering **Undo**,
which puts the task back exactly as it was. (An earlier version asked for a
reason — tired, no time, blocked — and Mor cut it.)

**The why line, in Daisey's voice.** The proposed card says "I'd do this now:
due today, 5 min, quick win." Alternatives keep the plain sentence, so only
one voice is speaking at a time.

**Focus mode.** Start fills the screen: the task, a running timer, Done,
Stop, nothing else. The run is stored, so a reload or the other device shows
the same timer still going. Past the estimate it asks once, quietly — "Still
on it? +15 min · Stuck" — with no sound and no red. Stop means "pause, still
mine"; Stuck also sets the task to Pending. Done asks "Finished, or
more left?", then hands off: the next task with its why line, Start or Not
now. Real minutes are saved either way.

**Hebrew and English.** Every piece that could be either language is isolated
(`<bdi>`), so "חתונה · 5 min" never reorders itself. Durations always carry
their unit: "1 h 30 min", never "1.5 h" and never a bare trailing number.
Note for later: `\b` does not work on Hebrew letters in JavaScript regexes.

**Still as it was:** tasks are added through the "+" form (a capture bar was
built and rejected — for one task it was no better), and the task on the Now
card stays in its project column with a "now" badge rather than disappearing.
