# Daisey and tools/

Guidance for `tools/` — Daisey and the audio-sync function. The site itself
(`index.html`, `css/`, `js/`) is covered by the root `CLAUDE.md`.

## Reading these files without burning the context window

`tools/daisey.html` is ~7.6k lines and this file is ~1.7k. A session that
`cat`s either one has spent more context on a single command than on every
reply it will write all session. Context is never freed until compaction, so
one careless read is paid for until the session ends.

Rules, in the order they save the most:

- **Never `cat tools/daisey.html`.** Locate first, then read a window:
  `grep -n "renderHighlights" tools/daisey.html` to get the line, then
  `Read` with `offset`/`limit` (or `sed -n '820,880p'`) for the ~40 lines
  around it. The same goes for this file — `grep -n "^## "` for the section
  index, then read only that section's range.
- **Never re-read a file you just edited to confirm the edit.** `Edit` fails
  loudly if the match missed; a successful edit needs no verification read.
  Re-reading a 7.6k-line file to check a three-line change is the single
  most expensive habit available.
- **Run the suite with one command: `cd tools/test && npm test`.**
  `run-all.js` copies `tools/daisey.html` over the gitignored test copy
  first, runs every suite, and exits non-zero if any failed — so a single
  filtered line is all you need:

      cd tools/test && npm test 2>&1 | tail -20

  It prints one `ok`/`FAIL`/`FLAKY`/`DUMP` line per suite plus a summary,
  and dumps only the last 25 lines of any suite that failed. Pass a name to
  run one (`npm test -- states.js`), `--jobs=N` to parallelise.
  **Serial by default, deliberately** — every suite waits on fixed
  `waitForTimeout` durations rather than conditions, so under CPU contention
  `retry.js` fails spuriously (observed at both 4-way and 2-way; 3/3 clean on
  its own). The whole suite is ~4 min serial.
  History, worth knowing before "simplifying" any of this: `npm test` used to
  be the npm stub (`exit 1`), there was no runner, and the 37 files reported
  failure in three incompatible ways — 19 printed `FAIL`, 10 printed
  `[label] ERR` while exiting 0, and four printed raw JSON with no marker at
  all. `grep FAIL` silently passed ten failing files. The runner normalises
  all of it: a suite fails on a non-zero exit **or** on failure text in its
  output.
  **`det`/`edit`/`hub`/`mini` have no assertions and cannot fail** — they log
  state and screenshot. They're reported as `DUMP`, counted separately, and
  never gate the run. That's a real coverage gap to close, not something to
  read as green. (`layout.js`, added 2026-08-26, closes the part of that gap
  that covers Day-view geometry — it asserts, and it discriminates.)
- **Prefer `Read` with `offset`/`limit` over shell `cat`.** When a session is
  in Bash-only/auto mode that tool is unavailable and every read is a raw
  dump. For work in `tools/`, turn auto mode off — the line-windowing is
  worth more here than the shell convenience.
- **`/clear` between unrelated tasks.** Finishing a Daisey change and moving
  to the site means the whole Daisey read history is dead weight. Clearing
  is the largest single reduction available and costs nothing but a reload
  of these instructions.

## Daisey

A daily focus widget over Google Calendar + Trello. One file:
`tools/daisey.html`, published as a Claude artifact.

**2026-08-26 — Week view is gone, and Daisey is day-only now.** Direct user
request: one page, current task made big/bold/dominant, the red now-line
replaced. Every `weekGrid`/`weekBounds`/`goWeek`/`layoutOverlaps` reference
below (and the whole "Week view" mode of `timelineItem`) describes REMOVED
code — read those bullets as history, not current behavior. What's true now:
- **The current task lives in `#heroSlot`**, a flex sibling of `#pageMain`
  above its scroller (`heroCard()`/`paintHero()`), not inside the timeline.
  It's still built via `timelineItem(...,{hub:true})` — same actions, same
  "always open" exemption every "hub card" bullet below describes — just
  rendered somewhere else in the DOM and given hero-scale type
  (`--t-hero` etc.) via `.hero-slot`-scoped CSS.
- **`currentMarker()`** is the timeline's own slim stand-in for current —
  real position/height, no Done/Swap/Pending/Remove (the hero already has
  those), but still drag-to-reorder wired (`wireStackDrag`), since dragging
  the current task to re-sequence the day predates the hero and wasn't
  meant to go away with it.
- **The red now-line is deleted, not restyled.** `nowLine()`/`.tl-now` are
  gone outright. Replaced by a drain wash (`tickDrain()`, the `--drain` CSS
  var, `.drain-fill`) that fills the hero/marker card left-to-right as the
  current task's minutes burn, ticking every second off the existing 1s
  clock interval — not the 60s `render()` cadence.
- **True-to-scale card heights are GONE (2026-08-26, later the same day).**
  `buildDayScale`, `pushForFloor`, `pushForOverflow`, `hourGutter`,
  `hourLines`, `CARD_MIN_HEIGHT`, `SKIP_MIN_PX`/`SKIP_KEEP_PX` and the
  separate hour gutter are all deleted; `.time-row` is back in normal flow
  inside a `.rows.stack` flex column with a 6px gap, and duration is stated
  as TEXT in the rail instead of encoded as pixels. Read every
  "positioned/sized by real duration" bullet below as history.
  The arithmetic that killed it: legible card heights span ~2.3x while real
  durations span 32x, so no honest pixel mapping fits both. A 15-min task is
  ~15px at `TL_PPM_DAY` and needs a ~28px floor to stay readable — so four
  back-to-back quarter-hour tasks claimed 112px of a 60px span, `pushForFloor`
  shoved every later row down to resolve the overlap, and the hour gutter
  (drawn from the UNPUSHED positions) then disagreed with the cards it was
  labelling. Confirmed live from a user screenshot: a 10:00 meeting rendering
  level with the 10:20 mark, four real tasks crushed into a strip while a 5h
  meeting ate 300px of empty colour. That is the exact misreading an hour
  gutter exists to prevent, produced by the gutter itself.
  `pushForOverflow` went with it and needs no replacement — a card in flow is
  as tall as its content, so an opened accordion simply makes its own row
  taller and the browser moves the rest down. The dead-button bug it was
  written for (an open card's actions rendering UNDER the next card) cannot
  recur in flow layout.
  **`tools/test/layout.js` is the guard**, and it discriminates — each
  assertion was verified to fail against a deliberately reintroduced version
  of the specific bug it covers, not merely against the old file: rows must
  not overlap (reproduces the 13px overlap), document order must match clock
  order, height must follow content not duration (catches 297px-vs-28px), the
  rail must state a readable time on one line (catches the vertical
  "09 / :00 / 15m" wrap), and a card must not land in the rail grid track
  (catches the 52px-wide card, a bug that really did ship mid-change).
  Two traps it also encodes, both of which bit during this work:
  `#pageMain .time-row` at ANY depth, not `.rows.stack > .time-row` — the
  lead rows live inside an unstyled `.hub-lead`, so the child selector
  silently saw 3 of 7 rows; and the current task is in the DOM TWICE (hero in
  `#heroSlot`, `currentMarker` in the timeline) sharing one `rowId`, so a
  drag-pool built without de-duplicating it resolves `originIdx` to the wrong
  copy. `retry.js` was reading `#pageMain .now` for the hub and getting
  `currentMarker` — the same task — so it dragged a card onto itself and
  asserted against a move that never happened.
- **Six changes on 2026-08-27, all direct user requests.** In order:
  1. **The rail states start AND end** (`09:00` over `09:15`), not start over
     a duration chip. "When am I free again" is the question a schedule gets
     asked; a duration makes you do the arithmetic.
  2. **The hero keeps `.time-row`'s grid and shows its own rail**, so its card
     starts at the same x as every list card. It used to be `display:block`
     with the rail hidden — the one card meant to dominate was also the only
     one out of alignment. Note the trap the old comment there warned about
     and got backwards: hiding `.rail-stop` with `display:none` removes it
     from grid placement, which shoves `.card-col` into the empty FIRST track
     (measured 10px wide). The fix is to KEEP the rail, not to abandon the
     grid.
  3. **`swapTo` never dropped its local stand-in.** `localBlock` put a
     stand-in in the slot, `createBlock` added the real event, and both stayed
     in `S.events.payload.events` — so a swapped-in card rendered TWICE at the
     same minute, one of them not real. `applyPlan`
     (`settled.forEach(s => dropLocalEvent(s.id))`) and `commitRelay` (via
     `w.realId`) had always dropped theirs; this one path never did. That is
     the whole of "swap switches to wrong tasks" — the card was right, the
     duplicate was not. **A first attempt made it worse**: dropping the
     stand-in and re-adding a copy keyed to the real id just reproduced the
     duplicate under a new id, because the connector's create response is
     already merged into that array for you. Drop only.
     `swap.js` now COUNTS occurrences rather than using `allEvents().find()` —
     every previous assertion took the first match and so passed against a
     duplicate. Verified to fail (2 events, 2 rows) against the pre-fix code.
  4. **Cards carry their list's colour** (`listCss`/`listKey`/`listHue`/
     `listClass`). **Trello lists have no colour** — confirmed against the
     real connector this session, not inferred: `trelloReadList` returns
     `id`, `name`, `position`, `objectId` and nothing else. Colour in Trello
     belongs to labels and board backgrounds. So Daisey assigns one, on
     exactly the board mechanism: a generated `--l-<key>`/`--l-<key>-soft`
     pair plus `.lk-<key>` setting the same `--bc`/`--bc-soft` every card
     already paints from. The key hashes the list NAME, not its id — a list
     is known by what it's called, and an id change must not repaint the day.
     `CFG.colors["list:<lowercased name>"]` overrides, so a picker can pin one
     later with no code change.
     **The tint is scoped to `.item[class*="lk-"]`, and that matters.** A
     first version put it on plain `.item`; breaks and meetings set
     `--bc-soft` too (`.bk-break`, `.bk-none`), so they got tinted as well —
     re-breaking the 2026-08-25 translucency fix, where a break's azure wash
     let the grid show through. `brk.js` caught it on the same run. Neither is
     a card on a list.
     Because list names come from the CARDS, these rules cannot all exist at
     boot the way board rules can — `refreshListCss()` runs from `render()`
     and rewrites them only when the set of names actually changed (rewriting
     a `<style>`'s textContent restyles the whole document).
  5. **Action buttons are filled at rest**, one hue each: Done yellow, Swap
     dark blue (`--deep`), Pending light blue (`--sky`, a new token —
     deliberately a different FAMILY from `--deep`, since the two sit adjacent
     in every row), Remove red, Details grey. They used to be neutral rings
     that only coloured on hover, which on a phone meant never.
     **Done is the one exception to white glyphs**: white on `--accent`
     yellow is ~1.6:1 and fails outright, so it uses the same dark ink the
     yellow rebuild/progress-pill buttons already use. The others clear 4.5:1.
  6. **The "Day" tab is gone and the clock took its space** — two rows, full
     weekday name (`tickClockWidget` no longer slices `DOW`), 30px time.
     The switcher now holds one button, so it **toggles**: tapping Projects
     while on Projects returns to Day. Without that, entering Projects was a
     one-way trip with nothing on screen to get back with.
  Also fixed while in here: `.item` was still `position:absolute` (a
  true-to-scale leftover that only worked because `.time-row`'s grid
  re-established a containing block), and `currentMarker` had no padding — it
  rendered as a bare glowing outline with its title against the edge, which
  read as an error state once it also picked up a list tint.
- **The hero title is HARD-CAPPED at 2 lines, never shrunk further**
  (2026-08-27, `clampHeroTitle`, user report the hero was "still big" after a
  first font-size-only pass). `fitRowTitle`'s shrink-then-wrap is wrong for
  the hero specifically — it exists to keep an ordinary row's small type
  readable, but the hero is deliberately the biggest text on screen, so
  shrinking a long title to fit defeats the point of it being the hero. A
  real 32-character Hebrew title still ran to 3-4 lines at full size on a
  phone even after the font shrink; truncating with an ellipsis keeps the
  type size fixed and the card's footprint bounded, with the full text one
  tap away via the card's own ↗ link.
  **Two real, separate bugs shipped while building this, both worth knowing
  if the function is touched again.** (a) A first version binary-searched
  over character count for the longest cut that fit — which assumes
  "shorter text wraps to no more lines than longer text," false for
  bidi/RTL content: cutting one exact real title at 26 characters measured
  2 lines, at 25 (one shorter!) measured 3, at 24 measured 1 — cutting a
  word across a bidi reorder boundary can move it to a different visual
  line, so line count isn't monotonic in character count. A binary search
  over a non-monotonic function converges to an arbitrary point, which is
  how this shipped truncating a 2-line-worthy title down to 1 line. Fixed
  by stepping down one whole WORD at a time and stopping at the first
  length that fits — monotonic by construction, since each step only
  removes text. (b) Separately, the 2-line height budget itself
  (`lineHeight*2+1`) was too tight by ~1.5px against how a real 2-line box
  actually measures — a genuine 2-line render at `lineHeight:23.76`
  measured 50px, not the predicted 47.52 — so even a correct search
  rejected a real 2-line fit and stepped down anyway. Needed `+3`, not
  `+1`. Both bugs combined in what shipped; verified (b) alone (correct
  word-step search, wrong cap) still reproduces independently, so both are
  guarded, not just their combination.
  `layout.js` is the guard, using a real long Hebrew title rather than the
  fixture's short English ones — the bug only shows up with RTL content.
  Its assertion is a FLOOR on surviving character count (44+ for that exact
  title), not a ceiling: a height cap alone can't distinguish "correctly 2
  lines" from "wrongly truncated to 1 line," since 1 line is *less than* a
  2-line budget and passes a ceiling check trivially — confirmed by writing
  that assertion first and watching it pass against the broken code.
- Any test selector reading `#pageMain .now`/`#pageMain .mini.info`/
  `#pageMain .details` etc. against a fixture with only ONE task that day
  is stale — that task is `current`, and current no longer renders inside
  `#pageMain` at all. Scope such selectors to `#heroSlot` (or both) instead.
- **The rail column is GONE (2026-08-27), replaced by an in-card time badge.**
  Direct user request, "insert start-end time to the left anchor inside
  cards, just like Google Calendar cards have": `.time-row` used to be a
  fixed two-track CSS grid (a `.rail-stop` column outside the card, holding
  start/end, plus the card itself); it's now `display:block`, one column,
  and every card states its own start–end range inside itself via
  `rowLead`'s `.t` span (top-left, beside the list-colour dot) — same
  mechanism `rowLead` already used for Week-grid rows, just re-enabled for
  stack mode. `timelineItem`, `heroCard` (via `timelineItem`), and
  `currentMarker` all build this the same way; `quietGap`/`offHoursCard`
  print their own start as plain text instead (`.quiet-start`/
  `.offhours-start`) since they were never cards with a title to anchor a
  badge next to. `.rail-stop`/`.rail-end` no longer exist anywhere in the
  file — don't reintroduce a selector that reads them.
  `layout.js` (checks 4/5, now reading `.row-lead` instead of `.rail-stop`)
  and `rail.js` (its whole premise) are the guards; both were rewritten in
  the same change, not just the app. One measured, accepted side effect:
  removing the rail's own grid track also removed a quirk where EVERY row
  in that grid was forced to match the tallest thing beside it — a plain
  15-min task used to measure 44.5px purely because the rail needed that
  much room, not because the task's own content did. It's now honestly
  31.5px; `layout.js`'s height-ratio check widened from 2x to 2.2x to
  match, which is the ratio becoming more truthful, not the app regressing.
- **The hero card now scrolls with the rest of the list (2026-08-27),
  direct user request: "sliding down the app should also affect main
  card."** `#heroSlot` used to be a fixed flex sibling ABOVE `#pageMain`'s
  own scroller (see the 2026-08-26 hero bullet below) — permanently
  visible, never moving. A new `#scroller` wrapper now holds BOTH
  `#heroSlot` and `#pageMain`, and `overflow-y:auto` moved onto it; `.page`
  itself is back to normal block flow. `#heroSlot` stays a separate
  sibling of `#pageMain`, NOT nested inside it — `paintMain` does
  `host.innerHTML=""` on `#pageMain` every render, which would destroy
  `#heroSlot`'s own DOM node (and `paintHero`'s `$("#heroSlot")` lookup
  with it) if it lived inside that subtree. Any test scrolling the list
  now needs `#scroller`, not `.page` — `rail.js`'s touch-swipe check and
  `pages.js`'s drag-scroll-into-view fixup were both updated.
