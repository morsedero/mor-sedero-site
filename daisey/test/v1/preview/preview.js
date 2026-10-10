#!/usr/bin/env node
/* Screenshots the v1 app (daisey/app/) with no Firebase: config.js,
   firebase.js and store.js are swapped for fakes, tasks come from a scenario
   below. Everything else is the real app code.

     node daisey/test/v1/preview/preview.js [scenario] [--wide] [--tasks] [--cal spec] [--tasks-dump] [--run "title:minutes"] [--out dir] [--click "sel" ...]

   Writes <out>/<scenario>[-tasks][-wide].png and prints the path. Needs
   playwright from daisey/test/ (npm install there once). */
const fs = require("fs");
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "..", "node_modules", "playwright"));

const APP = path.join(__dirname, "..", "..", "..", "app");
const ORIGIN = "http://daisey.preview";
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.toLocaleDateString("en-CA"); };
const ago = (days) => ({ touchedAt: Date.now() - days * 864e5 });

// Last touched this many minutes ago (miss.js counts from it). Run inside the day hours.
const missTasks = (ago) => [
  { title: "Mix review for Reprise", project: "Reprise", size: 60, due: day(0), over: { touchedAt: Date.now() - ago * 60000 } },
  { title: "Send invoice to Uri", project: "Admin", size: 15, due: day(0), over: { touchedAt: Date.now() - ago * 60000 } },
];
const SCENARIOS = {
  // A missed slot (--cal none): nothing done for 25 minutes.
  miss: { tasks: missTasks(25), dayplan: { date: day(0), status: "dismissed", items: [] } },
  // Two slots ignored (--cal none): nothing done for 75 minutes.
  silence: { tasks: missTasks(75), dayplan: { date: day(0), status: "dismissed", items: [] } },
  en: { tasks: [
    { title: "Mix review for Reprise", project: "Reprise", size: 90, due: day(2) },
    { title: "Send invoice to Uri", project: "Admin", size: 5, due: day(0) },
    { title: "Fix the boss loop", project: "Monster Punk", size: 60, over: ago(6) },
    { title: "Lesson prep", project: "Teaching", size: 30, due: day(4) },
  ] },
  // Up past midnight on a day stretched to 01:00 (Tell "until 1am", said
  // yesterday): run with --at 00:30 (day still on) or --at 01:30 (night).
  latenight: { tasks: [
    { title: "Mix review for Reprise", project: "Reprise", size: 20, due: day(2) },
    { title: "Send invoice to Uri", project: "Admin", size: 5, due: day(0) },
  ], settings: { deadlinesAsked: true, dayEndToday: { date: day(-1), end: "01:00" } } },
  // Passed dates: 4 deadlines (over the sweep's 3) and 2 targets.
  old: { tasks: [
    { title: "Submit grant report", project: "Admin", size: 60, due: day(-5), dateKind: "deadline" },
    { title: "Pay arnona", project: "Home", size: 15, due: day(-3), dateKind: "deadline" },
    { title: "להגיש טופס 106", project: "מסים", size: 30, due: day(-2), dateKind: "deadline" },
    { title: "Call the bank", project: "Admin", size: 15, due: day(-1), dateKind: "deadline" },
    { title: "Sketch boss theme", project: "Monster Punk", size: 90, due: day(-4) },
    { title: "Tidy sample library", project: "Studio", size: 30, due: day(-6) },
    { title: "Lesson prep", project: "Teaching", size: 30, due: day(2) },
    { title: "Learn Wwise", project: "Job search", size: 60, over: { status: "someday" } },
    { title: "Send CV to Ubisoft", project: "Job search", size: 30, over: { status: "done", doneAt: Date.now() } },
    { title: "Pay water bill", project: "Home", size: 15, over: { status: "done", doneAt: Date.now() } },
  ] },
  // Learning: one task skipped five times (asks keep/shrink/drop), one stopped twice (asks shrink).
  learn: { tasks: [
    { title: "Read the grant guidelines", project: "Admin", size: 90, over: { skipsSinceStart: 5 } },
    { title: "Mix the trailer", project: "Reprise", size: 60, over: { stopsUnfinished: 2, touchedAt: Date.now() } },
  ] },
  // Mixed directions inside one line: Hebrew task in an English project
  // and the reverse, with names (project, person) inside the why line.
  mixed: { tasks: [
    { title: "לשלוח את הסטמס ל-Yuval", project: "Reprise", size: 15, stakes: "someone", over: { starts: 1, touchedAt: Date.now() } },
    { title: "Send the playlist to Sofi", project: "חתונה", size: 15, due: day(0), dateKind: "deadline", over: { starts: 1, touchedAt: Date.now() - 864e5 } },
    { title: "Book the DJ", project: "חתונה", size: 15, type: "admin" },
    { title: "לבחור שירים לחופה", project: "חתונה", size: 30, type: "deep" },
  ] },
  // Three quick admin tasks that fit an hour together: the batch offer.
  batch: { tasks: [
    { title: "Send invoice to Uri", project: "Admin", size: 15, type: "admin", stakes: "money" },
    { title: "Reply to the venue", project: "Reprise", size: 5, type: "admin" },
    { title: "Renew the domain", project: "Admin", size: 15, type: "admin" },
    { title: "Fix the boss loop", project: "Monster Punk", size: 60 },
  ] },
  bidi: { tasks: [
    { title: "להזמין צלם", project: "Wedding", size: 5, due: day(0) },
    { title: "Book the DJ", project: "חתונה", size: 15, due: day(1) },
    { title: "Mix review", project: "חתונה", size: 90, over: ago(3) },
  ] },
  empty: { tasks: [] },
  // 2026-10-06 fixes: a deadline parked in Not now, a task put off five
  // times (both Needs you), a deadline due today (night mode names it).
  fixes: { tasks: [
    { title: "Pay arnona", project: "Home", size: 15, due: day(2), dateKind: "deadline", over: { status: "someday" } },
    { title: "Read the grant guidelines", project: "Admin", size: 90, over: { skipsSinceStart: 5 } },
    { title: "Submit the form", project: "Admin", size: 30, due: day(0), dateKind: "deadline" },
    { title: "Fix the boss loop", project: "Monster Punk", size: 60 },
  ] },
  // Layout round 2: steps and links on the card's task, a Pending task past
  // its check date and a Someday one (Needs you), a done one (progress).
  round2: { tasks: [
    { title: "Sfx deep work", project: "monster punk", size: 60, area: "work", due: day(4), dateKind: "deadline",
      steps: [{ text: "Bounce the stems", done: true }, { text: "Layer the impacts", done: false }, { text: "Send to Yuval", done: false }],
      links: [{ url: "https://drive.google.com/file/d/x/cue-sheet.pdf" }], over: { starts: 2, spentMinutes: 100 } },
    { title: "Pre-attack cue", project: "monster punk", size: 30, area: "work", over: { status: "waiting", waitingOn: "Yuval", checkOn: day(-1) } },
    { title: "Boss intro sting", project: "monster punk", size: 30, area: "work", over: { status: "done", doneAt: Date.now() - 864e5 } },
    { title: "ביטוח לחיות", project: "סידורים", size: 15, area: "admin", over: { status: "someday", stakes: "money" } },
  ] },
  // One project with every kind: ready, Pending, done, Not now (the
  // project screen's one list + its Done / Not now drawers).
  project: { tasks: [
    { title: "Boss smashes", project: "Monster Punk", size: 180, area: "work", due: day(3), dateKind: "deadline",
      steps: [{ text: "Bounce", done: true }, { text: "Layer", done: false }] },
    { title: "Combat SFX pass", project: "Monster Punk", size: 30, area: "work", due: day(6), dateKind: "deadline" },
    { title: "Send stems to QA", project: "Monster Punk", size: 15, area: "work", due: day(-1), dateKind: "deadline" },
    { title: "Boss intro sting", project: "Monster Punk", size: 30, area: "work", notBefore: day(2), due: day(4), dateKind: "deadline" },
    { title: "Credits list", project: "Monster Punk", size: 15, area: "work", due: day(20), dateKind: "deadline" },
    // Enough done and parked for two-digit counts: the toggles stay one row.
    ...Array.from({ length: 12 }, (_, i) => ({ title: `Old cue ${i + 1}`, project: "Monster Punk", size: 15, area: "work", over: { status: "done", doneAt: Date.now() - (i + 3) * 864e5 } })),
    ...Array.from({ length: 11 }, (_, i) => ({ title: `Idea ${i + 1}`, project: "Monster Punk", size: 15, area: "work", over: { status: "someday" } })),
    { title: "Pre-attack cue notes", project: "Monster Punk", size: 15, area: "work", over: { status: "waiting", waitingOn: "Yuval", checkOn: day(2) } },
    { title: "Unicycle enemy batch", project: "Monster Punk", size: 60, area: "work", over: { status: "done", doneAt: Date.now() - 864e5 } },
    { title: "Fix boost-bus leak", project: "Monster Punk", size: 30, area: "work", over: { status: "done", doneAt: Date.now() - 2 * 864e5 } },
    { title: "Alt menu music", project: "Monster Punk", size: 90, area: "work", over: { status: "someday" } },
  ], settings: { deadlinesAsked: true, somedayAsked: new Date().toLocaleDateString("en-CA") } },
  // Two active, three parked: the Someday pick shows under the card.
  someday: { tasks: [
    { title: "Send invoice to Uri", project: "Admin", size: 15 },
    { title: "Mix review", project: "Reprise", size: 60 },
    { title: "Learn Wwise", project: "Skills", size: 90, over: { status: "someday" } },
    { title: "Renew the domain", project: "Admin", size: 15, stakes: "money", over: { status: "someday" } },
    { title: "Send Sofi the photos", project: "Home", size: 15, stakes: "someone", over: { status: "someday" } },
  ] },
  // One task, nothing else active, Someday holds one: Switch offers it.
  lonely: { tasks: [
    { title: "Mix review", project: "Reprise", size: 60 },
    { title: "Learn Wwise", project: "Skills", size: 90, over: { status: "someday" } },
  ], settings: { deadlinesAsked: true, somedayAsked: new Date().toLocaleDateString("en-CA") } },
  // A task with a calendar slot later today (use with --cal "120:Mix review").
  booked: { tasks: [{ title: "Mix review", project: "Reprise", size: 60 },
    { title: "Call the bank", project: "Admin", size: 15, type: "call", openHours: "office" }] },
  one: { tasks: [{ title: "Send invoice to Uri", project: "Admin", size: 5, due: day(0) }] },
  // A weekly job in Ashkelon, answered "train" (trips.js; use with --cal trip).
  // --at 22:00 for the night card, --at 06:30 for the ride, no answer: tripask.
  trip: { tasks: [{ title: "להתאמן להופעות", project: "BOBBA", size: 30 },
    { title: "Mix review for Reprise", project: "Reprise", size: 45, where: "computer" },
    { title: "Laundry", project: "Home", size: 20, where: "home" }],
  settings: { deadlinesAsked: true, somedayAsked: new Date().toLocaleDateString("en-CA"), laptop: true, trips: { "s:ash": { city: "Ashkelon", mode: "train", min: { train: 110, bus: 125, car: 80 } } } } },
  tripask: { tasks: [{ title: "Send invoice to Uri", project: "Admin", size: 5 }], settings: { deadlinesAsked: true, somedayAsked: new Date().toLocaleDateString("en-CA") } },
  long: { tasks: [
    { title: "Follow up with the production company about the revised cue sheet and the delivery deadline", project: "Reprise Productions International", size: 90 },
    { title: "x", project: "A", size: 5 },
  ] },
  many: { tasks: Array.from({ length: 9 }, (_, i) => ({ title: `Task ${i + 1}`, project: `Project ${i + 1}`, size: 30 })) },
  notyet: { tasks: [
    { title: "Master the EP", project: "Reprise", size: 60, notBefore: (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toLocaleDateString("en-CA"); })(),
      notes: "Waiting on the final mixes from Yuval." },
    { title: "Send invoice to Uri", project: "Admin", size: 5 },
  ] },
  // An approved plan an event added since squeezes (use with --cal squeeze --at 10:00):
  // Daisey cuts what matters least and says so under the card (proposal.refit).
  squeeze: { tasks: [
    { title: "למלא טופס לרואה חשבון", project: "סידורים", size: 15, due: day(0), dateKind: "deadline" },
    { title: "Mix review for Reprise", project: "Reprise", size: 90, due: day(3) },
    { title: "Lesson prep", project: "Teaching", size: 60, due: day(0) },
    { title: "Tidy sample library", project: "Studio", size: 120 },
    { title: "Fix the boss loop", project: "Monster Punk", size: 180 },
  ], dayplan: { date: day(0), status: "approved", at: (() => { const d = new Date(); d.setHours(8, 30, 0, 0); return d.getTime(); })(),
    items: [{ taskId: "t2", minutes: 90 }, { taskId: "t4", minutes: 120 }, { taskId: "t1", minutes: 15 }, { taskId: "t5", minutes: 180 }, { taskId: "t3", minutes: 60 }] } },
  // Same, with the deadline too big to fit: the note asks about its date.
  get "squeeze-due"(){ const s = structuredClone(SCENARIOS.squeeze); s.tasks[0].size = 400; s.dayplan.items[2].minutes = 400; return s; },
  // An approved plan laid against a busier day (sig "was"), now an empty
  // calendar (--cal none --at 10:00 --clock-run 61000): a minute later Daisey
  // adds what fits on the end and says so (proposal.topUp).
  openup: { tasks: [
    { title: "Mix review for Reprise", project: "Reprise", size: 60, due: day(0) },
    { title: "Lesson prep", project: "Teaching", size: 45, due: day(0) },
    { title: "Send invoice to Uri", project: "Admin", size: 15, due: day(1) },
  ], dayplan: { date: day(0), status: "approved", sig: "was", items: [{ taskId: "t1", minutes: 60 }] } },
  // The day ends 11:30 with one task planned (--cal none --at 10:00); --eval
  // moves the end to 22:00 as Settings would, and the plan should grow at
  // once, no minute's wait (2026-10-09).
  get hours(){ const s = structuredClone(SCENARIOS.openup); delete s.dayplan.sig;
    s.settings = { deadlinesAsked: true, somedayAsked: day(0), dayStart: "08:00", dayEnd: "11:30" }; return s; },
  // A planned break running: the first task done 3 min ago, a 10 min break
  // next, then the second (--cal none, real clock): the card is the break.
  planbreak: { tasks: [
    { title: "Mix review for Reprise", project: "Reprise", size: 60, over: { status: "done", doneAt: Date.now() - 3 * 60000 } },
    { title: "Lesson prep", project: "Teaching", size: 45 },
  ], dayplan: { date: day(0), status: "approved", items: [{ taskId: "t1", minutes: 60 }, { brk: "short", minutes: 10 }, { taskId: "t2", minutes: 45 }] } },
  // An approved plan of three (--cal none): Switch to the third moves it
  // in front of the first in the plan, not just on the card (2026-10-10).
  switchplan: { tasks: [
    { title: "Mix review for Reprise", project: "Reprise", size: 60 },
    { title: "Send invoice to Uri", project: "Admin", size: 5 },
    { title: "Lesson prep", project: "Teaching", size: 30 },
  ], dayplan: { date: day(0), status: "approved", items: [{ taskId: "t1", minutes: 60 }, { taskId: "t2", minutes: 5 }, { taskId: "t3", minutes: 30 }] } },
  // The same, approved 40 min ago with nothing touched since, so the plan is
  // laid from then: a Switch must lay it from now, not drop the picked task
  // into the past slot as "didn't happen" (2026-10-10).
  get switchlate(){ const s = structuredClone(SCENARIOS.switchplan), ago = Date.now() - 40 * 60000;
    for (const t of s.tasks) t.over = { touchedAt: ago, createdAt: ago }; s.dayplan.approvedAt = ago; return s; },
  // An approved plan whose first task's whole time passed untouched (missed,
  // "?"): the card must show the task that's on Now, not the missed one
  // "until" a time already gone (2026-10-10).
  get missedhead(){ const s = structuredClone(SCENARIOS.switchlate);
    s.dayplan.items = [{ taskId: "t3", minutes: 30 }, { taskId: "t1", minutes: 60 }, { taskId: "t2", minutes: 5 }]; return s; },
  // Nothing active: only waiting and Someday (the calm empty state).
  rest: { tasks: [
    { title: "Waiting on Yuval", project: "Reprise", size: 30, over: { status: "waiting", waitingOn: "Yuval" } },
    { title: "ביטוח לחיות", project: "סידורים", size: 15, over: { status: "someday", stakes: "money", area: "admin" } },
    { title: "Send Sofi the photos", project: "Inbox", size: 15, over: { status: "someday", stakes: "someone" } },
    { title: "לתלות מסך", project: "Home", size: 30, over: { status: "someday", area: "home" } },
    { title: "Learn Wwise", project: "Inbox", size: 60, over: { status: "someday" } },
  ] },
  // Routines (routine.js): Exercise 3× a week with nothing done yet, and band
  // practice 2× a week until the show.
  routine: { tasks: [
    { title: "Exercise", project: "Health", size: 45, routine: { per: 3 } },
    { title: "Band practice", project: "Band", size: 60, routine: { per: 2, until: day(30), log: [{ day: day(-30), min: 60 }] } },
    { title: "Mix review", project: "Reprise", size: 60 },
  ] },
  // Bloom (bloom.js): projects in all three tiers, two routines, a week of work.
  bloom: { tiers: { Band: "focus", Reprise: "focus", Admin: "background" }, bloomLog: true, tasks: [
    { title: "Mix chorus", project: "Band", size: 60 },
    { title: "Master the EP", project: "Reprise", size: 120 },
    { title: "Send invoice", project: "Admin", size: 15 },
    { title: "Fix the sink", project: "Home", size: 30 },
    { title: "Portfolio page", project: "Work", size: 60 },
    { title: "Exercise", project: "Health", size: 45, routine: { per: 3, log: [{ day: day(-14) }, { day: day(-13) }, { day: day(-12) }, { day: day(-7) }, { day: day(-6) }, { day: day(-5) }, { day: day(-1), min: 45 }] } },
    { title: "Band practice", project: "Band", size: 60, routine: { per: 2, days: [1, 4], at: "19:00", log: [{ day: day(-2), min: 60 }] } },
  ] },
  waiting: { tasks: [
    { title: "Waiting on Yuval", project: "Reprise", size: 30, over: { status: "waiting", waitingOn: "Yuval" } },
    { title: "Big edit", project: "Reprise", size: 240 },
  ] },
};

