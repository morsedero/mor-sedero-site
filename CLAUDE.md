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
  (3h), orange = long session / work day (8h). `card.size` and
  `event.size` (read back from the Google Calendar colorId: 9 quick, 5
  short, 11 long) drive every scheduling decision — board is now only
  colour identity plus the today-board exclusion.
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
  meeting row).
- The day off schedules nothing. Every other day is ordinary.
- A run **clears and re-lays** the day's card-linked blocks. It never
  touches a real meeting, finished work, or the block in progress.
- Hebrew card text is rendered RTL per field via `dir="auto"`; the app
  chrome never flips.

### Connector notes (observed, not from docs)

- `trelloReadCard` `list_by_board` returns a flat `cards.nodes` array
  with `list` embedded per card — *not* the grouped shape its own
  description claims.
- `trelloReadChecklist` returns `checkItems`, not `items`.
- `trelloWriteChecklist` returns the updated item directly, unwrapped;
  other Trello writes return `{cards:{nodes:[…]}}`.
- Google Calendar `list_events` is intermittently unavailable; treat
  failures as transient and keep last-good data.

Observe a real request/response pair before writing new connector code.