- **A missed task can no longer become the hub (2026-08-27), direct user
  request: "if the time has passed from the card's time it shouldn't be
  the main card... if he passed a task without touching it it should turn
  to another color to say you missed me."** `splitAgenda`'s `current`
  picker had a third fallback, `open[0]` ("day's over, still open") —
  unconditional once nothing was "happening now" or "still has time left,"
  so it always re-adopted the EARLIEST open task even when that task's own
  slot had already passed. That's the exact bug: a task skipped without
  being touched got re-presented as the current focus instead of reading
  as missed. Fix was a deletion, not new logic — `open.find(i=>i.e2>nowMin)
  || null`, no third fallback. The "another colour" half of the request
  needed no new CSS: `.item.miss` (grey surface, muted text, red time
  badge) already existed and already fires once a task falls out of
  `current` into `missed` — it just could never be reached from a fully
  passed day before, because `open[0]` always claimed that task as hub
  first. `missedCount` is threaded through `paintHero`/`emptyNow` so "no
  current task" gets honest copy: "You missed some tasks" when the day
  still has real open-but-slipped work, vs. "Day clear"/"Nothing
  scheduled" only when that's actually true. The day-complete `celebrate()`
  burst is gated on `!missedCount` too, for the same reason.
- **Action buttons re-mapped colours (2026-08-27), direct user request.**
  Done green (`--done`), Swap light blue (`--sky`), Pending yellow
  (`--accent`, swapped from Done — carries the same dark-ink-on-yellow
  contrast exception Done used to need, since white-on-`--accent` still
  fails ~1.6:1), Remove unchanged red. Details (`.mini.info`) dropped its
  solid grey fill for a ghost/outline treatment (`--surface-2` fill,
  `--line-2` border, `--ink-2` text) — user asked for "something more
  subtle," since it's a disclosure toggle, not a committing action like
  the other four, and was reading as a fifth equally-weighted button.
