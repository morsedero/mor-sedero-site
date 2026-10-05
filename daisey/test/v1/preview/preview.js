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

const SCENARIOS = {
  en: { tasks: [
    { title: "Mix review for Reprise", project: "Reprise", size: 90, due: day(2) },
    { title: "Send invoice to Uri", project: "Admin", size: 5, due: day(0) },
    { title: "Fix the boss loop", project: "Monster Punk", size: 60, over: ago(6) },
    { title: "Lesson prep", project: "Teaching", size: 30, due: day(4) },
  ] },
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
    { title: "לבחור שירים לחופה", project: "חתונה", size: 30, type: "deep", energy: "medium" },
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
  // Nothing active: only waiting and Someday (the calm empty state).
  rest: { tasks: [
    { title: "Waiting on Yuval", project: "Reprise", size: 30, over: { status: "waiting", waitingOn: "Yuval" } },
    { title: "ביטוח לחיות", project: "סידורים", size: 15, over: { status: "someday", stakes: "money", area: "admin" } },
    { title: "Send Sofi the photos", project: "Inbox", size: 15, over: { status: "someday", stakes: "someone" } },
    { title: "לתלות מסך", project: "Home", size: 30, over: { status: "someday", area: "home" } },
    { title: "Learn Wwise", project: "Inbox", size: 60, over: { status: "someday" } },
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
const evalJs = flag("--eval"); // run this in the page at the end and print what it returns
const holdSel = flag("--hold"); // press and hold it for 1.5 s (Hold to finish)
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
  const page = await browser.newPage({ viewport: wide ? { width: 1200, height: 900 } : { width: Number(widthFlag) || 390, height: 844 }, deviceScaleFactor: 2,
    colorScheme: args.includes("--dark") ? "dark" : "light" });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
  // --at HH:MM: the page's clock, today at that time (Playwright's fake clock).
  const atFlag = flag("--at");
  if (atFlag) { const [hh, mm] = atFlag.split(":").map(Number); const d = new Date(); d.setHours(hh, mm || 0, 0, 0); await page.clock.install({ time: d }); }
  // --ask-deadlines: settings as before the one-time deadline question.
  await page.addInitScript((s) => { window.__FAKE = s; }, args.includes("--ask-deadlines") ? { ...scenario, settings: {} } : scenario);
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
    if (rel === ".netlify/functions/daisey-now-calendar-write") return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    if (rel === ".netlify/functions/daisey-now-calendar") return route.fulfill({ status: calReply.status, contentType: "application/json", body: JSON.stringify(calReply.body) });
    if (FAKES[rel]) return route.fulfill({ contentType: "text/javascript", body: FAKES[rel] });
    const file = path.join(APP, rel);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ path: file });
  });
  await page.goto(ORIGIN + "/");
  await page.waitForSelector(".now-card, .focus, .now-empty, .tk-empty");
  await page.waitForTimeout(150);
  for (const sel of clicks) {
    // "sel=text" types into a field instead of clicking it.
    const eq = sel.indexOf("=");
    if (eq > 0 && !sel.startsWith("[")) await page.fill(sel.slice(0, eq), sel.slice(eq + 1)); else await page.click(sel, { force: true }); // force: the hero breathes, so it is never "stable"
    await page.waitForTimeout(150);
  }
  // --hold "sel": press and hold it for 1.5 s (Hold to finish).
  if (holdSel) { const b = await page.locator(holdSel).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.waitForTimeout(1500); await page.mouse.up(); await page.waitForTimeout(700); }
  if (tasksTab) { await page.click("#tabTasks"); await page.waitForTimeout(150); }
  if (evalJs) console.log("eval:", JSON.stringify(await page.evaluate(evalJs)));
  if (args.includes("--text")) console.log(await page.innerText("body"));
  if (args.includes("--json-dump")) console.log(JSON.stringify(await page.evaluate(() => window.__store.tasks.map(({ title, area, type, where, openHours, size, stakes, energy, due, dateKind, guessed, spentMinutes, stopsUnfinished }) => ({ title, area, type, where, openHours, size, stakes, energy, due, dateKind, guessed, spentMinutes, stopsUnfinished })))));
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
