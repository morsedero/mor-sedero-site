# mor-sedero-site

Personal site, plus `tools/` — small self-contained apps.

## DayFlow

A daily focus widget over Google Calendar + Trello. One file:
`tools/dayflow.html`, published as a Claude artifact.

**Canonical artifact URL — always update this one, never publish a new
artifact for DayFlow:**

    https://claude.ai/code/artifact/9b19af95-0f72-418d-9fe8-04627957ff67

Publishing without that URL creates a *second* DayFlow and leaves the
user's home-screen shortcut pointing at a stale copy.

### Working on it

- Edit `tools/dayflow.html`, then republish to the URL above.
- Tests: `cd tools/test && npm i playwright && node assert.js` (see
  `tools/test/README.md`). They drive the real page in Chromium against
  a stubbed connector bridge — no network, no real writes.
- Run `assert.js` and `cap.js` after any change to the scheduling
  engine; they cover the rules the widget promises.

### Rules that are deliberate, not accidental

- **Caps, day window, block lengths, buffer, day off, board colours and
  the chime are user settings** (gear icon), stored in the Trello state
  card under `settings` and read into `CFG` at boot. `DEFAULTS` holds
  the shipped values: 3 quick tasks sharing one 60-min window, 1 short
  session x 3h, 1 long session x 8h, 15 min buffer, 09:00-20:00,
  Saturday off. Never hard-code these again.
- **A card's size comes from its Trello label, not its board**
  (`sizeFromLabels`): no label = quick task, yellow = short session
  (3h), orange = long session / work day (8h), green = info only, not
  scheduled. `card.size` and `event.size` (read back from the Google
  Calendar colorId: 9 quick, 5 short, 11 long) drive every scheduling
  decision — board is now only colour identity. `BOARDS` lists the three
  real work boards (PROJECTS, סידורים, סדקו); there is no separate "today
  priority" board — this widget's own live schedule replaces that. The
  hidden DayFlow state card lives on סידורים, in its own "📊 DayFlow
  (widget state)" list. The green exclusion was dead code for a long
  while: `candidates()` filtered on `c.labels?.some(...)` but `normCard`
  never put `labels` on the object it returned, so the optional chain
  quietly made it a no-op and green cards got scheduled anyway. `labels`
  now comes through whole — don't distil it down to `size` again.
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
- **A long session takes the whole day**: if one fits (ranked by the
  same urgency order as everything else — refining that ranking by
  due-date distance or project scale is future work, not done), no
  quick tasks are scheduled alongside it. Short sessions aren't
  explicitly excluded, but an 8h block plus buffers rarely leaves room
  for one anyway.
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
- A run **clears and re-lays** the day's card-linked blocks. It never
  touches a real meeting, finished work, or the block in progress. That
  last exemption means a block that becomes invalid mid-run (e.g. a
  meeting added after it was placed) can sit there wrong until it stops
  being "in progress" — the next run after that clears it normally. Seen
  once in practice: a stale session block inside `חמל`, gone on its own
  once its slot ended and a later run replaced it correctly.
- Hebrew card text is rendered RTL per field via `dir="auto"`; the app
  chrome never flips.
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
- **There is no dark mode, on purpose.** DayFlow commits to one bright
  palette on bare `:root` and overrides the reader's theme instead of
  following it — `color-scheme:light !important` beats the inline
  `style.colorScheme` the shell sets, and there is no
  `prefers-color-scheme` or `[data-theme="dark"]` block. A dark palette
  existed and was removed: a dark-mode reader saw a near-black page and
  read it as the artifact being stale, which cost a long debugging
  detour. `chrome.js` asserts brightness under both the media-query and
  the shell's `data-theme="dark"` path — the latter is the one that
  actually ships. Don't add a dark block back without asking.

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
  at 50, not 100.
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

Observe a real request/response pair before writing new connector code.
