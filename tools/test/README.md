# Daisey test harness

Drives the real `tools/daisey.html` in Chromium against a stubbed connector
bridge that replays the request/response shapes observed from live Trello and
Google Calendar calls. No network, no real writes.

The app is one page, `#pageMain`. A Day/Week switch in the header
decides what it shows: Day is the activity list (hub + everything else
today, meetings included — a permeable one like חמל groups the tasks
scheduled inside it under itself); Week swaps that list for the
calendar grid. Scripts below scope selectors to `#pageMain` mostly out of
habit carried over from the old two-page split — there's only the one page
now, so it's no longer load-bearing.

    cd tools/test && npm i playwright && npm test

`npm test` runs `run-all.js`, which refreshes `daisey.html` from
`../daisey.html` first (that copy is gitignored and used to go stale
silently), runs every suite, prints one `ok`/`FAIL`/`FLAKY`/`DUMP` line
each, and exits non-zero if anything failed. `npm test -- states.js` runs
one; `--jobs=N` parallelises. Serial by default — these suites wait on fixed
timeouts, and `retry.js` fails spuriously under CPU contention.

`det.js`, `edit.js`, `hub.js` and `mini.js` have **no assertions** — they
log state and screenshot, so they cannot fail. They report as `DUMP` and
never gate the run.

| script | what it checks |
|---|---|
| `assert.js` | scheduling rules across light / packed / late-start days: no overlap with a blocking meeting, buffers kept clear, caps held per tier, everything inside the working window, a long session excludes quick tasks |
| `work.js`   | the work-day rule itself: an 8h long session gets picked and blocks all quick tasks when it fits; falls through to short + quick when it doesn't; a permeable meeting (חמל) still blocks sessions even though quick tasks may land inside it |
| `late.js`   | the hub late in the day, once every slot is behind you |
| `fri.js`    | Friday plans itself to the caps with no prompt; Shabbat schedules nothing |
| `cap.js`    | the caps hold — per tier — whatever hour the widget is opened (07:30 / 12:10 / 16:30 / 21:54) |
| `cfg.js`    | settings Save actually persists and changes what the scheduler does, across all three tiers |
| `hour.js`   | quick tasks share one window, permeable meetings, swapping a task |
| `sat.js`    | the day off is never planned from any vantage point; legacy settings migrate |
| `mini.js`   | the hub's action row (Done / Swap / Pending / Remove, no "switch with next" any more), Remove's archive-and-clear flow, Pending's edit-popup (Cancel writes nothing, confirming writes the edited description + marker and clears the block, never archives; an optional "check back on" date lands in the marker too), completion writes, the progress pill opening/closing its done-list dialog, and `normCard`'s dated-marker expiry logic (blocked while the date's ahead, unblocked once it's past, still blocked if other text independently matches `BLOCK_RE`) |
| `states.js` | midday / empty day / Friday prompt / Shabbat |
| `dead.js`   | expired auth, unreachable server, no connector |
| `det.js`    | expandable description + checklist |
| `hub.js`    | rebuild-on-run, board colours, clock |
| `tick.js`   | details auto-opening, and ticking a checklist item through to Trello |
| `pages.js`  | the one-page shell (switch always visible, Day view lists meetings alongside tasks), Week view (7 columns, tapping a day header jumps into Day view), drag-in-Week-view + its Ctrl+Z undo popup, dragging onto another block (task or meeting) being rejected instead of silently committed, drag-to-reorder in the Day-view list (hub card included — dropping it on a row pushes the run between them over by one slot, 2 update_event calls for an adjacent pair, an undo that restores everyone the push moved, and dropping on a meeting is a no-op), tapping the date label to jump back to today, and Cancel discarding a settings colour preview |
| `edit.js`   | editing a card's description and a checklist item's text inline — save writes through (trelloWriteCard update / trelloWriteChecklist update_item), Escape cancels without writing, a rename doesn't touch the item's checked state |
| `chrome.js` | the app chrome: view switch + clock + progress/rebuild share one row without overflowing at phone width, the clock stays centered between them, the peach light palette, card titles anchoring right (hub included — it shares a row/row-meta layout with every other card now) |
| `day.js`    | the day boundary and a half-dead boot: crossing midnight with the page open advances the anchor, re-registers the calendar watch and builds the new day exactly once (a day the user navigated to is left where it is); booting with Trello never answering still renders the day off the calendar alone instead of a 20s skeleton; returning to a stale tab re-fetches both connectors, a fresh one doesn't |
| `settings.js` | the settings sheet fits the screen with no internal scroll and without spilling past the top/bottom edge, across four viewport sizes down to a 667px-tall phone; all three board swatches land in one row |
| `fast.js`   | Done / Swap / Pending / Remove are local-first: with every write held open, the progress pill has already moved, the finished card has already left the open list, the swapped-in card already holds the slot, and the cleared block has already gone — and a Done whose write fails puts the card and the pill back and holds the loss for retry |
| `retry.js`  | a transient `server_unavailable` is ridden out by `callTool`'s backoff (3 calls, one move, nothing shown to the user), a permanent one reverts the block but holds the move in the "N changes didn't save" bar, and Retry replays every held move |
| `push.js`   | dragging a card across more than one other in the Day-view list pushes the whole run over by a slot — not just a two-card trade with whatever's under the pointer — verified against four back-to-back quick tasks (A onto C also moves B, D stays put, exactly 3 update_event calls), and Ctrl+Z restores all three together |
| `tmr.js`    | a block built for tomorrow actually stays visible in the app (not just on the real calendar) and a second rebuild replaces it instead of duplicating it |
| `swap.js`   | swapping in a session or work-day card grows the slot to that card's own size instead of keeping the outgoing card's duration, in both directions; a quick card has no size of its own so it always keeps whatever slot it lands in |
| `stats.js`  | `saveStats` is single-flight: three overlapping saves coalesce into two writes instead of three racing ones, the final write carries the newest state (no lost update), the body is serialized at write time not call time, and a save after the queue drains still goes out. Verified to fail against the pre-fix implementation |
| `start.js`  | a card whose Trello start date is still ahead is excluded from `candidates()` (and the swap picker) until the built day reaches it, then schedules normally by its usual size rules; a card with no start date is unaffected |

`real-events.json` is a snapshot of one real calendar day, used to test against
a genuinely packed schedule rather than a tidy fixture.

Note: the container clock is UTC. Contexts pin `timezoneId: "Asia/Jerusalem"`
because the 09:00–20:00 scheduling window is local-time dependent.
