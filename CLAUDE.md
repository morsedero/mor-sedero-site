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

- **3 quick tasks + 1 work session per day.** Caps count blocks already
  on the calendar, including ones this widget did not create.
- **15 min buffer** either side of a work session.
- **Real meetings are never scheduled over.** All-day events are the
  only exception.
- **Shabbat schedules nothing.** Friday is an ordinary day.
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