const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i < 0 ? null : args.splice(i, 2)[1] ?? true; };
const outDir = flag("--out") || path.join(require("os").tmpdir(), "daisey-preview");
const clicks = [];
const widthFlag = flag("--width"); // phone width in CSS px (default 390)
const heightFlag = flag("--height"); // phone height in CSS px (default 844)
const query = flag("--query") || ""; // e.g. "?open=wrap": what a notification tap opens
const evalJs = flag("--eval"); // run this in the page at the end and print what it returns
const holdSel = flag("--hold");
const chatFlag = flag("--chat"); // "off": Tell Daisey answers as if no Gemini key were set // press and hold it for 1.5 s (Hold to finish)
const clockRun = flag("--clock-run"); // with --at: run the fake clock this many ms after load
const speedFlag = flag("--speed"); // fake GPS reporting this speed in m/s (where.js): 1.5 walk, 15 a ride
for (let c; (c = flag("--click"));) clicks.push(c);
const wide = args.includes("--wide"), tasksTab = args.includes("--tasks");
const name = args.find((a) => !a.startsWith("--")) || "en";
const scenario = SCENARIOS[name] || (() => { throw new Error("no scenario " + name); })();
// --cal: "none" (connected, empty), "reauth", or "<min>:<title>" — an hour-long
// event starting in <min> minutes (negative = already running). Omitted → not connected.
const running = flag("--run"); // "<task title>:<minutes elapsed>"
if (running) { const [task, m] = running.split(":"); scenario.run = { task, minutes: Number(m || 0) }; }
const cal = flag("--cal");
const calReply = !cal ? { status: 404, body: { error: "not_connected" } }
  : cal === "reauth" ? { status: 409, body: { error: "needs_reauth" } }
  : cal === "none" ? { status: 200, body: { events: [] } }
  : cal === "squeeze" ? { status: 200, body: { events: (() => {
      const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
      return [{ id: "e0", calendarId: "primary", editable: true, title: "עבודה על Daisey", start: at(9), end: at(15), busy: true, updated: at(9, 45) },
        { id: "e1", calendarId: "primary", editable: true, title: "BOBBA", start: at(15), end: at(19), busy: true, updated: at(7) }];
    })() } }
  : cal === "trip" ? { status: 200, body: { events: [0, 1].map((n) => {
      const at = (h) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
      return { id: "ash" + n, series: "ash", recurring: true, calendarId: "primary", editable: true, title: "מחוננים אשקלון", start: at(8), end: at(13), busy: true };
    }) } }
  : cal === "day" ? { status: 200, body: { events: (() => {
      const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
      const tm = (h) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d.toISOString(); };
      const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
      return [
        { title: "ILLUSTRATION WEEK", start: day(0), end: day(1), allDay: true, busy: false, color: "#7986cb" },
        { title: "Standup", start: at(9), end: at(9, 15), allDay: false, busy: true, color: "#33b679" },
        { title: "שיעור גיטרה", start: at(13), end: at(14, 30), allDay: false, busy: true, color: "#f6bf26" },
        { title: "Studio session", start: at(16), end: at(18), allDay: false, busy: true, color: "#e67c73" },
        { title: "Rehearsal", start: tm(10), end: tm(12), allDay: false, busy: true },
        { title: "Mix delivery", start: tm(15), end: tm(16), allDay: false, busy: true },
        ...[2, 3, 5].map((n) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(11, 0, 0, 0);
          return { title: `Day ${n} meeting`, start: d.toISOString(), end: new Date(d.getTime() + 36e5).toISOString(), allDay: false, busy: true }; }),
      ];
    })().map((e, i) => ({ id: "e" + i, calendarId: "primary", editable: !e.allDay, ...e })) } }
  : (() => { const [m, title = "Teaching"] = cal.split(":"); const start = Date.now() + Number(m) * 60000;
    return { status: 200, body: { events: [{ id: "e0", calendarId: "primary", editable: true, title, start: new Date(start).toISOString(), end: new Date(start + 3600000).toISOString() }] } }; })();

