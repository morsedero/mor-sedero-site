# DayFlow test harness

Drives the real `tools/dayflow.html` in Chromium against a stubbed connector
bridge that replays the request/response shapes observed from live Trello and
Google Calendar calls. No network, no real writes.

    cd tools/test && npm i playwright && node assert.js

| script | what it checks |
|---|---|
| `assert.js` | scheduling rules: no task overlaps a real event, nothing intrudes on a work-session buffer, no task-on-task overlap |
| `mini.js`   | the hub, "Not now" postponing, completion writes |
| `states.js` | midday / empty day / Friday prompt / Shabbat |
| `dead.js`   | expired auth, unreachable server, no connector |
| `det.js`    | expandable description + checklist |
| `hub.js`    | rebuild-on-run, board colours, clock and remaining-time meter |

`real-events.json` is a snapshot of one real calendar day, used to test against
a genuinely packed schedule rather than a tidy fixture.

Note: the container clock is UTC. Contexts pin `timezoneId: "Asia/Jerusalem"`
because the 09:00–20:00 scheduling window is local-time dependent.