- **Hero redesign — thick spine, chunky buttons, next-up card, schedule
  link (2026-08-28), direct user request via an approved Claude Design
  canvas ("juicier and more colorful", "see the entire Headline — always",
  "a next up small card under it", "an option to see the day's
  schedule").** Two directions were sketched on the canvas — a full
  gradient-wash hero vs. a flat card with bold chrome — and the user
  picked the flat one; the gradient direction was NOT built into the app.
  Four pieces, all in `paintHero`/the hero CSS:
  1. **The hero title is never truncated any more** — `clampHeroTitle`
     (2026-08-27's hard-2-line-cap-with-ellipsis) is DELETED outright, not
     adjusted. That function existed specifically because a full title at
     hero scale used to run to 3-4 lines and read as "too much card"; this
     request reverses that judgment call on purpose ("the user can see the
     entire Headline — always"), so the title now simply wraps to however
     many lines it needs. `layout.js`'s guard (which used to assert the
     opposite — never exceed 2 lines, keep 44+ characters before an
     ellipsis) now asserts the full fixture title survives verbatim with
     no ellipsis; same long real Hebrew title fixture, flipped assertion.
  2. **A 10px board-colour spine** (`.hero-slot .item.hub::before`, a
     top-to-bottom `--bc`→`--bc-soft` gradient) sits ON TOP of the existing
     `--bc-soft` wash every `.lk-<key>` card already gets — not a
     replacement. The wash tints the whole surface; the spine is a louder,
     separate identity mark for the one card meant to dominate. `.item`'s
     existing `overflow:hidden` clips it to the card's own radius for
     free, so this needed no new clipping logic.
  3. **Hero action buttons are chunkier with a solid "pressed" bottom
     edge** — 42px (was 38px), `box-shadow:0 3px 0 <a darker shade of the
     button's own colour>` instead of a soft blur, and `:active` drops the
     button 2px and removes the shadow so it visibly presses in. Scoped to
     `.hero-slot .item.hub .mini` only; the list's own `.mini` buttons
     (`tools/CLAUDE.md`'s 2026-08-27 colour bullet above) are untouched.
  4. **`nextUpCard()` and `scheduleButton()`** are new, built in
     `paintHero` alongside `heroCard()` — NOT via `timelineItem`/`rowLead`,
     since neither is a row in the list (no drag, no accordion, no action
     buttons of its own). `splitAgenda()` grew a `nextUp` field: the
     earliest `open` entry strictly after `current`'s own start
     (`open.find(i => i !== current && i.s > current.s)`) — not
     `open[current_index+1]`, since a meeting/missed task can sit between
     them in `items` without being in `open` at all. **`nextUpCard` reads
     `item.s`, never `item.ev.start`, for its displayed time** — a real
     bug caught before shipping: a brick sibling (a merged quick-task
     window, see the brick bullet elsewhere in this file) shares one
     Google Calendar event across several tasks, so `ev.start` is the
     WHOLE WINDOW's start, identical for every sibling; `item.s` is this
     task's own real slice. Using `ev.start` showed "next up" at the same
     clock time as the hero above it, for a different task — confirmed
     live against the real-events fixture (a genuine brick there) before
     the fix. Clicking the next-up card opens that task's real row below
     via the normal `S.openRow` accordion and scrolls it into view; it is
     a preview, not a second place to act on the task.
     `scheduleButton()` does not open a new view — Daisey has been
     day-only with no separate schedule screen since 2026-08-26, and the
     "day's schedule" already IS `#pageMain`'s own list, rendered right
     below the hero inside the same `#scroller` (see `.scroller`'s own
     CSS comment). The button is a plain `scrollIntoView` affordance onto
     that existing list, not a feature to keep in sync with anything.
     Both are skipped when there's no `current` — the empty states
     (`emptyNow`: nothing scheduled / day clear / you missed some tasks)
     already say the relevant thing for that case, and "see the schedule"
     would be pointing at what's already on screen.

**Canonical artifact URL — always update this one, never publish a new
artifact for Daisey:**

    https://claude.ai/code/artifact/9b19af95-0f72-418d-9fe8-04627957ff67

Publishing without that URL creates a *second* Daisey and leaves the
user's home-screen shortcut pointing at a stale copy.

### Open work (2026-08-17)

Items 1–3 below are **done** (2026-08-17, with the connector available), and
the `moveAssetTo` fix from item 3 is **published**. The `settings.js`
failure recorded here (four swatches vs three, internal scroll at 667px) is
**fixed** — it passes as of 2026-08-26. The whole suite is green: 32 passed,
0 failed, plus the four dump-only files that carry no assertions.

1. ~~**Migrate the assets.**~~ Done: 22 asset cards now live on
   `Monster Punk — Audio`, 21 in Waiting and "Music: GameLoop Music" in
   In Progress, placed off the `Progress` column of the Drive sheet
   "MonsterPunk - Sound & Music" (everything else reads Not Started
   there). The expectation written here was wrong in a useful way: the
   sounds were *already cards* on PROJECTS → "MonsterPunk" (note: no
   space), expanded from the "רשימת SFX דחופה" checklist by an earlier
   session, so this was a cross-board move, not a checklist expansion.
   That checklist still exists, all six items unticked, and its card is
   still orange (8h) — an unfinishable punch-list card, i.e. the exact
   rollover hazard item 2 warns about. Left alone deliberately; it's the
   user's call whether it goes green, gets archived, or stays.
2. ~~**Create the session cards.**~~ Done: 8 on PROJECTS →
   "MonsterPunk", each scoped so one sitting finishes it and each naming
   the tracker assets it covers — 6 yellow (unicycle enemy batch, boss
   smashes + green fire, boss mine-shot chain, player + weapon cues,
   FMOD boost-bus leak fix, FMOD boss engine) and 2 orange (implement
   approved combat SFX, FMOD combat mix pass). Music sessions were *not*
   created: cards 13/14/46/59 already cover menu, GameLoop, home and
   main-stage music, and a duplicate would have double-scheduled them.
3. ~~**Verify `moveAssetTo`'s write shape.**~~ Verified, and it was
   **wrong** — fixed in `tools/daisey.html`, not yet published. The real
   move is `{action:"move", cardId, listId}` (plus `boardId` when the
   destination is on another board, and an optional `pos`). The guessed
   `{action:"update", cardId, listId}` could never have worked: `update`
   takes only `name`/`desc`/`due` and rejects the call outright, so every
   move from the Assets view would have snapped back into the
   unsaved-changes bar. Observed across the 25 real moves in item 1.

### Working on it

- Edit `tools/daisey.html`, then republish to the URL above.
- Tests: `cd tools/test && npm i playwright && npm test` (see
  `tools/test/README.md`). They drive the real page in Chromium against
  a stubbed connector bridge — no network, no real writes.
- **You no longer need to copy the page into the test dir by hand.**
  `run-all.js` does it on every run, before anything else. Every test reads
  `tools/test/daisey.html`, a gitignored copy, and that copy used to go
  stale silently — the suite would then pass against whatever the file said
  last time somebody copied it. Not theoretical: a `moveAssetTo` fix was
  "confirmed" by a green `tracker.js` still driving the old shape, and only
  the printed write payload gave it away. Running a single suite directly
  (`node states.js`) still bypasses the refresh, so `npm test -- states.js`
  is the safer way to run one.
- Run `assert.js` and `cap.js` after any change to the scheduling
  engine; they cover the rules the widget promises. Run `tracker.js`
  after any change to `candidates()`, `BOARDS`, or the Assets view.
  Run `setup.js` after any change to `SETUP`/`applySetup`/`setupWizard`, the
  boot sequence, `injectBoardCss`/`applyColors`, or anything reading
  `BOARDS`/`CAL_ID` — it is the only suite that exercises a viewer who is
  **not** this app's author.
  Run `offhours.js` after any change to `offHoursGap`, `timeline()`'s row
  assembly, `breakGaps`, or `CFG.dayEnd` handling.
  Run `layout.js` after ANY change to Day-view geometry — `timeline()`,
  `timelineItem`'s row assembly, `currentMarker`, `quietGap`, `.time-row` /
  `.rows.stack` / `.rail-stop` CSS, or anything that reintroduces a computed
  top/height. It is the only suite that would catch cards overlapping, a card
  landing in the rail track, or duration creeping back into card height. It
  also covers `clampHeroTitle` (see below) against a real long Hebrew
  title — run it after touching that function or the hero's title/line-height
  CSS, since the bug it guards only shows up with RTL content, never with
  the fixture's own short English titles.
  Run `rail.js` after any change to the Day-view time rail (`.rail-stop` /
  `timelineItem`'s rail block), to `.item.stack`'s selection or touch-action
  CSS, or to `wireStackDrag` — it covers both the start-times-only rail and
  the press-and-hold-drags-instead-of-selecting behaviour.
  Run `proj.js` after any change to the Projects view, the mirrored
  audio scoring, or `S.stats` persistence — **and after any edit to
  `netlify/functions/audio-sync.js`'s `classify`/`splitSubject`**, since
  that suite is the only thing holding the two copies of that scoring
  together (see the Projects manager bullet).
- **Several sessions edit this file at once.** The publish ships the
  *whole* file, so check `git diff tools/daisey.html` before publishing
  and expect to find other sessions' half-finished work in it — say so
  rather than shipping it blind. On a publish conflict, re-read and merge;
  `force:true` silently discards whatever the other session published.

### Rules that are deliberate, not accidental

- **Daisey is multi-user as of 2026-08-24 — nothing identifies its author any
  more** (`SETUP`, `applySetup`, `setupWizard`, `loadSetup`/`discoverSetup`/
  `legacySetup`). It used to hardcode one calendar address, one Trello
  workspace id, four board ARIs, and `"sidurim"` as the state card's home.
  Handing the artifact to anyone else gave them a permanent skeleton — or,
  if a connector resolved, **the author's own calendar inside their app**.
  Auth needed no work at all: the `mcp` capability already runs every
  connector call with the **viewer's** credentials ("a published page runs
  for many viewers"). Only *identity* was hardcoded.
  Now a first-run wizard lists the viewer's real boards (`trelloReadBoard
  list`), lets them tick which to schedule and flag trackers, pick a calendar
  (`list_calendars`), choose which board hosts the state card (creating the
  `📊 Daisey (widget state — do not edit)` list with `trelloWriteList`), and
  set a day off.
  **`BOARDS`/`TRACKERS`/`SCHED_BOARDS`/`TRACKER_KEYS`/`CAL_ID` are now `let`,
  reassigned together by `applySetup`.** That is the whole reason this was a
  small change: all ~30 consumers read them at call time, so keeping the
  names meant not rewriting 30 sites.
  **Board keys are `b0`,`b1`,… minted once and never recomputed.** Not slugs:
  `סידורים` is not a usable CSS identifier, and a Trello *rename* must not
  change a key or `CFG.colors`, `CFG.boardPriority` and `S.stats.projects`
  orphan simultaneously. An edit matches existing boards by ARI to keep their
  key; indices are never reused.
  **Persistence is state-card-first, localStorage-cache-second, and that
  order is load-bearing.** Every `localStorage` call here is already
  try/catch'd because it throws `SecurityError` on the harness origin and has
  never been verified in the real artifact — and it does throw in the
  harness, confirmed. A cache-first design would re-run the wizard on every
  load if storage is blocked. So a cold start scans the viewer's boards for a
  state card carrying `setup` (`discoverSetup`), which always works.
  **The author's own install is preserved by `LEGACY_SETUP`, gated on
  capability rather than a flag**: boot asks Trello for his סידורים board and
  adopts the legacy config only if the viewer's credentials can actually see
  it. Anyone else gets nothing there and goes to the wizard, so his boards
  can never leak. The legacy keys are kept **verbatim**
  (`projects`/`sidurim`/`sedco`/`mpaudio`) — renumbering them to `b0..b3`
  would orphan his saved colours, priority and `projects.mpaudio` at once.
  **The Projects tab hides when there's no `batchBoardKey`.** That view is
  entirely downstream of the audio-sync Netlify function, which nobody but
  the author runs, so for anyone else it could only ever be an empty tab.
  Configuring it was considered and rejected as worse than hiding it.
  `DEFAULTS.boardPriority` and `DEFAULTS.openEvents` are now `[]` — both were
  the author's. **`normalizeCfg` already handled a changed board set** (drops
  unknown keys, appends new ones), which is why an empty priority degrades to
  setup order instead of breaking. Note `pages.js` depended on the `openEvents:
  ["חמל"]` default to make that meeting permeable; the fixture now seeds it in
  the state card's `settings`, which is where a real user's would live.
  **A connector the viewer hasn't added is the likeliest first-run state**,
  and the wizard handles it as a real state, not an error: the step shows
  `errCopy`'s per-code text ("Add Trello in claude.ai → Settings →
  Connectors"), and the primary button becomes **"Try again"** rather than
  "Next" — pressing Next there would have answered "Pick at least one board",
  blaming the viewer for a missing connector. `blocked` is the flag; `show()`
  clears it, and the click handler re-runs the step instead of validating.
  `setup.js` drives the whole recovery: disconnected → correct copy → retry
  → 4 boards load → button returns to "Next".
  See `setup.js` for the eight cases that separate "works for anyone" from
  "works because I'm the author".

  **A sendable copy lives in `share/`** (`daisey.html` + `README.txt`), built
  by stripping the `LEGACY_*` block — it holds the author's own calendar
  address and board ids, which are inert for anyone else (the gate needs his
  board to be *visible*) but shouldn't travel in a file he hands out. With it
  gone `legacySetup()` is a no-op and boot goes straight to the wizard.
  The file is NOT double-clickable: it needs `window.claude`, so opening it
  from disk shows "Live data isn't available here". The README tells the
  recipient to have Claude publish it as an artifact **with all 12 tools
  declared** — a short manifest means parts of the app fail silently.
- **Caps, day window, block lengths, day off, board colours and
  the chime are user settings** (gear icon), stored in the Trello state
  card under `settings` and read into `CFG` at boot. `DEFAULTS` holds
  the shipped values: up to 4 quick tasks sharing one 60-min window, 1
  short session x 3h, 09:00-20:00,
  Saturday off. Never hard-code these again.
  **The 8h "long session / work day" tier is GONE as of the 2026-08-25/26
  redesign** — `workdayMax` no longer exists anywhere in `daisey.html`, and
  `existingBlocks` returns only `short`/`quick`/`total`/`foreign`, bucketing
  everything non-short as quick. Every `long`/`workdayMax` mention below is
  history, not current behaviour. This was invisible for a while because
  `work.js`, `start.js` and `tmr.js` all asserted against `have.long` — which
  reads `undefined` against the current app — and nothing was running them.
  `sessionMax` (2026-08-18, default 2) caps how many sessions `planFor` will
  place in one day, counting blocks already on the calendar the same way
  `quickMax` always has. **`buffer` ("Breathing Room") is gone
  (2026-08-18, user request)** — it padded both sides of every session
  and, since 2026-08-18, one side of a meeting's exit (the "no session
  starts the instant `חמל` ends" fix); the user found it confusable with
  the separate, real Break feature and asked to cancel it outright.
  `busyFor` now returns raw, unpadded intervals — no `raw` param left to
  distinguish padded from unpadded, since there's no padding to strip.
  `rescheduleTo`, `pushReorder` and `planFor`'s own session/quick busy
  pushes lost their pad math too. A session can now start (or a
  drag/push can now land) the instant a meeting or another session ends,
  with zero gap — that's intentional, not a regression. `quickMax`
  (2026-08-17,
  default 4) is the settings-panel cap on how many quick tasks the
  quick-task window in `planFor` will ever pack in — before it, the
  window just kept shrinking each candidate's slice to fit however many
  quick cards existed that day, no ceiling on count. `choreDays`'
  default (2026-08-17) also dropped Saturday for all four chores, to
  match `dayOff:6` — chores used to default to all 7 days regardless of
  the day-off setting.
- **"Daisey decides" (`breakHour:null`) now forces a break after 3h of
  continuous activity, not just whatever's left over** (2026-08-18, user
  report: a 6h meeting ran to 18:00, a session packed on right after it
  to 21:00, and the only break landed at 21:00 — nine straight hours
  before any break appeared). Before this, `breakHour:null` meant
  `reservedBreak()` reserved nothing at all; `breakGaps()` only ever
  surfaced whatever gap happened to survive after every session was
  placed, so a session greedily packed onto the earliest free slot could
  butt straight up against a meeting with zero break between them.
  `findSlotWithAutoBreak` wraps the long/short session `findSlots` calls:
  before accepting a slot, `contiguousRunBefore` checks whether it starts
  right after 3h+ (`AUTO_BREAK_MIN`) of unbroken activity, and if so
  reserves a real `CFG.breakLen` break there first (same "hold the slot
  open" mechanism the user-pinned `breakHour` already used), then
  re-searches — same "reshape around it" pattern, chosen directly over
  a softer "prefer it" option on user request. A separate `activityLive`
  set (meetings + placed sessions only, no breaks) tracks the contiguous
  run — pushing the break into `activityLive` too would count it as more
  activity and the run would never reset. Scoped to long/short sessions
  only, not quick tasks or a fixed user-picked `breakHour` (that's still
  a deliberate, unmoving pin).
- **A card's size comes from its Trello label, not its board**
  (`sizeFromLabels`): no label = quick task, yellow = short session
  (3h), orange = long session / work day (8h), green = info only, not
  scheduled. `card.size` and `event.size` (read back from the Google
  Calendar colorId: 9 quick, 5 short, 11 long) drive every scheduling
  decision — board is now only colour identity. `BOARDS` lists the three
  real work boards (PROJECTS, סידורים, סדקו); there is no separate "today
  priority" board — this widget's own live schedule replaces that. The
  hidden Daisey state card lives on סידורים, in its own "📊 Daisey
  (widget state)" list. The green exclusion was dead code for a long
  while: `candidates()` filtered on `c.labels?.some(...)` but `normCard`
  never put `labels` on the object it returned, so the optional chain
  quietly made it a no-op and green cards got scheduled anyway. `labels`
  now comes through whole — don't distil it down to `size` again.
- **A `tracker` board is read and editable but never scheduled**
  (`isTrackerCard`, excluded in `candidates()`). `BOARDS` now has a fourth
  entry — `mpaudio`, "Monster Punk — Audio", board id
  `6a82c2cd37d859bc17a06fb8` — carrying `tracker:true`.
  It exists because the tracking unit and the scheduling unit are
  genuinely different sizes: one FMOD sitting covers a dozen sounds, so
  100+ assets each with a state can't be cards in the scheduling pool
  (unlabelled = quick task, and the day has room for 3 of those). The
  assets live on the tracker board with **lists as pipeline stages**
  (Waiting → In progress → In review → Fixing → Approved → Implemented);
  the *session* cards that Daisey actually schedules stay on PROJECTS.
  Lists mean nothing to the scheduler everywhere else in this app; on a
  tracker board they are the entire point, which is exactly why it has to
  sit outside the pool. Only two places needed to know: `candidates()`,
  and `saveStats`'s "has Trello answered" gate, which uses `SCHED_BOARDS`
  so a slow 100-card board can't stall every settings write behind it.
  `BOARD_ORDER` and `catWeight` deliberately needed nothing — tracker
  cards never reach ranking at all. The green label is *not* how this is
  done: green only excludes a card that is otherwise in the pool, and a
  green card is invisible inside Daisey (not scheduled, not in the swap
  picker, not tracked for rollovers), so it was useless as a backlog
  shelf. The board boundary is the mechanism.
- **The Projects view turns a deadline into a pressure read** (2026-08-23,
  `projectsView` / `projectSnapshot` / `deadlineDialog`, third button on the
  view switcher). The gap it closes: `audio-sync.js` sizes batch cards by a
  fixed heuristic, so 40 sounds due in three weeks and 40 due in three months
  produced identical cards — nothing anywhere knew the project's deadline. The
  deadline now lives in `S.stats.projects`, keyed by **tracker board key**
  (`mpaudio`), not project name: the key is a literal in `BOARDS`, while the
  PROJECTS list name is a fuzzy-matched derivative, so a Trello list rename
  would orphan a name-keyed entry. `normProjects` validates it on the way in
  because `parseStats`' `Object.assign` is shallow and would pass a corrupt
  value straight through.
  **Read-only by design.** The only thing it ever writes is the deadline the
  user typed. Writing computed `due` dates onto batch cards was considered and
  rejected: it mutates cards the user owns, and a synthetic date slipping turns
  a batch into tier-0 "overdue" for a date nobody set. Raising `CFG.workdayMax`
  was rejected for the same class of reason — density is expressed as advice
  ("at 24 pts/card it's 6 cards instead of 9"), not as a silent config change.
  **A day is 16 points — one work day — not the additive
  `workdayMax*16 + sessionMax*6` that `CFG` literally permits.** 8h plus two 3h
  sessions exceeds an 11h window, so the additive number describes a day nobody
  has; `planFor`'s own "a long session takes the whole day" agrees. Chosen
  deliberately on user request, and it is the single most load-bearing constant
  here — it scales every pressure number by ~1.75x.
  Runway is counted in **schedulable** days (`countWorkDays`, skips
  `CFG.dayOff`), starting tomorrow: a calendar count overstates a three-week
  runway by ~3 days, and a deadline read that flatters itself is worse than
  none. A passed deadline gives 0 supply and `Infinity` pressure, which lands
  in the "Over" band without a NaN leaking into the bar width.
  **Two ARI-vs-raw-id traps, both silent** (`bareId`): everything Daisey holds
  is ARI-wrapped, everything `audio-sync.js` writes into a marker is a raw
  Trello id, because it uses REST directly. Both the `board=` check and the
  covered-items set have to normalise *both ends*. The second one was a real
  bug caught only because `proj.js`'s fixture was written with the raw ids
  audio-sync actually emits — with an ARI in the fixture it passed against code
  that could never have matched live data, and every already-batched asset
  would have been silently counted twice, inflating pressure worst on exactly
  the projects furthest along. `covered.add(bareId(...))` without the matching
  `covered.has(bareId(...))` was the shape of the mistake.
  **The scoring is duplicated from `netlify/functions/audio-sync.js`, on
  purpose and unavoidably** (`audioClassify`, `splitSubject`, `audioScoreItems`,
  `AUDIO_MARK_RE`, the caps). That file is a CommonJS Netlify function, this one
  is a single-file artifact with no build step — there is no import path between
  them. **Tune a keyword list in one and you must tune the other in the same
  commit.** `proj.js` test 1 is the actual guard: it lifts the real
  `classify`/`splitSubject` source out of the `.js` file with a brace-walker and
  runs it beside the page's copy over a 17-word table. The chain-merge is not
  optional — without it a 4-part `"<Name> - <part>"` chain scores 8 instead of
  4, and Monster Punk has a real one (Mine Shot).
  **Music point costs (16 for a ≥1min production track, 6 otherwise) are
  inferred, not read from audio-sync.** That function's own `pts` (3/8) are
  commented "record-keeping only; label is what schedules it", so they can't be
  used as capacity. First constant to tune if the read looks wrong against the
  real tracks.
  One scheduling hook, and only one: `projectPressureOf` in `tierOf`. A batch
  card carries no Trello `due` — the deadline is on the *project* — so the due
  tier never fired for one and a whole audio project ranked below any single
  dated errand until it was already late. An over-pressure project's marked
  cards get **tier 2**, not 0 or 1: a card that genuinely blew its own date
  still outranks one whose project is merely over-committed. `snapshotFor`
  memoises per painted frame because `tierOf` is called O(n log n) times inside
  `rankCards`' sort and `projectSnapshot` walks `allCards()`.
- **Moving an asset along the pipeline is reachable again, via a segment row
   in the Projects view** (2026-08-24, `segmentAssetsDialog`). Between
  2026-08-17 and this change the feature was *dark*: `pipelineView`,
  `assetMoveDialog` and `moveAssetTo` all existed and were covered by
  `tracker.js`, but the only thing that ever set `S.view="pipeline"` was the
  test itself — the user had no way in, and the tests kept passing the whole
  time, which is exactly why nobody noticed. The user asked "how do we move a
  project's card from Waiting to another list?" and the honest answer was
  "you can't". Tapping a segment (`.proj-seg`, now a `<button>`) opens that
  subject's assets with each one's current stage, tapping one opens the
  existing `assetMoveDialog`, and `moveAssetTo`'s `render()` refreshes the
  Projects view underneath. `projectSnapshot`'s `subjects[]` carries
  `cards:[…]` for this; `audioScoreItems` ignores the extra field.
  Chosen over restoring a fourth switcher tab: the segment you're already
  looking at is the context you'd be picking an asset from. `proj.js` test 8
  drives the whole path through to the real `{action:"move", listId}` write,
  specifically so this can't go dark a second time.
- **The Assets tab is pulled from the switcher (2026-08-17), the code
  behind it is not.** The plan is to run the tracker board in the
  background instead of as a tapped-into view, so `pipelineView`,
  `assetMoveDialog`, `moveAssetTo`, and the `pipe-*`/`asset-*`/`stage-opt`
  CSS all still exist — just unreachable, since the `<button
  data-view="pipeline">` that was the only thing ever setting `S.view =
  "pipeline"` is gone. `tracker.js` now drives that view directly
  (`S.view="pipeline"; render();`) instead of clicking the removed button.
  Nothing about `candidates()`'s tracker-board exclusion or `BOARDS`'
  `mpaudio` entry changed — cards still stay out of scheduling the same
  way. The rest of this bullet describes the still-present, now-dormant
  view, kept for whatever the background rework reuses:
  **`.dash.pipe-mode` and `paintHeader`'s `dateless` flag now cover two
  views, not one** (2026-08-23) — Pipeline and Projects both hide prev/next
  and `.dash-center`. The class name was deliberately *not* renamed to
  something like `dateless-mode`: `rules.js` and `chrome.js` both select on
  it, and the rename buys nothing behavioural. Read it as "dateless view".
  The `"pipeline"` *identifier* was equally deliberately not reused for
  Projects — `tracker.js` drives the dormant view by setting
  `S.view="pipeline"` directly, so overloading the string would break that
  suite in a confusing way.
- **The Assets view is the tracker board's kanban** (`pipelineView`,
  `S.view === "pipeline"`). Columns come from `trelloReadList` — watched,
  not fetched once, so renaming or adding a stage in Trello shows up
  without a reload — sorted by the connector's `position`, because on a
  pipeline board left-to-right *is* the meaning. Tap an asset →
  `assetMoveDialog` → `moveAssetTo`, local-first like every other write
  here (patch, render, write behind it, undo + `queueFailed` on failure).
  It has no date: `S.anchor` is ignored, `stepNav` returns early, and the
  whole `.dash-center` group hides (`.dash.pipe-mode`) because a board
  name is far too wide to sit centred beside the switcher on a
  phone — the board names itself inside the view instead. Its four empty
  states are deliberately distinct (unreachable / no stages / loading /
  stage with no cards); returning one skeleton for all of them was an
  infinite blank that couldn't be told apart from a hang.
  **`moveAssetTo` writes `{action:"move", cardId, listId}`** — verified
  against the connector, not inferred. The shape it shipped with,
  `{action:"update", cardId, listId}`, was a guess off `create` taking a
  `listId`, and it was simply wrong: `update` accepts only
  `name`/`desc`/`due` and rejects an unknown `listId`, so no move from
  this view could ever have committed. The local-first guard is what made
  that survivable — a rejected move snapped back into the unsaved-changes
  bar instead of vanishing quietly, which is how the bug stayed visible
  rather than silently losing work. Keep the guard.
- **The DayFlow→Daisey rename touched three identifiers that are live keys
  into data that already exists, and all three read both spellings on
  purpose.** A rename pass over this file is not cosmetic: `DF_MARK`
  (`[daisey]`, was `[dayflow]`) is written into every Google Calendar block's
  description and is the *entire* test for `mine` in `allEvents()` — the thing
  that tells a Daisey block from a real meeting. `STATS_CARD_NAME` and
  `STATS_LIST_RE` are how the state card is found, and `isStats` is also what
  keeps that card out of `candidates()`. The user's real data still carries the
  old names — blocks marked `[dayflow]`, a card called "📊 DayFlow Stats" in a
  list called "📊 DayFlow (widget state — do not edit)" — so matching only the
  new spelling would have: stranded every block on the calendar (still
  occupying the day, no longer clearable/swappable/done-able, so the next
  Re-plan lays the day *around* its own earlier blocks), reset settings to
  `DEFAULTS` and the streak and rollovers to zero, and put Daisey's own machine
  card into the scheduling pool as an unlabelled quick task, swap picker
  included. Reads therefore go through `isDfMark`, `STATS_NAME_RE` and a
  two-spelling `STATS_LIST_RE`; writes only ever emit the new names. **The test
  fixtures were all updated to `[daisey]` in the same pass, so the suite was
  green either way — nothing here was caught by a test, only by reading the
  real board.** Don't "tidy" the legacy arms away while real data still holds
  the old spelling; renaming the Trello list and card is the prerequisite, and
  the calendar blocks would still need to age out.
- **A title shrinks to fit next to its time/chip anchor rather than being
  forced onto its own line** (`fitRowTitle`, run over every `.now .row` and
  `.item.stack .row` at the end of `paintMain`). A prior fix for the same
  clash used `flex-basis:100%` to always push the title below the anchor —
  simpler, but it gave up the shared line even for titles that had room, and
  the user asked for the opposite priority: stay on one line whenever
  possible, shrink only enough to make that happen, and only fall back to
  wrapping (at that same shrunk size, not the full one) when no shrink
  makes it fit. `fitRowTitle` measures the real leftover width next to the
  anchor and the title's natural (unwrapped) width at full size, and where
  the natural width doesn't fit, scales the font down by that exact ratio —
  one measurement, no iterative loop, since the leftover width doesn't
  depend on the title's own font size. Floor is `max(68% of base, 10px)`;
  a title too long to fit even there just wraps at the floor size, which
  looks fine (checked against a 140-character synthetic title — four clean
  lines, no overlap) since it's an extreme case, not the common one this
  was written for.
- **`[hidden]` loses to an explicit `display`.** `.navbtn` sets
  `display:grid`, so setting `.hidden` from JS did nothing visible until
  `.navbtn[hidden]{display:none}` was added — the same trap
  `.dash-right[hidden]` already worked around. Assert with
  `offsetParent === null`, not `.hidden`, or the test passes on a control
  that's still on screen.
- **Only today can be built or rescheduled, and the app now notices when
  "today" changes underneath it** (`checkDayRollover`, on the 1-second
  clock tick). `S.anchor` used to be set once at load, and since
  `allEvents()` drops every card-linked block that doesn't start today,
  crossing midnight with the tab open emptied the entire schedule out of
  the model: the hub fell to "Nothing scheduled" and its own Re-plan
  button could only answer "Only today can be built right now." Only a
  reload recovered, and leaving the tab open overnight is the normal way
  this gets used. Now the anchor follows the clock (unless the user has
  deliberately navigated to another day, which is left alone), the
  calendar watch re-registers on the new range, and `startDay()` — the
  shared path boot uses too — builds the new day exactly once.
- **Quick tasks share one contiguous window** (`quickTotal`), split
  evenly between them — they do not scatter across the day. The group
  shrinks until it fits somewhere.
- **The quick-task window is one real Google Calendar event, not one per
  task — but Daisey's own Day view still shows one row per task.** (First
  built 2026-08-22/23 as a full merge including the UI; reworked 2026-08-23
  same day on direct follow-up: "In daisey I don't want the changes, only
  in google calendar... the google calendar needs to only read from those
  tasks, the only thing the user can change through there is the overall
  timing. In daisey done/remove/pending will make the task disappear from
  description, because it moves it to another time or gets rid of it.")
  This is the "brick" model — the term used throughout this codebase and
  its tests for a merged quick-task event. `planFor` emits exactly one
  `{kind:"quick-brick", cards:[...]}` entry for the whole window, and
  `createBrickBlock`/`localBrickBlock` write one Calendar event whose
  description carries one `• <name>` / `Original: <url>` pair per task
  (`brickDesc`). `shortLinkOf` (single match) is a thin wrapper over
  `shortLinksOf` (all matches, `matchAll`); `allEvents()` exposes both
  `e.cardShort` (first link, kept for every single-card call site) and
  `e.cardShorts`/`e.isBrick` (`cardShorts.length>1`). `cardsFor(ev)` is
  `cardFor`'s multi-card sibling. **Every other event kind — short session,
  long session, meeting, break — is untouched**: still exactly one event,
  one card, same as always. Only the quick-task window merges, and only on
  Google Calendar's side.
  **`agenda()` explodes a brick event back into N rows**, one per card —
  Daisey's Day view has never actually rendered a merged row; that was
  tried first and reverted same-session. Each exploded item carries both
  `card` (that one task — every existing single-card consumer, `hasDetail`/
  `detailPanel`/`cardLink`/due chips, reads it exactly like a normal row)
  and `cards` (the full sibling list, needed by `brickSurvivors`). A brick
  event with exactly one card never reaches the explode branch at all —
  `allEvents()` only sets `isBrick` for 2+ links — so a lone quick task was
  already a plain single-item row throughout. Done/Swap/Remove/Pending on
  an exploded row still edit the *shared* event rather than needing one of
  their own: `item.cards ? completeItemInBrick(item, item.card) :
  completeItem(item)` (same fork for Remove/`swapPicker`'s `outCard`
  param/`pendingItem`). `completeItemInBrick`/`removeFromBrick`/
  `pendingItem`'s brick branch all go through the shared
  `brickSurvivors`/`writeBrickAfterDrop` helpers: rewrite the event's
  description down to whoever's left (`updateBrickDesc`, a plain
  `update_event` with only `description` set — `moveBlock` already proved
  this connector call accepts a partial update for start/end, but a
  description-only partial update has not itself been observed against the
  real connector, only the test stub), or delete the whole event once none
  are left. Swap inside a brick (`swapToInBrick`) is the same
  edit-not-recreate shape. `swapPicker`'s pool filter has
  `(!item.isBrick || c.size==="quick")`, since a session/work-day card
  can't fit into a shared quick window.
  **Row identity can't be the event id any more** — two exploded siblings
  share one `item.ev.id`. `rowId` (`item.ev.id+":"+item.card.id` for a
  card row, plain `item.ev.id` for a card-less meeting/break) is what
  `S.openRow`/`S.expanded`/`wireStackDrag`'s `dataset.rowId` actually key
  off now; using the bare event id here would silently open/expand every
  sibling in a brick at once. `S.pending` guards likewise moved to
  `card.id` for a brick row (`completeItemInBrick`/`doRemoveFromBrick`/
  `pendingItem`) so two siblings stay independently actionable.
  `clearableBlocks` reads `cardsFor(e)` and requires *every* card in a
  brick to be `dueComplete` before excluding it from a rebuild — reading
  only the first card (`cardFor`) would have wrongly treated a brick with
  one done task and two still-open ones as fully finished and skipped it.
  `existingBlocks`'s `quick`/`total`/`foreign` fields still count one brick
  event as a single "quick" block, not by task count — harmless today since
  nothing reads those three fields (`have.long`/`have.short` are the only
  ones `planFor` actually consumes), but worth knowing if that changes.
- **Dragging a quick-task row in the Day-view list moves that one card's
  description text, not a whole event** (`pushReorder`/`relayRows`/
  `commitRelay`, reworked in the same 2026-08-23 pass, direct user request:
  "just treat the google calendar's description as a task brick... if the
  user move the task to another time in the day (within another block or
  not) move the description text with it"). `pushReorder` used to repack a
  range of whole Calendar events by time (each kept its own identity,
  only start/end changed) — that has no meaning once several rows can
  share one event. It now operates on **rows** (`reorderRows()`, the same
  exploded shape `agenda()` produces, each carrying a fixed `dur`:
  `CFG.quickTotal` for a quick row, its real duration otherwise) and calls
  `relayRows()` to diff the repacked positions against reality: consecutive
  quick rows landing back-to-back **auto-merge into one brick event**
  (same "adjacent quick tasks share a window" rule `planFor` already
  applies); a quick row with no quick neighbor becomes its own single-task
  event; a session/meeting row still just moves in place, unchanged. An old
  event that loses cards gets its description rewritten (or is deleted
  outright if empty) via the same `brickSurvivors`-shaped helpers the
  action buttons use; a genuinely new slot gets `createBlock`/
  `createBrickBlock`. This can create/edit/delete several events in one
  drag, so undo no longer fits `S.lastMove`'s plain `{id,start,end}` shape
  — `S.lastRelay` (`{writes, undo, settled}`) is a parallel, mutually-
  exclusive undo mechanism; `undoMove()`/Ctrl+Z check `S.lastRelay` before
  falling back to the original `S.lastMove` path. **Scoped to the Day-view
  list drag only** — Week view's separate pixel-based grid drag
  (`wireItemDrag`) still moves a whole event exactly as before; a brick
  dragged there moves as one unit, unsplit, on purpose.
  **Ctrl+Z on a relay push reverses the real Calendar writes, not just the
  screen** — direct user request when the gap was surfaced mid-build
  ("build full server-side undo"), since a plain local-only revert would
  leave a newly-merged event live on the server the moment a later refetch
  overwrote the illusion. Each write kind captures what undoing it for
  real needs: `delete` keeps `prevCards`/`prevStart`/`prevEnd` so `undoRelay`
  can recreate the event; `editDesc` keeps `prevCards` so it can restore
  the original description; `move` already had `prevRaw`. `undoRelay`
  fires the mirror writes in the same "destroy second" order commitRelay
  uses (recreate deleted → restore edits → revert moves → delete newly-
  created). A create write's own undo is lazy (`()=>dropLocalEvent(w.realId
  || w.standId)`) because at undo-time the local stand-in may already have
  been swapped for the real event — `S.lastRelay.settled` (the in-flight
  `commitRelay` promise) is what `undoMove` awaits first, so a Ctrl+Z
  pressed while writes are still landing waits for `w.realId` to exist
  before trying to delete it, rather than silently no-op'ing on a write
  that hasn't landed yet and orphaning it once it does.
  **Two real bugs surfaced building this, both worth knowing if the area
  changes again**: (1) `commitRelay`'s create branches used to never drop
  the local stand-in once the real event landed — both stayed in
  `S.events.payload.events` (the same array `list_events` itself reads),
  so a merged brick briefly rendered twice; fixed by `dropLocalEvent`
  right after `w.realId` is set, same pattern `applyPlan`'s own
  `settled.forEach(s => dropLocalEvent(s.id))` already uses. (2)
  `agenda()`'s brick-explode originally gave every sibling row the whole
  event's `start`/`end` — fine when the UI showed one merged row, silently
  wrong once it went back to one row per task (every sibling displayed
  the identical, overlapping time). Fixed by slicing each card its own
  `CFG.quickTotal`-wide window back-to-back from the event's own start,
  in card order — the same per-task sizing `planFor`/`relayRows` already
  use to build/repack a brick, now also used to *read* one back.
  **HISTORY — everything from here to the end of this bullet describes the
  2026-08-25 hour-gutter/true-to-scale design, which was REMOVED on
  2026-08-26.** There is no hour gutter, no `.grid-line`, no
  `SKIP_MIN_PX`/`SKIP_KEEP_PX` compression and no duration-driven card
  height in the file any more; the per-row rail came back and now carries
  each row's own start time plus its duration as text. See the
  "True-to-scale card heights are GONE" bullet near the top of this section
  for what replaced it and why. Kept because the measurements below are the
  reason the current design is what it is — the 32x-vs-2.3x span argument in
  particular was rediscovered the hard way.

  **The per-row rail was replaced by a REAL hour gutter** (2026-08-25, direct
  user request: "time should be shown just like in google calendar style —
  numbers on the left for each hour, bricks from its right"). Day view now
  renders `hourGutter`/`hourLines`/`nowLine` — the same functions `weekGrid`
  uses, extracted and shared, at the same `TL_PPM_DAY` (`TL_PPM * 0.62`)
  scale — so the two views are literally one clock.
  History: the rail used to be a 46px column on every `.time-row` carrying
  that row's own start time. With a real gutter beside it that became a
  *second* time column — two stacked time gutters ate 102px of a 390px phone
  before a card began — so `.time-row`'s first column is now a 10px strip
  holding only the duration bar, and `.rail-stop .t/.tm` are
  `display:none` (kept in the DOM, and in the stop's `title`, because a
  nested row is indented away from the gutter). `.rail-stop::after`, the 9px
  dashed stub reaching from label to card, is **gone** — real full-width
  `.grid-line`s do that job, and inside a `.nest` the stub made the indent
  read as a misalignment. `.nest` also lost its own dashed left border for
  the same reason: a second vertical dashed line 20px inside the gutter read
  as a duplicate of the grid, not as grouping. Indent alone (12px) groups it.

  **Cards are ANCHORED to their start minute, never SIZED by duration —
  this is the load-bearing decision and it is arithmetic, not taste.**
  The user raised exactly the right objection unprompted ("my fear is the
  bricks will not have the same size"). Measured: a collapsed `.item.stack`
  is **61px**, an open one 77px at 430+ but **106px at 390** and 113px at
  320; the hub is 144px. Durations span **32×** (`quickTotal:15` →
  `longMin:480`) while legible card heights span only ~2.3×. For a 15-min
  task to clear even 61px at true scale needs `ppm ≥ 4.07` → a **1954px**
  day (2686px on a 9→20 window, ~3600px for the open form on a phone), on a
  view that is 827px with zero scroll today. A min-height clamp doesn't
  rescue it either: the floor lands at 61px = 61 minutes, so everything from
  15min to 1h renders identically anyway — you'd buy multiple screens of
  scroll to distinguish only the two session sizes, which the duration chip
  already does for free. Don't revisit this without redoing the measurement.
  Duration survives where height is actually free: `.rail-bar`, a 4px bar in
  the strip, `(e2-s)*TL_PPM_DAY` tall, floored at 6px.

  **`anchorRows(sec)` is the whole mechanism**, run from `paintMain` after
  `fitRowTitle` (shrinking a title changes card height, which moves every row
  below it). It sets a per-row `margin-top` so each row's top lands at its
  true minute, measured against the rows container by real
  `getBoundingClientRect()` deltas — so `.nest`, `.hub-connector` and the
  eyebrow labels are accounted for by layout rather than by summing heights.
  Each iteration re-measures, so a row's "natural" position already includes
  every push above it; that's the running cursor, taken from real layout.
  **The invariant: a row may be pushed LATER than true scale, never earlier.**

  **The gutter is then placed against where the rows ACTUALLY landed, by
  interpolation — this is the half that makes it honest.** Anchoring alone
  cannot keep a card near its hour line: a 144px hub occupies ~15min of
  clock, four 15-min bricks need ~244px of card in ~59px of clock, so a
  crowded stretch inevitably pushes everything after it below true scale.
  Measured before this was added: the 14:00 card sat at 535px while the
  14:00 label sat at 298px — **eight rows apart**, the exact misreading this
  view exists to prevent. Now each hour is interpolated between the measured
  positions of the rows on either side of it (`at(min)`), so uncrowded
  stretches keep true ~59.5px/hour spacing and crowded ones stretch to
  match. An hour interpolating to a negative offset (squeezed out by a
  leading compression) is **removed**, not clamped — several clamped to 0
  would stack and each claim the same position.

  **Empty clock compresses past `SKIP_MIN_PX` (100px) down to
  `SKIP_KEEP_PX` (26px)**, marked with a `.hour-skip` "⋯ 3h" tag so the jump
  is stated rather than reading as a rendering fault. `prevEnd` starts at
  `winS`, not null, so the *leading* run compresses too — nothing scheduled
  before 11:30 on a 09:00 day is the common case, and leaving it uncompressed
  opened the view on two screens of empty grid.

  **The window is measured over rows that actually got anchored**, not over
  the whole day: an active permeable meeting renders as `meetingNowRow`, a
  banner with no `data-min` that never sits on the clock. Letting it widen
  the window anyway opened the day at its 06:00 start with nothing anchored
  near there — five hours of blank grid that the compression couldn't even
  collapse, since the run wasn't empty by the numbers, only by what rendered.

  **The hub renders INSIDE the timeline now** (user: "I want the user to
  experience the entire day... it needs to sit in schedule and be bigger and
  pop out, all while letting the user see what's behind and in front of him
  in schedule"). `paintMain` collects the banner/hub/nest into a `lead` node
  and hands it to `timeline(items, {all, lead})`; its prominence comes from
  `.item.hub` styling, not from sitting outside the grid. `.rows.stack` lost
  its `border-top`/`padding-top` — those separated the list from a hub that
  used to sit above it — and became `position:relative` to anchor the lines.

  **Two translucency bugs surfaced, both invisible until there was a grid
  behind the cards**: `.item.bk-break` used `rgba(47,143,224,.16)` and
  `.item.meeting` used `opacity:.82`, so the dashed rules showed straight
  through and appeared to cut across those cards. Both are opaque now
  (`#D6EAFA`; muted colours instead of element opacity). Note `brk.js`'s
  colour assertion had been reading the **un-composited** rgba string —
  `b-r` of 177 — while what actually reached the screen was
  `rgb(222,235,239)`, a `b-r` of **17**. The old check never measured the
  rendered card at all; it now asserts opacity plus a real azure lead.
  **That same bug survived one layer up in the rail until 2026-08-24**, and
  it's worth knowing why it hid for so long: `agenda()` was fixed to carve
  each sibling its own `item.s`/`item.e2`, but `timelineItem`'s `rail-stop`
  still printed `fmtRange(item.ev.start, item.ev.end)` — the *event's* span,
  which every sibling shares. So the model was right and the view was wrong:
  four tasks in one brick each rendered the identical "11:30–12:30", wrapped
  onto two lines apiece in the 44px rail, claiming every task ran the full
  hour. The user asked for this on looks ("a more elegant way to show the
  hours"), not as a bug report — the redundancy was the visible symptom of a
  correctness error underneath. Now a brick sibling shows its own start
  (`hhmm(atMin(item.ev.start, item.s))`) and the shared end is stated once,
  by sibling 0, as a small `↳12:30` line — so the column reads
  `11:30 ↳12:30 / 11:45 / 12:00 / 12:15`. `item.brickPos` (set in `agenda()`'s
  explode branch) is what marks position; `.rail-stop.brick-sub` steps later
  stops down in weight and a `::before` spine (anchored `top:-10px` to
  `bottom:calc(100% - 11px)`, so it closes onto the dot rather than floating
  above it) joins them into one run. Non-brick rows — sessions, meetings,
  breaks — still show their full range, unchanged. If you touch the rail,
  check a brick *and* a lone quick task: a brick with one card never reaches
  the explode branch at all (`allEvents()` only sets `isBrick` for 2+ links),
  so it takes the plain path and must keep its full range.
- **A long session takes the whole day**: if one fits (ranked by the
  same urgency order as everything else — refining that ranking by
  due-date distance or project scale is future work, not done), no
  quick tasks are scheduled alongside it. Short sessions aren't
  explicitly excluded, but an 8h block rarely leaves room for one anyway.
- Caps count blocks already on the calendar, including ones this widget
  did not create.
- **Meetings are never scheduled over**, except *permeable* ones:
  all-day events, anything Google marks Free, and titles listed in
  `CFG.openEvents` (ships with `חמל`, toggled from the ⊙/⊘ control on a
  meeting row) — and even there, only quick tasks may land inside.
  Short and long sessions treat every meeting as blocking, permeable or
  not (`busyFor(..., forSession)`); the swap picker hides session-sized
  cards for a slot that's inside one. Dragging or resizing a block in
  Week view enforces the same rule (`rescheduleTo`) — it used to have no
  collision check at all, which is how a session once ended up sitting
  inside `חמל`; now it's rejected with a toast instead of committing.
- The day off schedules nothing. Every other day is ordinary.
- **Only today can be built or rescheduled** (`isLockedDay`/`isLockedItem`
  — a day is locked unless it's today, past or future alike). Rebuild
  hides itself on any other day, Swap disables with a toast, the
  Day-view drag-to-swap doesn't wire up at all, and Week-view drag/resize
  refuses to start on a non-today column (`rescheduleTo` still checks the
  destination too, since a Week-view drag can cross columns mid-gesture
  into a locked day). This used to only cover the past; letting a future
  day be built independently meant the same Trello card could end up
  scheduled onto two different days at once, since each day's candidate
  pool is computed the same way regardless of what another day already
  claimed. Marking existing work done, Pending, or Remove still work on
  any day — only *creating or moving* a block is restricted.
  This bullet predates a later change that widened the window to today
  *and* tomorrow (`isSchedulable`/`isLockedDay` — `daysBetween(now,d)` is
  0 or 1); the toasts already say "today and tomorrow", this note hasn't
  caught up.
- **A block built for tomorrow used to vanish from the app the instant it
  was created.** `allEvents()` — the one place every read of "what's on
  the calendar" goes through — filtered out any card-linked event whose
  start wasn't literally today's real date, a rule written back when only
  today was buildable and never widened when `isSchedulable` was. The
  write to Google Calendar still succeeded, so the block was real and
  duplicated on every later rebuild (each run saw an empty day, since
  `existingBlocks`/`clearableBlocks`/`planFor`'s `already` set all read
  through `allEvents()` too) — while the UI just showed nothing for
  tomorrow, which read as "can't schedule anything for tomorrow." Fixed
  by matching the filter to `isSchedulable(e.start)` instead of
  same-day-as-now.
- **Writes retry, and what still fails is kept rather than announced
  once.** `callTool` wraps every call in three attempts with 400ms/1.2s
  backoff, but only for genuinely transient failures — `server_unavailable`,
  `rate_limited`, and a missing code (the network dropping mid-call).
  Auth and lifecycle codes need the user, not another attempt, and
  `tool_error` means the request itself was rejected and will be again.
  `errCopy` had been promising "Retrying shortly." / "Pausing briefly."
  for years with nothing behind it. Anything that still fails goes to
  `queueFailed` and shows as a persistent "N changes didn't save" bar
  with Retry/discard — a toast lasts 3.4 seconds and a lost write lasts
  forever, which is how a drag made on a dead connection used to look
  saved and quietly not be.
- **Settings sizes itself off the real viewport, not a fixed number.**
  `.dialog.sheet`'s max-height used to be `min(600px,90vh)` — a hardcoded
  ceiling that forced an internal scroll on a lot of screens even though
  the device had plenty of room, and the scrim's flat 20px padding could
  let the sheet touch or run under a notch/home-indicator on top of that.
  It now sizes off `100dvh` minus safe-area insets, and every field sits
  in a two-column CSS grid (`.set-row`) instead of the old flex-wrap flow,
  so values line up in one column regardless of label length. The board
  colour pickers moved from one row each to three swatches side by side
  in a single row (`.set-row.tall`, no label column of its own — the
  "Colour" section header above it already says what it is; giving it
  one back was what made three swatches wrap to two lines on a narrow
  phone). Tested down to a 667px-tall viewport with zero internal scroll.
- **Done, Swap, Pending and Remove are local-first too**, on the same
  pattern drag/resize/reorder already used. They used to hold the whole
  UI still behind `S.pending` for two or three round trips to Trello and
  Google Calendar — the exact wait that made dragging feel slow before
  `commitMove` existed. Now the model is patched first (`dropLocalEvent`
  / `addLocalEvent` / `patchLocalCard`, each returning its own undo
  closure), `render()` runs, and the writes go out behind it; a failure
  runs the undo, toasts, and hands the lost work to `queueFailed`.
  Swap puts a `localBlock` stand-in in the slot until Google mints a real
  id — it carries the same `DF_MARK` and `colorId` the real block will,
  so `allEvents()` reads its size and card link back correctly, and its
  id sits in `S.pending` so nothing can drag or act on it in the gap.
- **The state card is created if it's missing** (`statsListId` /
  `createStatsCard`). Nothing ever created it before, so if it was absent
  or archived by hand, `saveStats` hit a null id and returned — every
  settings change, streak bump and rollover dropped on the floor with no
  toast. It only creates when Trello actually answered and simply had no
  such card; an unloaded board is "don't know yet", not "it isn't there".
  There is deliberately no "first list" fallback for where to put it —
  dropping a machine-managed card into a real list would put it straight
  into the scheduling pool.
- **Destroy second, create first.** Three sequences used to leave the day
  strictly worse than not acting at all when a step failed mid-way, and
  all three are now ordered so the reversible half goes first: `swapTo`
  creates the replacement block before deleting the old one (a failed
  create left an empty slot with *both* cards unscheduled); `removeItem`
  clears the block before archiving the card (a failed delete left an
  archived card still holding a live block — invisible in Trello and not
  fixable from inside the widget); and `applyPlan`, which has to clear
  before it re-lays, puts the cleared blocks back if an auth failure
  means nothing at all got placed.
- **A swap gives the incoming card its own real size — a session or work
  day (`CFG.shortMin`/`longMin`) doesn't inherit whatever duration the
  outgoing card's slot happened to be.** `swapTo` used to keep the old
  slot's `start`/`end` unchanged no matter what landed in it — swap a
  20-minute quick task for an 8-hour work day and the block stayed 20
  minutes. It now compares the incoming card's own size against the slot's
  current length and, if they differ, runs a fresh `findSlots` search
  anchored at the old start time (falling back to the day start, and
  toasting "Doesn't fit here" if genuinely nothing fits). Quick cards are
  the one exception, on purpose: a quick task has no size of its own — one
  quick task's slot length depends on how many others are sharing
  `quickTotal` when the day was built — so a quick card swapped into *any*
  slot, session/work-day-sized or not, keeps that slot's length untouched.
- **`saveStats` is SINGLE-FLIGHT, and this is the most consequential
  correctness fix in the file** (2026-08-26). The entire stats document —
  streak, history, categories, rollovers, plans, project deadlines, settings
  — is one JSON blob in one Trello card description, and `saveStats` is
  called from **20 sites**, nearly all fire-and-forget (`saveStats(st)` with
  no `await`) off a Done / Swap / Pending / Remove / settings save.
  It used to serialize the whole document at CALL time and send it
  immediately. Two actions close together therefore started two overlapping
  writes of the entire document, each carrying a body captured before the
  other landed, and **whichever response came back last won outright** — the
  loser's change gone, with nothing on screen to say so. That is the
  mechanism behind "my streak reset" / "my setting reverted" / "that
  completion didn't stick": bugs that read as random because they are
  timing-dependent and silent.
  Two changes, no call sites touched: the body is now serialized **inside**
  the write from `S.stats` at the moment the request goes out (so a queued
  retry replays current state, never a stale snapshot), and at most one write
  is in flight — a call arriving during one marks the state dirty and the
  in-flight chain re-writes once when it finishes, coalescing any number of
  overlapping updates into one final consistent write. `S.stats` is still
  assigned synchronously, so local reads and the UI stay instant.
  `tools/test/stats.js` is the guard, and it **discriminates**: verified to
  fail against the pre-fix code (three overlapping saves → 3 concurrent
  in-flight writes) and pass against the fix (→ 2 writes, the last carrying
  the newest value). Don't "simplify" the queue away.
- **Watch results are applied newest-first** (`onWatch`, `WATCH_AT`,
  2026-08-26). A watch can deliver responses out of order — a slow poll
  landing after a faster later one — and `assign` used to take whatever
  arrived last unconditionally, quietly reverting a board or the calendar to
  an older snapshot that nothing in the app could distinguish from real data.
  Now each key remembers the newest `cache.storedAt` it has applied and drops
  anything older. Only ordered when the connector actually stamped the
  payload; without a stamp there's nothing to compare and last-write-wins is
  still the best available answer. A dropped poll still calls `render()` —
  `S.errs[key]` was cleared just above, and skipping the paint would leave a
  dead error banner on screen.
- **`logErr(where, e)` exists because this file had exactly ONE
  `console.error` in ~5700 lines of code** (2026-08-26). A scheduling run
  that half-failed left nothing behind to debug with — 11 `catch(_){}` sites
  swallowed errors silently, three of them (`applyPlan`'s break creation and
  both recovery branches) inside the highest-consequence write sequence in
  the app. `logErr` keeps the control flow — it returns undefined, callers
  continue exactly as before — and costs one line at the catch. The
  genuinely-unactionable swallows are deliberately left silent:
  `localStorage` throwing `SecurityError` on a sandboxed origin,
  `setPointerCapture`, `calUnsub`, the audio chime.
  **Test suites must not treat a `[daisey] …` line as a page error.** All 30
  console-error collectors in the suite filter on `/^\[daisey\]/` — without
  that, `setup.js` failed on a handled, queued-for-retry "Trello hasn't
  loaded yet" that the wizard recovers from correctly.
- **A watch error no longer retracts the data behind it.** `onWatch` used
  to blank the cached payload on any auth/lifecycle code, so a reauth
  blip emptied the whole page. Last-good data plus the banner beats an
  empty screen: what's on screen is still what was true a few minutes
  ago, and the banner says why it isn't newer.
- **Boot has two gates, not one.** The calendar alone is enough to draw a
  truthful day, so the skeleton clears the moment it lands; settings, the
  rollover sweep and the auto-plan wait for Trello as well, and run the
  moment it arrives. This used to be a single gate on all four sources
  with a 20-second timeout that then skipped those three steps entirely —
  so one slow board bought a 20-second blank screen followed by a day
  with no board colours and default settings.
- **Blocked/pending cards sit out of scheduling entirely**, not just
  ranked low (`candidates()` filters on `card.blocked`). `blocked` is
  text-detected (`BLOCK_RE`) off the card's name, description, or label
  names — "waiting", "מחכה", "pending", etc. The hub's **Pending**
  button opens `pendingDialog` — a popup to edit the description (and
  tick/rename checklist items) *before* committing, rather than parking
  the card blind — and only on confirm does `pendingItem` prepend a
  `⏳ Pending —` marker to the (possibly just-edited) description
  (`writeCardDesc`) and clear today's block; it never archives or marks
  the card done. It comes back into rotation once that marker (or
  whatever else matched `BLOCK_RE`) is edited away — the description
  and checklist-item pencils (`saveCardDesc`/`saveItemText`) are how —
  or on its own, if a "check back on" date was set in the dialog: the
  marker becomes `⏳ Pending until <date> —`, and once that date passes
  `normCard`'s `blocked` (via `PENDING_RE`) stops counting *that* marker
  as blocking — re-tested with the marker stripped, so any other
  blocking text the card independently contains still holds it back.
- **"Don't assign an activity before its Trello start date" is live**,
  as of `netlify/functions/trello-webhook.js` (2026-08-18, untracked —
  not yet committed). History first: the original code guessed `n.start`
  would mirror `n.due` off Trello's own API shape; it never did — always
  `undefined`, so `candidates()`'s eligibility gate was permanently dead.
  Two Daisey-only fixes (a `▶` button/`setStartDateDialog` writing the
  marker by hand, then reusing Pending's dated marker) were both rejected
  on the same feedback: the user sets the date once, in Trello, and
  expects Daisey to just know — not press anything inside the widget.
  Investigation then showed the *connector* itself can't round-trip
  Trello's native Start Date field at all (`trelloReadCard` never returns
  a `start` key; `trelloWriteCard`'s schema has no `start` param) — real
  blocker, not a Daisey bug. The user chose to wait on the connector at
  the time.
  **That's since been worked around, not waited out**: `trello-webhook.js`
  is a Netlify function, registered as a Trello webhook, that fires on
  card update, reads the card's real `start` field via a direct Trello
  REST call (bypassing the MCP connector entirely — no manifest, no
  capability limits), and writes it into the description as a marker.
  `daisey.html`'s read side was never actually torn out — `START_RE`,
  `normCard`'s `c.start` parse, and the `candidates()` gate
  (`daisey.html:2033`) all still exist and now have a real, live source
  feeding them. Nothing in Daisey's own UI writes the marker directly; the
  source of truth is Trello's native field, synced one-way by the webhook.
  **The marker is a hidden HTML comment, not visible text** (2026-08-18,
  second pass, direct user report: "Trello automatically adds the start
  date to the description, that's it" — the original `▶ Starts YYYY-MM-DD
  — ` prefix showed up as real clutter in the card's actual Trello
  description, duplicating Trello's own native Start Date badge). Now
  `<!-- daisey-start:YYYY-MM-DD -->`, appended at the *end* of the
  description instead of prepended — Trello's renderer drops HTML
  comments the same way GitHub's does, matching the `daisey-audio-sync`
  marker already used elsewhere in this codebase. Moving it to a suffix
  also simplified `normCard`: Start no longer has to be peeled off before
  matching Pending's `^`-anchored regex, since it's not competing for the
  front of the string any more.
  This touches more than the regex: `withoutStartMarker`/
  `extractStartMarker` (`daisey.html`, near `START_RE`) are what keep the
  hidden marker out of what a user sees or edits *inside Daisey itself* —
  `detailPanel`'s description display/textarea and `pendingDialog`'s
  textarea both used to show `card.desc` raw, marker included, so the
  same clutter existed one layer in even before this fix, not just on the
  real Trello card. `saveCardDesc` and `pendingItem` both re-append the
  marker (read fresh from `card.desc`, never from what the user typed —
  they never saw it to edit) so a description edit made through Daisey
  can't silently drop the start date; the webhook would eventually
  restore it on its own next sync pass anyway, but re-appending
  deterministically avoids the gap where it'd briefly read as gone.
  **Not yet exercised against live Trello** — no confirmation yet that
  the webhook is actually registered and firing on the real board.
- A run **clears and re-lays** the day's card-linked blocks. It never
  touches a real meeting or finished work — but, since 2026-08-18 (user
  request), it *does* now touch the block you're currently in the middle
  of. "Rebuild" means rebuild the whole day; a user who taps it mid-session
  wants that session re-ranked against everything else, not silently
  pinned. `clearableBlocks()` used to exempt any today block spanning
  `now` (unless a meeting had since been laid over it — `collidesWithMeeting`,
  the narrower fix that predated this one). Both the exemption and that
  helper are gone outright; every card-linked block for the day is
  clearable alike. `planFor`'s own `nowMin` gate is what still stops a
  replacement from landing in the past — a cleared in-progress card just
  re-enters the candidate pool and, most of the time, lands right back
  where it was, since nothing else outranks it. It only actually moves
  when something else now does.
- Hebrew card text is rendered RTL per field via `dir="auto"`; the app
  chrome never flips.
- **Touch dragging needs `preventDefault()` on a non-passive `touchmove`, and
  nothing else works** (2026-08-24, user report: "when touching the screen for
  a while to grab a brick to move, it just marks the text, doesn't catch
  anything"). Day-list drag by touch was **completely broken**, on every touch
  device, for as long as `touch-action:pan-y` had been on `.item.stack`.
  Cause: pan-y tells the browser it owns vertical panning, so the instant the
  finger moved down it claimed the gesture and fired **`pointercancel`**,
  killing the drag one frame after `wireStackDrag` armed it.
  `setPointerCapture` does **not** protect against this — the scroll claim
  outranks it. Trace: `pointerdown | pointermove | pointercancel`.
  **Two fixes were tried first and both failed**, both plausible enough to be
  worth recording so nobody burns the time again:
  1. `user-select:none` — blamed the native long-press text-selection callout.
     A real nuisance and worth keeping (it's still there, with
     `.item.stack .details` re-enabling `user-select:text` so a card's notes
     stay copyable), but it was not this bug, and the user correctly reported
     it still broken.
  2. Flipping `wrap.style.touchAction = "none"` when the hold arms. The style
     genuinely applies — computed `touch-action` reads `none` after the hold —
     but **Chrome latches touch-action at `touchstart`** and ignores changes
     for the rest of that gesture, so `pointercancel` still fired. Mid-gesture
     touch-action is a dead end.
  What works: a `{passive:false}` `touchmove` listener registered once per
  card that `preventDefault()`s only while `armed` is true. It must be
  registered up front, not lazily on arm — Chrome defaults touchmove to
  passive on mobile, where `preventDefault()` is silently ignored, so the
  decisive first move would already be through. `armed` clears in `cleanup()`
  and via `disarm()` on the pre-arm cancel paths, or the list stops scrolling
  by touch anywhere that card sits.

  **`.toasts` was silently swallowing touches, and the symptom looks nothing
  like the cause** (2026-08-25). It's a `position:fixed` full-width strip at
  `z-index:80` across the bottom of the screen and it had no
  `pointer-events:none` — so any card under that strip stopped responding to
  touch entirely, whether or not a toast was drawn. It went unnoticed because
  nothing used to sit there; the hour-grid work anchored a card under the
  strip and exposed it. Fixed as `pointer-events:none` on the container plus
  `auto` on `.toasts > *`, so a real toast stays dismissable. **If a card
  ever stops taking taps in one region of the screen, look for a fixed
  overlay before touching drag code** — the drag machinery was entirely
  innocent, and a full debugging pass went into it first.
  Two testing lessons from that same trace, both of which produced confident
  wrong answers: (1) a `git stash push` inside an `&&` chain silently never
  created a stash, so a "baseline" run actually re-ran the *modified* file
  and appeared to prove the bug was pre-existing — it wasn't. Verify a
  baseline with `git show HEAD:path` and confirm the comparison file really
  is the old one. (2) `rail.js` and `push.js` both broke on **stale
  selectors**, not real regressions, when the hub moved inside
  `.rows.stack`: `push.js` indexed `.item.stack` by `nth(1)` (which silently
  became Task B instead of Task C) and `rules.js` treated "inside
  `.rows.stack`" as meaning "a flat sibling". Both now select by identity.
  A layout change that moves a node between containers will do this to any
  index- or ancestor-based selector in the suite.

  **`rail.js` tests this with CDP-dispatched touch events under `hasTouch`,
  and that is the only reason it's covered** — the Playwright *mouse* path
  passed happily against the fully-broken build. It asserts both halves:
  hold-then-move drags with **zero** pointercancels, and a prompt swipe still
  scrolls `.page` (html/body are `overflow:hidden`, so `window.scrollY` is
  always 0 and useless to assert on) without dragging. Verified to fail when
  the fix is removed.
  Note the Day-list drag class is **`stack-dragging`** (plus
  `time-row-dragging` on the row); `dragging` belongs to Week view's separate
  `wireItemDrag`. Asserting the wrong one gives a false failure — it did once
  while writing that test.
- **Every card in the Day-view list, hub included, is drag-to-reorder**
  (`wireStackDrag`/`pushReorder`). Dropping one card among others **pushes**
  the whole run of cards between its old and new position over by one
  slot — the vacated slot closes, a new one opens where it lands, each
  card keeping its own duration — rather than only trading times with
  whatever's directly under the pointer. That two-card trade was the
  original design; it stopped reading as "moving this card here" once
  there was more than one card between the drag's start and end, so it
  became a real reorder. The affected run's outer boundary (the earliest
  start among the slots in play) doesn't move, only what's sitting in
  each slot inside it does — `pushReorder` repacks that run back-to-back
  from that anchor and rejects the whole move (toast, nothing committed)
  if the repack collides with a meeting/other block or spills outside the
  day window. Same collision rule as everywhere else. Meetings are never
  a party to this, neither as the dragged card nor a drop target — their
  time is a real commitment, so a drag just steps over them in the list.
  Position:static, not the grid's pixel/time math, so hit-testing during
  the drag is done against every row's rect snapshotted at pickup, not a
  live `elementFromPoint` (the hub and the list aren't literal DOM
  siblings, and the rows being pushed move out from under the pointer as
  you drag, which a live hit-test would immediately lose the target to).
  `S.lastMove` holds one entry per card the push actually moved, so
  Ctrl+Z / the undo popup restores everyone together. Because the hub is
  just whichever task's slot is soonest, dragging a card into the front
  slot is *how* you make it the hub — no separate "which one is current"
  state to keep in sync.
- **Drag/resize/reorder writes happen in the background, not on the
  critical path of the drag.** `applyLocalMove` patches the moved
  block(s) straight into `S.events.payload` (what `allEvents()` actually
  reads) and `render()`s immediately; `commitMove` then fires the real
  Google Calendar write and only touches the UI again if it fails
  (reverts the patch, toasts) — nothing awaits it. This used to `await
  moveBlock(...)` before the UI moved on at all, which is what made every
  drag, swap, and Week-view move feel slow: the round trip to Google
  Calendar/Trello, not the interaction itself, was the wait. A per-id
  version counter (`S.evVer`) guards the revert-on-failure path: if the
  same block gets moved again before an earlier write lands, that
  earlier write's eventual failure must not roll back the newer move
  that's already showing — only a write that's still the latest for its
  id is allowed to revert anything.
- **Every card title carries a compact ↗ (`cardLink`)** that opens the
  real Trello card in a new tab — hub, day list, and week view all go
  through it, so anywhere a title renders gets one for free.
- **The `✓ done/total` pill is clickable** (`doneDialog`) and lists what's
  actually behind the count — done tasks only. Pending/removed cards
  never appear in it or in the count itself: their calendar block is
  deleted outright, so `splitAgenda()`'s `done`/`open` split (built from
  today's actual blocks, not the candidate pool) never sees them.
- **The hub card and a timeline row share the same inner markup** —
  `.row`/`.row-meta`/`.acts-inline`, same as `timelineItem`'s stack mode —
  on request, so "the one thing right now" reads as the same kind of
  object as everything below it. What's still unique to the hub: the
  white surface (`.now` falls back to `--surface`, no `--glass` defined
  any more) and the `.hub-top` status line (Up next / On it / Still open /
  First up). No remaining-time meter and no age/overdue/blocked badges on
  the hub any more — dropped in the same pass. Every action button reads
  **Done**, not a checkmark — `timelineItem`'s `ok` button included.
- **Done/Swap/Pending/Remove are filled with colour at rest**, not just on
  hover (`.mini.ok`/`.swap`/`.pend`/`.del`) — green/gold/amber/red, so the
  row reads at a glance without re-parsing each label. The duration chip
  in `row-meta` now always has a board-coloured chip next to it
  (`.chip.bk` — same `--bc`/`--bc-soft` as everywhere else, just without
  `.chip.board`'s wobble, to sit still next to "20 min").
- **The duration/board chips and Done/Swap/Pending/Remove share one line**
  (`.row-meta` wraps a `.meta-chips` span plus `.acts-inline`, laid out
  `justify-content:space-between`) — chips left, actions right — instead
  of stacking as two separate lines under the title. `.acts-inline` used
  to force itself onto its own full-width line inside `.row` (a leftover
  `flex:1 1 100%`), pushing the chips onto a third line below it with
  nothing lining up. On a narrow phone or when the eyebrow status text
  ("Starting in…") is long, the two still wrap onto separate lines same as
  before — there's a real width limit on how much a text-labelled 4-button
  row plus two chips can share, not a bug, just not enough phone.
- **The "off the clock" card fills the gap between the end of the working day
  and a real evening event** (2026-08-24, `offHoursGap`/`offHoursCard`, user
  request). Before it, a day that ended at `CFG.dayEnd` with a calendar event
  at 20:00 rendered as a silent void — a card, then nothing, then a card three
  hours later, with no explanation of the space.
  **It is not a Break and must never become one.** A Break is a real Google
  Calendar event Daisey *creates*, inside the work window, as a pause between
  two stretches of work. This is the opposite: it exists precisely because the
  work window is over, so nothing will ever be scheduled into it.
  `breakGaps()` cannot express it either — it clamps everything to `winE`, so
  it is blind by construction to anything past the end of the day.
  **Nothing is written to Google Calendar for it.** It's derived at render
  time from what's already on screen. Free time isn't an appointment, and
  making it an event would clutter the real calendar and let it be dragged,
  completed and swapped like work. For the same reason the card is *not* an
  `.item.stack`: no spine, no actions, never seen by `wireStackDrag`. It does
  sit in a `.time-row` so its start still lines up in the shared rail.
  It only appears for a genuine gap: work actually happened, the next thing is
  a **foreign** event (a Daisey block would mean work is still scheduled),
  all-day banners don't count (not a commitment at a time), and the space is
  at least `OFFHOURS_MIN` (30m) — below that it's a turnaround, not an
  evening. The anchor is `max(dayEnd, lastWorkEnd)` so a session overrunning
  `dayEnd` can't produce a gap starting before its own card ends.
  **`timeline()` takes `opts.all`** — the gap is computed against the whole
  day, not the rows being rendered. `paintMain` passes `laterItems`, which
  excludes the hub; on a day whose only work IS the hub (one 8h session) the
  leftover list holds nothing but the evening event and the gap would never be
  found. That was a real bug caught mid-build, not a hypothetical.
  Design: the one card in the app with a gradient (indigo→violet `--dusk-*`),
  asked for as "similar to Break but much more juicy". Everything else is a
  neutral surface plus a coloured spine on purpose — those cards are work and
  have to stay quiet and comparable. This one means "you're done", so it's
  allowed to be the reward, and it competes with nothing.
  `offhours.js` covers the seven cases that separate a real evening gap from
  the things that merely look like one.
- **The dash wraps to two rows below 520px, and the date gets its own line**
  (2026-08-24, user report: "the 2nd line of the app is crowded, rebuild and
  the arrows are colliding, and I can't see the current day I'm working on").
  `.dash` holds three groups — `#viewSwitch`, `.dash-center` (arrows + date),
  `.dash-right` (progress pill + rebuild) — and they simply do not fit in a
  phone row, especially once the switcher grew a third tab (Projects).
  `.dash-center` is `position:absolute` centred on the **viewport**, so it has
  no idea how wide its siblings are: measured at 390px it overlapped the pill
  by **197px**, and the date was ellipsized to nothing.
  **Two earlier attempts made this worse in a way the tests approved of.**
  Both kept all three groups on one row and let the date compress (first
  `position:static`, then `flex:1 1 auto; min-width:0`). That stopped the row
  *overflowing*, so `chrome.js`'s `bodyOverflow`/`dashOverflow` checks went
  quiet — while the date silently clipped and the groups still overlapped.
  Compressing the one element that says which day you're looking at is the
  wrong thing to sacrifice; the row needed to be *taller*, not tighter.
  Now `.dash` is `flex-wrap:wrap` under 520px with `order:1/2/3`, so switcher
  and pill share line one and `.dash-center` takes a full-width line two
  (`flex:1 0 100%`) where "Monday 17 Aug" renders whole and centred with the
  arrows pinned to the edges. Under 340px the tab padding tightens as well.
  Desktop (>520px) is unchanged: one row, absolutely-centred date.
  **`chrome.js` gained the assertions that would have caught it**: real 2-D
  box-overlap between all three pairs of dash groups (the old check only
  compared switcher-vs-pill and never involved the date group at all), and a
  `dateLabel.scrollWidth > clientWidth` clip check. It also runs at 320 and
  430 now, not just 390/760. Both new assertions were verified to fail against
  the previous layout — the clip check fires on exactly the "no overflow but
  you can't read the date" state that passed twice before.
- **The real clock lives in its own `.topbar`, above the header and
  anchored left** — the one thing on screen that's true regardless of
  which day `S.anchor` is looking at, so it doesn't share a row with
  navigation that can point elsewhere. Settings (⚙) sits opposite it on
  the right, since it no longer fits alongside prev/next. The header
  below it (`.head`) is just the day nav now: prev/next (`.navbtn`) pin to
  the row's two edges, the date label centers itself between them. The
  dot that used to sit between the arrows (`#todayBtn`) is gone — tapping
  the centered date does that job now (`goDay(0)`), which also retired the
  header's "jump to any date" popup (`datePicker()`) that used to live on
  that same tap. Month view (`monthGrid()`), the later replacement for
  jumping to a distant date via tap-any-cell, has since been removed
  outright (2026-08-17) — Day/Week/Assets only now, and prev/next plus
  today-tap are the only ways to move `S.anchor`. Deliberate: there is no
  replacement for jumping far away, just repeated prev/next.
- **There is no dark mode, on purpose.** Daisey commits to one bright
  palette on bare `:root` and overrides the reader's theme instead of
  following it — `color-scheme:light !important` beats the inline
  `style.colorScheme` the shell sets, and there is no
  `prefers-color-scheme` or `[data-theme="dark"]` block. A dark palette
  existed and was removed: a dark-mode reader saw a near-black page and
  read it as the artifact being stale, which cost a long debugging
  detour. `chrome.js` asserts brightness under both the media-query and
  the shell's `data-theme="dark"` path — the latter is the one that
  actually ships. Don't add a dark block back without asking.
- **Cards are one neutral-ish surface plus one coloured spine, not a
  tinted fill** (2026-08-17 redesign, "make the cards more expensive and
  elegant"). `.now`/`.item`/`.item.stack` used to set
  `background:var(--bc-soft,...)` — the whole card tinted its board's
  colour — *and* a matching saturated border *and* (on `.now` only) the
  left stripe below, three signals stacked for one fact. That read as a
  sticker sheet, not a product. All three now share a hairline edge
  (`--line-soft`, a near-invisible neutral — depth comes from
  `--shadow`'s two-layer contact+ambient blur, not a coloured outline)
  and keep only the left spine (`::before`, 4px, `var(--bc,var(--b-none))`)
  as the board signal. `.item.stack` had to change `position:static` →
  `relative` for its own `::before` to have something to anchor to —
  verified against `wireStackDrag`'s drag hit-testing
  (`getBoundingClientRect()` snapshots), which `relative` with no offset
  doesn't change, so the reason `static` was chosen in the first place
  still holds. `backdrop-filter` came off `.item` too — it blurred
  whatever sat behind a translucent tinted card; on an opaque surface
  there's nothing left for it to do. The fill itself went through two
  passes: first plain `var(--surface)` (pure white), then — on direct
  feedback that white "hurt the eyes" next to the warm `--bg` — a new
  `--card:#FFFDF2` token, `--surface` warmed and dimmed by a hair so a
  card still visibly lifts off the page without the cold flash. Scoped to
  cards only; `--surface` itself (dialogs, buttons, `.mini` rest state)
  was untouched both times, since neither request was about those.
- **The board hues went candy-bright → muted jewel tones → bright again**
  (same 2026-08-17 session, second pass on direct feedback: "brighter and
  funny", muted read as flat/boring). `--b-projects` (violet), `--b-sidurim`
  (blue), `--b-sedco` (orange), `--b-mpaudio` (pink) started saturated
  enough to double as a children's-app palette; the intermediate muted set
  (plum/teal/rust/wine) fixed the "sticker sheet" problem but overcorrected
  into dull. The current set is vivid again — violet-purple / cyan-teal /
  red-orange / magenta-pink — while keeping the one real fix from the
  muted pass: each hue is a distinct *family*, not just a distinct
  brightness, so `--deep` (status chip, blue-indigo `#5B67FF`) and
  `--b-projects` (board, purple `#A855F7`) no longer sit one step apart on
  the same violet the way the original bright set did, and `--age` (status,
  yellow-gold `#F5A623`) is pulled clear of `--b-sedco` (board, red-orange
  `#FF7043`) for the same reason — a card can be both "on the sedco board"
  and "aging" at once, and those two badges need to read as different
  facts at a glance. `chrome.js`'s brightness guard passes under all three
  palettes tried so far (bright, muted, bright-again) — it's a floor, not
  a target, so it doesn't push back on any of them.
- **Titan One is gone; `--font-display` now points at Nunito's heaviest
  weight instead of a second typeface** (same pass). Titan One is a
  single-weight (400) novelty display face — thick, rounded, comic-ish —
  embedded as its own ~14.6KB base64 `@font-face` and used for every
  clock digit, dialog heading, empty-state heading and the lock-flow
  text. It was the single biggest reason the app read as a kids'-game
  rather than a considered product, regardless of what the cards
  themselves looked like. Nunito already ships weights 200–1000 in the
  one `@font-face` still embedded, so display text now borrows the same
  family at `font-weight:800–900` with tight negative tracking instead —
  one confident typeface used with restraint, the classic premium-app
  move, rather than a decorative one layered on top. Every site that read
  `font-family:var(--font-display)` also had `font-weight:400` hard-coded
  (Titan One's only weight) — all of those were bumped alongside the
  swap, or the same text would have rendered in *regular* Nunito and
  looked thinner than before instead of more refined. The Titan One
  `@font-face` itself was deleted outright (line 5) rather than left
  dead, since nothing references the family name any more.
- **The idle "wobble" animation is gone.** `.chip.board` (dead CSS — no
  JS creates that class any more, `.chip.bk` replaced it) and
  `.chip.crit` (the live "!" overdue badge) both rotated back and forth
  forever via `@keyframes wob`. A badge that visibly jiggles at rest was
  the other big "toy" signal alongside Titan One; removed along with the
  dead `.chip.board` rule and the `--wob` custom properties, since
  nothing else used the keyframe.
- **Chores are connected to the schedule but never occupy a calendar slot**
  (2026-08-17). The lock screen (`lockDialog`, the 🔒 topbar button) used to
  be a pure prototype — hardcoded 4 chores, single-select despite the
  plural "CHORES?" title, no state at all, "No app-state wiring yet" in its
  own comment. It's now real: which weekdays each chore is due
  (`CFG.choreDays`, a user setting, same Trello-state-card pattern as every
  other setting) and when the reminder fires (`CFG.choresTime`, default
  20:00) are both settings-panel controls. Whether a chore's actually been
  done lives in `localStorage` (`daisey.chores.v1`), not the Trello card —
  a per-device daily nag doesn't need cross-session sync the way schedule
  settings do. `choresSweep()` mirrors `rolloverSweep`'s model for cards: a
  chore due yesterday and still unconfirmed stays flagged **overdue**, and
  its day count keeps climbing, until it's marked done — regardless of
  whether today's own schedule has it due again. `tick()` fires the lock
  screen automatically once a day the moment the clock crosses
  `CFG.choresTime`, if anything's actually due-or-overdue (nothing to nag
  about otherwise) and no other dialog is already open. (2026-08-18: the
  🔒 topbar button that also opened it by hand is gone — chores are fully
  automatic now, and that topbar slot is a ❓ opening `fieldGuideDialog`, a
  static in-app help popup, instead. `lockDialog` itself is unchanged,
  just no longer manually reachable.) Each chore now confirms
  independently (`lockDialog`'s picker was accidentally single-select —
  every click cleared every other selection — even though the screen has
  always said "CHORES" plural). **`localStorage` access is unverified
  against the real published artifact** — this test suite's Playwright
  harness runs on an `about:blank` origin, which throws a `SecurityError`
  on the mere property read `localStorage.getItem`, so persistence itself
  couldn't be exercised there; the code catches that (same defensive
  pattern the stale-cache self-heal IIFE already uses around
  `sessionStorage`, guarding a real observed constraint, not a
  hypothetical one) and falls back to an empty state rather than crashing,
  but if the artifact sandbox blocks storage outright, chore done/overdue
  state silently never persists across a reload. Confirm against the real
  artifact before trusting this beyond a single session.
  The per-chore day-of-week picker (4 chores × 7 toggles) started as an
  inline block in the main settings sheet and blew the sheet's own "no
  internal scroll down to 667px" promise by ~350px — split into its own
  small popup (`choreDaysPanel`, opened via a compact "Edit days →" button
  next to the reminder-time row) instead. Watch for class collisions when
  adding buttons inside `.set`: an early version of that button reused
  `btn quiet`, which is also Settings' own Cancel-button class, and
  `.dialog .btn.quiet` matched the new button first — Cancel silently
  stopped closing the sheet at all sizes until it was caught.
- **Settings has a "Reset all" (`resetAllData`), for forgetting Daisey's own
  bookkeeping, not the user's real data.** It clears the chores localStorage
  state (`daisey.chores.v1`) and resets `S.stats` to `DEFAULT_STATS` — streak,
  history, category weighting (`catWeight`, used in ranking), and every card's
  rollover/aging count — while keeping `settings` (hours, load, colours,
  chore schedule) exactly as they were, since those are configuration, not
  memory. **`projects` (deadlines) is preserved for the same reason**
  (2026-08-23): the user typed it, so it's their data, not something Daisey
  inferred about them. It does **not** touch Trello cards or Google Calendar events; a
  card that rolled over 5 times shows up fresh (age 0) on the next build, but
  nothing about the card itself changes. Gated behind `confirmDialog` (Keep
  vs the destructive action), then reloads the page so every in-memory cache
  (`S.cardCache`, `S.choresShown`, etc.) starts clean too, rather than trying
  to hand-unwind each one. The button lives in the settings-sheet **footer**
  (`.mini.text.del`, reusing the existing red remove-card styling), not the
  scrollable `.set` body — verified by direct A/B measurement that it costs
  zero extra height there (a body row was tried first and pushed two more
  viewports into the internal-scroll problem above; the footer row's height
  is already set by the taller Save/Cancel buttons, so a small pill button
  added to it is free). `location.reload()` is not interceptable in a test
  harness — `Location.prototype.reload` doesn't accept being shadowed by
  assignment, confirmed by a direct check (`location.reload = fn` silently
  no-ops, `location.reload === before` stays true) — so its own smoke test
  proves the reset via the real `load` navigation event plus the
  `trelloWriteCard` payload, not by faking the reload away.
- **`quickMax` already was the per-day cap on quick tasks** (see the
  settings bullet above) — the user asked for it not knowing it existed, so
  the actual work was cosmetic: it moved onto the same row as "Quick Task"
  (its minutes-per-window sibling) and its label changed from "Max Quick
  Tasks"/"/day" to "Max Per Day". The naive version put the label and its
  number input as two separate flex children in `.set-v`; at 375px
  (iphone-se) that let `flex-wrap` split them — "Max Per Day" stayed on
  line 1 next to "min", its input landed alone on line 2 with nothing
  beside it. Fixed with a `.set-v-group` wrapper (`display:inline-flex`)
  around the label+input pair so wrapping treats them as one unit — if it
  wraps at all, the whole "Max Per Day [input]" pair moves down together.
  Still wraps to two lines at 375px (this row now has 4 controls in a
  ~240px value column), same class of tradeoff as the chore-day pickers
  elsewhere in this sheet — not worth shortening user-specified label text
  to dodge it. Net effect on the settings-sheet height budget: merging two
  rows into one removed a full `.set-row`, which incidentally fixed
  pixel-short's (412x732) internal-scroll failure — iphone-se (375x667)
  and the swatch-count mismatch are the only settings.js failures left,
  both the pre-existing tracker-board issue, unrelated to this change.
- **A `.row`'s title is a real grid column, not a flex item that could get
  pushed onto its own full-width line.** `.row` used to be `display:flex`
  with time/dot/(list-name chip)/title as flat siblings; `fitRowTitle`
  shrank the title's font to *try* to keep it sharing the line, but nothing
  structurally stopped the title from dropping below at full width once
  shrinking couldn't make it fit. `.row` is now `display:grid;
  grid-template-columns:auto minmax(0,1fr)` — column 1 is `.row-lead`
  (`rowLead()`, a small helper: time + dot + optional `sourceChip`, grouped
  into one grid cell), column 2 is `.n`, the title, always the right
  column, structurally. `fitRowTitle` got simpler as a result: `.n`'s own
  `clientWidth` *is* the real available width now, no more summing
  sibling `getBoundingClientRect()`s by hand. It also grew a second phase:
  the old single-line shrink is a clean ratio (nowrap width scales
  linearly with font size), but wrapping to a **max of 2 rows** isn't —
  real line breaks land word-by-word — so a follow-up loop measures the
  actual wrapped height and steps the font down further until it fits two
  lines or bottoms out at a lower floor. `-webkit-line-clamp:2` was tried
  as a hard backstop below that floor and dropped: `.n`'s only child is
  `.nt` (`display:inline-block`, load-bearing for the RTL-title-stays-
  beside-the-timestamp fix, see `bidiSpan`) and Chrome doesn't clamp a
  `-webkit-box` through an inline-block child — confirmed directly (a bare
  text child clamps to the expected 2-line height, an inline-block-wrapped
  one renders a 3rd line anyway). So the cap is JS-only: a title so long
  even the floor can't fit it in two lines (a synthetic 200+ character
  title in testing; nothing close to that in real card names) wraps past
  two rather than truncating silently — same tradeoff the single-mechanism
  design already made before this change, just now aimed at 2 lines
  instead of unbounded. `nowCard`, `timelineItem` (both week-view and
  stack/day-list rows share one row-builder) and `doneDialog` all switched
  to `rowLead()` so every `.row` in the app has the same 2-child DOM shape
  the grid template expects — a 3rd stray child (the old flat t/dot/chip
  siblings) would've broken the column auto-placement.
  Verified with an isolated smoke test (not folded into the tracked
  suite): `.row` computes to `display:grid`, the lead cluster and title
  sit on the same top edge (same line), a short title is left completely
  unshrunk, a realistic ~50-char long title shrinks and wraps to fit fully
  within 2 lines, and a pathological 240-char title still shrinks (to the
  floor) without erroring even though it can't make 2 lines at a readable
  size. Published — the user confirmed the pre-fix behavior first (a
  screenshot of a title still dropping to the far left on its own line),
  which turned out to be real: **this whole change was silently wiped from
  `tools/daisey.html` on disk by another concurrent session between being
  written and being published** — `grep -c "row-lead"` went from 4 to 0
  with no edit of mine in between, while the same session's *other*,
  unrelated `DEFAULTS`/`findSlots` changes (see the bullet below) stayed
  intact and kept growing. Re-applied from scratch and published within
  the same turn to shrink the re-collision window; a second publish
  conflict landed mid-republish (a second concurrent session), resolved
  the normal way — WebFetch the live artifact, diff against local — which
  showed the newly-published copy still lacked `row-lead` too, confirming
  the local copy was the superset and safe to ship as-is. Take a fresh
  `grep -c` (or equivalent) on the exact thing you just wrote immediately
  before publishing, not just a stale mental note that it's "in the file
  since I wrote it a few tool calls ago" — a same-session Edit's own
  success message doesn't prove a foreign session hasn't overwritten the
  file since.
- **A permeable meeting's `.nest` groups tasks by start time, not full
  containment** (`groupForStack`). A task counted as "during the meeting"
  only if it started *and* ended inside the meeting's own window
  (`t.s >= it.s && t.e2 <= it.e2`) — a session that starts inside a
  permeable meeting like `חמל` but runs past the meeting's own end (its
  own duration is longer than the remaining permeable window) fell out of
  `children` entirely and rendered as a flat top-level card instead, so
  the dashed `.nest` line stopped short of it even though it visually read
  as "the next thing after the meeting's other nested task," not a
  separate top-level item. Now a task nests as soon as its start falls
  inside the meeting (`t.s >= it.s && t.s < it.e2`) — the line grows with
  whatever `.nest` actually contains, so it needed no separate change once
  the grouping was fixed. Scoped to `groupForStack`'s own display grouping
  only; `withinPermeable` (the swap-eligibility check for "can only a
  quick task land in this exact slot") still requires full containment,
  since that's a different question — a slot's own bounds sitting fully
  inside the meeting — and both readings can coexist without conflict.
- **A meeting that comes chronologically first always renders above the
  hub, even when it isn't happening right now** (`splitAgenda`'s
  `meetingNow`, 2026-08-18, user report — a screenshot of tomorrow's day
  view showing חמל at 06:00 sitting *below* a hub task at 09:00). The old
  `meetingNow` only matched a meeting literally in progress
  (`i.s <= nowMin && i.e2 > nowMin`), so anything else — including a
  meeting that starts before the hub task but hasn't begun yet, or any
  meeting at all on a non-today day (`isToday` gated the whole check) —
  fell through to the plain later-items list, which always renders under
  the hub card regardless of real start time. `meetingNow` now also
  matches a meeting whose start is before `current`'s start
  (`current && i.s < current.s`), and the `isToday`-only gate is gone —
  the "happening now" half of the check still only applies when viewing
  today (a future day has no "now" to be inside of), but the
  "starts-before-the-hub" half runs on every day. First pass only added
  the starts-before check under `isToday`, which fixed today's view but
  left a future day's meetings still falling under the hub — exactly the
  screenshot's scenario — caught by the user re-checking the published
  fix and fixed in the same turn.
- **The `.nest` dashed line runs from the banner through the hub card to
  its nested tasks, via a plain in-flow spacer — not an overlay** (final
  design, 2026-08-18, same session — this bullet replaces an earlier
  z-index-overlay version, kept below as the reason the design changed).
  `paintMain` wraps `meetingNowRow` + `nowCard`/`emptyNow` + the standalone
  `.nest` in one `.hub-group` div whenever both the banner and its nest are
  rendering (`wantsLine = meetingNow && meetingKids`) — every other case
  still appends straight to `host`, unchanged. A `.hub-connector`
  (`border-left:2px dashed`, fixed `height:26px`, no `position` at all) is
  inserted once between the banner and the hub card, and again between the
  hub card and the nest; nest keeps its own original `border-left`
  untouched. Each connector sits in the literal empty gap between two
  cards — nothing else occupies that space — so there is no stacking order
  for any browser to get right or wrong, unlike the overlay version below.
  26px was tuned by eye in a local render to show enough dashes to read as
  "the line continues here," not a stub; the earlier 16px version and the
  bare 2-connector wiring without this height were what the user called
  "terrible." `rules.js`'s `#pageMain > .meeting-now` /
  `#pageMain > .nest.standalone` selectors moved to
  `#pageMain .hub-group > ...` since they're no longer direct children of
  `#pageMain` in this one case.
  **Two earlier passes tried to draw ONE continuous line behind the whole
  group instead, via `.hub-group{position:relative;z-index:0}` and a
  `::before{position:absolute;...;z-index:-1}` spanning the full height.**
  This is correct per CSS2.1's real paint-order steps (negative z-index is
  its own step, painted before every other step in that stacking context,
  positioned or not) and rendered correctly behind the card in a local
  Playwright screenshot — twice, on two separate attempts. **Both times the
  user's real device still showed the line crossing over the card**,
  including when explicitly checked in incognito (ruling out this file's
  known stale-cache issue, see below). That divergence between a clean
  local Chromium render and the real published artifact was never root-
  caused. Given a second failure of the same well-reasoned fix, the overlay
  approach was abandoned outright rather than debugged a third time — the
  in-flow-spacer design above has no equivalent bug *to* have, since
  nothing overlaps. If a future need for a connecting line/decoration
  comes up in this file, prefer a real in-flow spacer over any positioned
  overlay + z-index, even when the z-index reasoning checks out and passes
  a local test — this is the second time that combination still failed on
  the real artifact.
  **This also throws real doubt on an earlier report in this same thread**:
  after the *first* z-index attempt shipped, the user said "still behind"
  with no fresh screenshot, which was taken at face value and used to
  justify jumping straight to a different design — but this file also lost
  edits to an unrelated concurrent-session race at least twice later in
  the same session (both `Edit` calls reporting success, followed by a
  `grep` moments later showing old CSS still on disk, identical both
  times, fixed only by re-editing and publishing immediately with no delay
  in between). It's plausible that first report was the same race rather
  than a real CSS failure, and the fix never survived to what got
  published. Take a same-turn `grep` immediately before *and* immediately
  after publishing this file, not just before — a clean pre-publish check
  doesn't prove the publish itself read that content if another session
  writes in between. And don't treat a bug report with no fresh evidence
  as confirmation that a specific, reasoned fix didn't work — ask for (or
  independently re-verify against) a new screenshot before abandoning it.

### Stale-cache self-heal (don't delete it)

Chrome outside incognito has repeatedly kept serving an old cached copy of
the published artifact after a republish — a manual refresh didn't clear it,
only incognito or clearing site data did. The small IIFE at the top of the
`<script>` block fixes that from inside the page: the artifact shell stamps
each publish into `<base href="/_f/<publishTime>-<hash>/">` (verified
per-publish, not per-request), so it compares its own stamp against a copy
fetched with `cache:"reload"` and reloads if they differ. It fetches the
bare `location.pathname` on purpose, so opening a `?cache-busted` variant
also repairs the cache entry behind the clean shortcut URL. No version
string to bump by hand. It no-ops outside the shell (tests, `file://`).

It re-checks on **every** load, not just the first one in a tab. An earlier
version short-circuited once a load's stamp had been verified fresh, on the
theory that re-checking was wasted work — but with the same tab kept open
across several republishes (the normal way this gets iterated on), that
first clean verification permanently disabled the guard for every publish
after it, so newer features silently never showed up. The one-shot reload
guard is now keyed to the specific stale stamp seen (in `sessionStorage`),
not a single boolean, so it still won't loop against a server that keeps
disagreeing, but each new stale stamp after a later publish gets its own
attempt instead of being waved through.

### Connector notes (observed, not from docs)

- `trelloReadCard` `list_by_board` returns a flat `cards.nodes` array
  with `list` embedded per card — *not* the grouped shape its own
  description claims.
- `trelloReadList` `list_by_board` returns a flat `lists` array plus
  `pageInfo` — not the `nodes` wrapper the card reads use. `limit` caps
  at 50, not 100. **Each list is `{id, name, position, objectId}` and
  nothing else — there is no colour field** (re-confirmed against the real
  board 2026-08-27, when per-list card colours were asked for). Colour in
  Trello belongs to labels and to board backgrounds, not to lists, so any
  "list colour" in Daisey is one Daisey assigns — see `listCss`.
- `trelloReadChecklist` returns `checkItems`, not `items`.
- `trelloWriteChecklist` returns the updated item directly, unwrapped;
  other Trello writes return `{cards:{nodes:[…]}}`.
- Google Calendar `list_events` is intermittently unavailable; treat
  failures as transient and keep last-good data.
- `trelloReadCard` `list_by_board` has been seen coming back *successfully*
  with a card missing that was there on the previous poll — no error, so
  `onWatch`'s error-only last-good fallback doesn't catch it. `cardFor`
  (`S.cardCache`) now keeps the last-resolved card per `shortLink` and
  falls back to it when a poll's result briefly doesn't include it, so a
  block's colour and title don't flash to the neutral fallback and back
  every few minutes.
- `trelloReadCard` `list_by_board` is called with **no `limit` and no
  paging** — one call per board, and whatever comes back is all Daisey
  has. This has never been tested against a board with 100+ open cards.
  If the Assets view shows fewer assets than the board holds, that is the
  cause, and paging is a real piece of work, not a flag.
- **There is no card start-date field, in either direction.** `trelloReadCard`
  (`get` and both `list_by_*` actions) returns only `due` — no `start` key,
  present or null. `trelloWriteCard`'s schema confirms it: `name`/`desc`/`due`
  are the only card-content params it accepts, no `start`. Daisey's own start
  date (see the card-start bullet above) is a text marker in the description,
  not a Trello field, because of this.
- **`update_event` with only `description` set is unverified against the
  real connector.** `moveBlock` has long proven a partial update works for
  `startTime`/`endTime` alone; `updateBrickDesc` (the quick-task brick
  model, see the bullet above) is the first call site to send only
  `description` and expect `start`/`end` to survive untouched. The test
  stub in `harness.js` was written to match that assumption (only fields
  actually present in `input` get patched) but that's a guess encoded into
  the mock, not something observed from Google Calendar itself. If a real
  brick Done/Swap/Remove ever clobbers a block's time back to something
  wrong, this is the first place to look.

### The capability manifest is a full-set declaration

The artifact declares which connector tools it may call. A tool that
isn't in the manifest rejects with `not_in_manifest` — surfaced as "This
page isn't allowed to call that Trello tool." **Adding a `callTool` or
`watchTool` for a tool that isn't already declared silently breaks that
feature until the manifest is republished**, which is exactly how the
Assets view shipped dead: `trelloReadList` had never been in it.

The manifest currently declares, and this list must stay in sync with
every `callTool`/`watchTool` site in the file:

- **Trello** — `trelloReadCard`, `trelloReadList`, `trelloReadChecklist`,
  `trelloReadBoard`, `trelloWriteCard`, `trelloWriteChecklist`,
  `trelloWriteList`
- **Google Calendar** — `list_events`, `list_calendars`, `create_event`,
  `update_event`, `delete_event`

`trelloReadBoard`, `trelloWriteList` and `list_calendars` joined on
2026-08-24 with the multi-user setup wizard (board discovery, creating the
state list, calendar picking).

Passing a non-empty `capabilities` object is a **full-set** declaration —
anything stored but not restated is revoked — so always restate all twelve.
Enumerate them before publishing rather than trusting this list:

    grep -oE '(callTool|watchTool)\((TRELLO|GCAL), *"[a-zA-Z_]+"' tools/daisey.html | sort -u

Same bug, older: `statsListId()` also calls `trelloReadList`, so the
"create the state card if it's missing" path documented above could never
have worked either. Fixed incidentally by the same republish.

Observe a real request/response pair before writing new connector code.

## Daisey standalone (no Claude, real OAuth)

2026-08-24 — the user asked for Daisey to work "just like any other app," no
Claude account, no artifact publish step. In progress; this section covers
what exists so far (build-order steps 1–2 of the plan) and what doesn't yet.

**The whole approach rests on one verified fact:** every one of
`daisey.html`'s ~27 Trello/Google call sites goes through exactly `callTool()`
or raw `S.mcp.watchTool()` — 12 distinct tool operations, two choke points.
`boot()` reads `window.claude` in exactly one place. That means none of the
27 call sites, and nothing in `setupWizard()`/`discoverSetup()`/
`legacySetup()`, needs to change — the work is building a same-shaped
replacement for what `S.mcp` *is* (real HTTP to a backend holding real OAuth
tokens), not rewriting the app. **This is proven, not assumed** —
`tools/test/standalone.js` boots the real generated file against a real HTTP
mock and shows `SETUP` gets adopted from the same Trello-state-card mechanism
unchanged, a real write reaches the mock as a real `trelloWriteCard` call,
and `window.claude` is `"undefined"` throughout.

**`tools/daisey-standalone.html` is GENERATED, never hand-edited.** Produced
by `node tools/build-standalone.js` from `tools/daisey.html`. This is the
load-bearing decision in the whole effort: a hand-maintained fork would
silently drift from the real app exactly the way `tools/test/daisey.html`
already has to be actively re-copied before every test run to avoid (see the
"Several sessions edit this file at once" section above, and the `row-lead`
incident it documents) — a build script makes that class of bug structurally
impossible instead of something to remember. **Run it after every edit to
`tools/daisey.html`** if the standalone build needs to reflect it; nothing
runs it automatically yet (no Netlify build hook), so a stale
`daisey-standalone.html` fails loudly only if someone notices, not by design.

**How the splice works**: two literal marker comments —
`BUILD-STANDALONE:MCP-RESOLVE` / `END BUILD-STANDALONE:MCP-RESOLVE` — wrap
the `window.claude.use("mcp")` line inside `boot()`. The build script does a
literal text replace between them (not parsing), inlines
`tools/_standalone-src/boot-block.js` in their place, and inlines
`tools/_standalone-src/mcp-shim.js`'s function definitions just before the
closing `</script>` tag (in scope for `boot()` via hoisting — no module
system, matching this file's single-`<script>`-block design). It then
self-checks: the output must parse as JS, must contain the shim's function
names, and must **not** contain `window.claude.use` anywhere. If the marker
text is ever renamed or the `boot()` shape changes enough that the splice
point moves, the script fails loudly with a specific fix instruction rather
than producing a silently broken file.

**`STANDALONE`** (`daisey.html`, a `let`, always `false` in the source and
therefore in the published Claude artifact) is flipped to `true` by the build
script via one more literal text replace, and read by `errCopy()` — a shared
function, not forked, because every code's copy other than the two "go
reconnect" ones already means the same thing in both deployments; only
`needs_reauth`/`server_not_connected`'s copy ("...in claude.ai → Settings →
Connectors") is meaningless outside Claude and gets standalone-specific text
+ a real link (`errFixUrl()`) instead. **Deliberately a module-level flag,
not a second parameter threaded through `errCopy`'s ~30 call sites** — every
one of those is a bare `errCopy(e)`, and adding an argument everywhere is
exactly the many-places-to-keep-in-sync problem this whole plan exists to
avoid elsewhere (see the audio-sync scoring-duplication bullet, same shape of
risk).

**The login gate lives inside `sharedState()`** (`daisey.html`, guarded by
`STANDALONE` so it's dead code in the artifact) — the same "nothing truthful
to show yet" fallback `S.noMcp` already used, not a second render path.
`S.needsLogin` → `renderLoginGate()` (Sign in with Google); `S.needsTrello` →
`renderTrelloLinkGate()` (Connect Trello, reached via a `?needsTrello=1`
redirect from the Google callback, not app-side polling for a "half logged
in" state the backend would otherwise have to expose). **Google first,
Trello second is deliberate**: Google mints the session; Trello only ever
links into an existing one.

**The shim** (`tools/_standalone-src/mcp-shim.js`) implements `callTool`/
`watchTool`/`invalidate` over `fetch("/.netlify/functions/daisey-proxy", ...)`
— that backend function doesn't exist yet (next build-order step). `watchTool`
polls at the *same* `refetchInterval`s the app already passes per call site
(180000/600000/120000ms) rather than inventing new ones — those numbers
already encode the real staleness tolerance. A bare 401 from the proxy (no
session cookie) throws `{code:"no_session"}`, distinct from a stale
Trello/Google token (`{code:"needs_reauth"}` in a 200 body) — the former means
"we don't know who this is," the latter "we know, but the tokens are dead."

**Test harness quirk worth knowing if this area gets touched again**:
`tools/test/mock-proxy.js` (a plain Node `http` server, not Netlify-shaped —
it only needs to prove the shim/splice, not the real proxy's auth logic yet)
first shipped without a `charset=utf-8` on its `text/html` response. Chromium
defaulted to Latin-1, mojibake'd every emoji/Hebrew character in the served
page — including the `📊 Daisey Stats` marker `STATS_NAME_RE` matches on —
and state-card discovery silently found nothing, with zero console errors.
Cost a real debugging pass to trace back to a missing HTTP header rather than
app logic. Both the HTML and JSON responses declare it now.

**Google OAuth proven live (2026-08-24).** `daisey-auth-google-start.js` /
`daisey-auth-google-callback.js` are deployed on master. A real
sign-in-through-consent-through-callback round trip returned a real
access token, refresh token, and the right scope. Token storage isn't
wired to them yet — the callback currently just reports the shape it got,
by design, as a smoke test.

**Netlify Blobs auto-detection is broken on this project — confirmed, not
guessed.** `getStore(name)` with no options throws
`MissingBlobsEnvironmentError` on every deployed invocation.
`NETLIFY_BLOBS_CONTEXT` (the env var Netlify's runtime is supposed to
inject for auto-config) reads `null` — checked directly via a diagnostic
endpoint. This matches an open, actively-discussed Netlify bug, not
anything wrong in this repo's code (`getStore` is already called inside
the handler, the documented placement).
**Fix: manual `siteID`+`token`.** `openStore(name)` in
`daisey-blobs-smoketest.js` falls back to
`getStore(name, { siteID: SITE_ID, token: TOKEN })` whenever
`NETLIFY_BLOBS_CONTEXT` is absent, using `SITE_ID` (present at runtime;
`NETLIFY_SITE_ID` is not, on this project) and a new
`NETLIFY_BLOBS_TOKEN` — a **Personal Access Token**, full-account scope,
not a Blobs-scoped credential (Netlify has no narrower token type for
this). **Verified with a real write, then a real read from a separate
invocation** — same value came back. `daisey-proxy.js` should copy this
exact `openStore()` pattern rather than a bare `getStore()` call, or it
will hit the same error.
`netlify/functions/daisey-blobs-smoketest.js` is safe to delete once
`daisey-proxy.js` is built and this pattern is copied into it — it's a
throwaway, scoped to its own `"smoketest"` store only.

**Still not built**: the real `netlify/functions/daisey-proxy.js` (the one
generic tool-call endpoint — reads/writes the store, dispatches to
Trello/Google REST) and the Trello OAuth start/callback/relay functions.
`mcp-shim.js` has real endpoints to talk to for Google now, nothing for
Trello or the proxy yet.

**Registrations done, env vars live on the Netlify project (2026-08-24)**:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (a real Google Cloud OAuth Web
client, External/Testing consent screen), `TRELLO_STANDALONE_API_KEY` +
`TRELLO_STANDALONE_API_SECRET` (a dedicated new Trello Power-Up, "Daisey
Standalone" — NOT the old "Start Date Integration to Claude" app that
`trello-webhook.js` already uses), `SESSION_SECRET`/`TOKEN_ENCRYPTION_KEY`
(generated, 32 random bytes each). All set via `netlify env:set`, all
`Scope: All`, none committed to any file.

**First attempt at `TRELLO_STANDALONE_API_KEY` mistakenly reused the OLD
app's key.** Caught and corrected same session: a fresh Power-Up ("Daisey
Standalone") was registered at trello.com/power-ups/admin, and both
`TRELLO_STANDALONE_API_KEY` and `TRELLO_STANDALONE_API_SECRET` were
overwritten with that app's real key+secret. Two separate Trello apps now
exist — the old one, key+secret under `TRELLO_API_KEY`/`TRELLO_API_SECRET`,
used only by `trello-webhook.js`/`audio-sync.js`; the new one, under the
`_STANDALONE_` names, used only by the new OAuth flow. Keep them that way —
sharing an app across the fixed-automation and per-visitor-OAuth use cases
is exactly what caused the incident below.

**`TRELLO_API_SECRET` was overwritten by mistake, and it is the author's,
not standalone's.** `trello-webhook.js` (line 16) reads this exact name for
its HMAC signature check (`validSignature`, HMACs the raw body + callback URL
against the secret of whichever Trello app the webhook was registered
under). The user pasted a Trello key+secret pair for the *new* standalone
app; the second value was set under the existing `TRELLO_API_SECRET` name
without checking it was already in use — it was. **The webhook's signature
check has been silently broken since**: incoming Trello webhook calls will
fail `validSignature` because the secret no longer matches the app the
webhook is registered under, and the function has no alerting, so nothing
will announce this. Blast radius is narrow — only the `<!-- daisey-start:…
-->` date-marker sync breaks, nothing else in the site or in Daisey depends
on this secret, and it fails closed (drops silently) rather than open (no
security exposure). **User's explicit call: leave it as-is, don't chase a
fix.** If this area is ever revisited: either restore the original secret
(if recoverable from wherever the webhook was first registered) or
re-register the webhook against the new key/secret pair. The lesson for any
future `netlify env:set` in this repo: always `netlify env:list` first and
check for a name collision — the CLI overwrites silently, with no diff and
no confirmation prompt.

New standalone-only credential is `TRELLO_STANDALONE_API_KEY`, kept
deliberately distinct from `TRELLO_API_KEY`/`TRELLO_API_TOKEN` (which
`audio-sync.js`/`trello-webhook.js` keep using unchanged — one fixed
credential pair authenticating as the author for automation,
architecturally the opposite of per-visitor OAuth, must never be confused
with or reused by the new functions).

## Audio project → PROJECTS sync

A user request ("Trello needs to create cards in PROJECTS that pull from a
project's own board") turned into `netlify/functions/audio-sync.js` — a
**scheduled Netlify function** (every 30 min, `netlify.toml`), not code
inside `daisey.html`. Decided 2026-08-18: Daisey's own automation (rollover
sweep, chores lock screen) only runs while the tab is open; this needed to
run even when it isn't, same as the pre-existing (untracked, in-progress)
`trello-webhook.js` start-date sync. Uses the same `TRELLO_API_KEY`/
`TRELLO_API_TOKEN` env vars (already set in Netlify) via raw REST — it does
not go through the MCP connector or the artifact's capability manifest at
all, since it isn't running inside the artifact.

**What it does:** finds every Trello board named `<Project> - Audio` (regex,
tolerant of `-`/`–`/`—`), reads its `Waiting`/`In Progress` tracker cards,
groups them by the subject before the colon in the card name (`"Boss: Green
Fire"` → subject `Boss`), sizes each group, and creates/updates cards on
PROJECTS → `<Project>` with Daisey's own yellow/orange labels — sizing is
all `sizeFromLabels` needs, so a synced card enters Daisey's normal schedule
with no further wiring.

**Sizing, since no Trello field carries any of this:**
- SFX items are scored by keyword match on the text after the subject
  prefix: Simple=1, Standard=2 (default), Complex=4
  (`chain`/`shockwave`/`multi`/`sequence`/`cutscene` → 4;
  `ui`/`menu`/`blip`/`beep`/`click`/`tick`/`ambient`/`footstep` → 1). A run
  of items sharing a `"<Name> - <part>"` prefix (2+, e.g. the real 4-part
  "Mine Shot" chain: fire/loop/ground-contact/explosion) collapses into one
  Complex(4) item — it reads as one designed event, not four.
- New items pack into a bin up to `WORKDAY_CAP` (16 points); a bin totalling
  ≤ `SESSION_CAP` (6) becomes a Session card (yellow), otherwise a Work day
  card (orange). A subject with an existing open (non-legacy, not
  archived/done) auto-batch tops that card up before opening a new one;
  multiple bins get a `(batch N)` suffix.
- **Music is not point-packed** — one card per track, since a track doesn't
  parallelize with other tracks the way small SFX cues do. Size comes from
  the tracker card's own description: a parseable `"<n> min"` means
  Production stage (≥1 min = Work day, <1 min = Session, straight from the
  user's own rule); no parseable length means Demo stage (always Session —
  "send for first approval"). This is why `desc` on a music tracker card now
  matters: the three real Monster Punk tracks got `"1 min"` / `"1 min"` /
  `"3 min"` added by hand (2026-08-18) specifically so this rule has
  something to read — before that there was no signal at all, not even
  informally, and this function would have had to guess.
- These are keyword/heuristic-driven, not tagged, on purpose — the user
  declined adding manual complexity labels to tracker cards. Expect
  misclassifications; tune the keyword lists in the file, don't add a
  tagging UI unless asked again.
- **`classify` and `splitSubject` have a second copy inside `daisey.html`**
  (`audioClassify`/`splitSubject`, plus `scoreSfxItems`' chain-merge as
  `audioScoreItems` and the marker regex) — the Projects view predicts what
  this function will create so the user doesn't wait 30 minutes to see a
  deadline's cost. There is no shared module and cannot be one without a
  build step: this is CommonJS on Netlify, that is a single-file artifact.
  **Editing a keyword list here without editing it there makes the pressure
  read silently disagree with the cards that actually get made.**
  `tools/test/proj.js` asserts the two agree across a fixed table, lifting
  this file's real function source at test time — run it after touching
  either. Note also that this function writes **raw Trello ids** into the
  marker while Daisey holds ARIs, which is why the reader normalises both
  ends through `bareId`; see the Projects manager bullet.

**Idempotency:** every card this function writes carries a hidden
`<!-- daisey-audio-sync v1 subject="…" board="…" items="id:pts,…" -->`
marker naming the tracker item IDs it covers, so a later run never
re-batches a covered item. A card with no marker is invisible to this
system — never read for coverage, never edited. This is exactly the same
shape as `DF_MARK`/`isStats` in `daisey.html`: a hidden marker is how a
script tells its own output apart from a human's.

**Backfill (2026-08-18, one-time, done directly via Trello writes, not by
this function):** the 8 hand-made batch cards that already existed on
PROJECTS → MonsterPunk before this function existed got `legacy="true"`
markers covering the 18 tracker items they already handle, so the first
live run wouldn't recreate them. `legacy="true"` cards count toward
coverage but are never a target for "top up the open batch" — this function
only ever edits cards it created itself, never a hand-authored one. Two of
those 8 cards ("Implement approved combat SFX", "FMOD combat mix pass")
aren't tied to specific tracker items at all — they drain whatever's in
`Approved` dynamically — and were left with no marker; nothing to cover.
On first deploy, the only genuinely new work on Monster Punk was the 3
music tracks (nothing had ever made PROJECTS cards for those) — confirmed
by hand before going live, not assumed.

**Known gaps, not yet handled:**
- Same "every project board is one call, no `limit`/paging" ceiling as
  `daisey.html`'s tracker reads — untested past a small board.
- The PROJECTS list a project maps to is found by fuzzy match (strip
  spaces/case) against existing PROJECTS lists, e.g. board `"Monster Punk -
  Audio"` → list `"MonsterPunk"`. If nothing matches, it **creates** a new
  list — so a brand-new audio project needs zero manual Trello setup beyond
  naming the board right. Get the board name wrong (missing the `- Audio`
  suffix) and it's silently invisible to this whole system.
- Batch numbering (`(batch N)`) is approximate once a subject has a mix of
  legacy and auto-generated cards — cosmetic only, doesn't affect coverage
  or sizing correctness.
- Runs only ever add/update; nothing here archives a batch card when its
  tracker items finish. That still happens by hand, same as it does for
  every other PROJECTS card today.
