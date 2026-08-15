# DayFlow test harness

Drives the real `tools/dayflow.html` in Chromium against a stubbed connector
bridge that replays the request/response shapes observed from live Trello and
Google Calendar calls. No network, no real writes.

    cd tools/test && npm i playwright && node assert.js

| script | what it checks |
|---|---|
| `assert.js` | scheduling rules across light / packed / late-start days: no overlap with a blocking meeting, buffers kept clear, caps held per tier, everything inside the working window, a long session excludes quick tasks |
| `work.js`   | the work-day rule itself: an 8h long session gets picked and blocks all quick tasks when it fits; falls through to short + quick when it doesn't |
| `late.js`   | the hub late in the day, once every slot is behind you |
| `fri.js`    | Friday plans itself to the caps with no prompt; Shabbat schedules nothing |
| `cap.js`    | the caps hold — per tier — whatever hour the widget is opened (07:30 / 12:10 / 16:30 / 21:54) |
| `cfg.js`    | settings persist and actually change what the scheduler does, across all three tiers |
| `hour.js`   | quick tasks share one window, permeable meetings, swapping a task |
| `sat.js`    | the day off is never planned from any vantage point; legacy settings migrate |
| `mini.js`   | the hub, "Not now" postponing, completion writes |
| `states.js` | midday / empty day / Friday prompt / Shabbat |
| `dead.js`   | expired auth, unreachable server, no connector |
| `det.js`    | expandable description + checklist |
| `hub.js`    | rebuild-on-run, board colours, clock and remaining-time meter |
| `tick.js`   | details auto-opening, and ticking a checklist item through to Trello |

`real-events.json` is a snapshot of one real calendar day, used to test against
a genuinely packed schedule rather than a tidy fixture.

Note: the container clock is UTC. Contexts pin `timezoneId: "Asia/Jerusalem"`
because the 09:00–20:00 scheduling window is local-time dependent.