const FAKES = {
  "js/config.js": "export const configured = true;",
  "js/firebase.js": `const user = { uid: "u1", email: "mor@example.com", displayName: "Mor" };
    export const onUser = (cb) => setTimeout(() => cb(user)); export const currentUid = () => "u1";
    export const signIn = async () => {}; export const signOut = () => {}; export const idToken = async () => "fake";`,
  "js/store.js": fs.readFileSync(path.join(__dirname, "fake-store.js"), "utf8"),
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: wide ? { width: 1200, height: 900 } : { width: Number(widthFlag) || 390, height: Number(heightFlag) || 844 }, deviceScaleFactor: 2,
    colorScheme: args.includes("--dark") ? "dark" : "light" });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
  // --at HH:MM: the page's clock, today at that time (Playwright's fake clock).
  const atFlag = flag("--at");
  if (atFlag) { const [hh, mm] = atFlag.split(":").map(Number); const d = new Date(); d.setHours(hh, mm || 0, 0, 0); await page.clock.install({ time: d }); }
  // --ask-deadlines: settings as before the one-time deadline question.
  await page.addInitScript((s) => { window.__FAKE = s; }, args.includes("--ask-deadlines") ? { ...scenario, settings: {} } : scenario);
  if (speedFlag) await page.addInitScript((v) => {
    const fix = () => ({ coords: { latitude: 32.08, longitude: 34.78, accuracy: 10, speed: v }, timestamp: Date.now() });
    Object.defineProperty(navigator, "geolocation", { value: {
      watchPosition: (ok) => { setTimeout(() => ok(fix()), 10); setTimeout(() => ok(fix()), 30); setTimeout(() => ok(fix()), 50); return 1; },
      clearWatch: () => {}, getCurrentPosition: (ok) => ok(fix()),
    } });
  }, Number(speedFlag));
  await page.route(ORIGIN + "/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\//, "") || "index.html";
    if (rel === ".netlify/functions/daisey-now-trello") {
      const q = new URL(route.request().url()).searchParams;
      const body = q.has("boards")
        ? { boards: [{ id: "b1", name: "Monster Punk" }, { id: "b2", name: "חתונה" }] }
        : { board: { id: "b1", name: "Monster Punk" }, lists: [{ id: "l1", name: "Doing" }, { id: "l2", name: "Backlog" }],
            cards: [{ id: "c1", name: "Fix the boss loop", listId: "l1", listName: "Doing", due: null, url: "https://trello.com/c/c1" },
                    { id: "c2", name: "Pre-attack cue", listId: "l1", listName: "Doing", due: null, url: "https://trello.com/c/c2" },
                    { id: "c3", name: "Old idea", listId: "l2", listName: "Backlog", due: null, url: "https://trello.com/c/c3" }] };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    // Tell Daisey: a canned stand-in for Gemini. "wrecked" → a moment;
    // "waiting on X" → the first task waits on X; anything else → one new
    // task per comma. --chat off answers as if no key were set.
    if (rel === ".netlify/functions/daisey-now-chat") {
      if (chatFlag === "off") return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"not_configured"}' });
      const { text = "", tasks = [] } = JSON.parse(route.request().postData() || "{}");
      const wait = /waiting on (\S+)/i.exec(text);
      const actions = /wreck|tired/i.test(text) ? [{ kind: "moment", place: "out" }]
        : wait && tasks[0] ? [{ kind: "waiting", taskId: tasks[0].id, waitingOn: wait[1] }]
        : text.split(",").map((s) => s.trim()).filter(Boolean).map((title) => ({ kind: "add", title, size: 30 }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "Got it.", actions }) });
    }
    if (rel === ".netlify/functions/daisey-now-calendar-write") return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"id":"series1"}' });
    if (rel === ".netlify/functions/daisey-now-calendar" && route.request().method() === "POST") return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    if (rel === ".netlify/functions/daisey-now-calendar" && new URL(route.request().url()).searchParams.has("list")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chosen: null, calendars: [
      { id: "me@x.com", name: "Mor", color: "#7986cb", primary: true, selected: true }, { id: "w", name: "Work", color: "#33b679", selected: true },
      { id: "f", name: "משפחה", color: "#e67c73", selected: false }, { id: "h", name: "Holidays in Israel", color: "#f6bf26", selected: false }] }) });
    if (rel === ".netlify/functions/daisey-now-calendar") return route.fulfill({ status: calReply.status, contentType: "application/json", body: JSON.stringify(calReply.body) });
    if (FAKES[rel]) return route.fulfill({ contentType: "text/javascript", body: FAKES[rel] });
    const file = path.join(APP, rel);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ path: file });
  });
  await page.goto(ORIGIN + "/" + query);
  await page.waitForSelector(".now-card, .focus, .now-empty, .tk-empty");
  // The opening daisy stays at least 900 ms (main.js splashOff): wait it out.
  await page.waitForSelector("#splash", { state: "detached", timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(150);
  if (clockRun && atFlag) { await page.clock.runFor(Number(clockRun)); await page.waitForTimeout(300); }
  for (const sel of clicks) {
    // "sel=text" types into a field instead of clicking it.
    const eq = sel.indexOf("=");
    if (eq > 0 && !sel.startsWith("[")) await page.fill(sel.slice(0, eq), sel.slice(eq + 1)); else await page.click(sel, { force: true }); // force: the hero breathes, so it is never "stable"
    await page.waitForTimeout(450); // past the sheet and card animations
  }
  // --hold "sel": press and hold it for 1.5 s (Hold to finish).
  if (holdSel) { const b = await page.locator(holdSel).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    // --hold-ms N: hold that long; --hold-keep: screenshot still holding (Done's bloom).
    const ms = Number(args[args.indexOf("--hold-ms") + 1]) || 1500;
    await page.mouse.down(); await page.waitForTimeout(args.includes("--hold-ms") ? ms : 1500);
    if (!args.includes("--hold-keep")) { await page.mouse.up(); await page.waitForTimeout(700); } }
  if (tasksTab) { await page.click("#tabTasks"); await page.waitForTimeout(150); }
  if (evalJs) console.log("eval:", JSON.stringify(await page.evaluate(evalJs)));
  if (args.includes("--text")) console.log(await page.innerText("body"));
  if (args.includes("--json-dump")) console.log(JSON.stringify(await page.evaluate(() => window.__store.tasks.map(({ title, area, type, where, openHours, size, stakes, due, dateKind, guessed, spentMinutes, stopsUnfinished }) => ({ title, area, type, where, openHours, size, stakes, energy, due, dateKind, guessed, spentMinutes, stopsUnfinished })))));
  if (args.includes("--tasks-dump")) console.log(await page.evaluate(() => window.__store.tasks.map((t) => t.title + ": " + t.status + (t.skipCount ? " skips " + t.skipCount : "") + (t.source ? " [" + t.source.app + ":" + t.source.cardId + "]" : "")).join(" | ")));
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${name}${tasksTab ? "-tasks" : ""}${cal ? "-cal" + cal.replace(/\W/g, "") : ""}${running ? "-run" + running.replace(/\W/g, "") : ""}${clicks.length ? "-" + clicks.join("").replace(/\W/g, "").slice(0, 24) : ""}${wide ? "-wide" : ""}${args.includes("--dark") ? "-dark" : ""}.png`);
  // A page wider than the phone scrolls sideways: say so.
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 0) console.log(`OVERFLOW: page is ${over}px wider than the screen`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
