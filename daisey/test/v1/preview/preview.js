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
  bidi: { tasks: [
    { title: "להזמין צלם", project: "Wedding", size: 5, due: day(0) },
    { title: "Book the DJ", project: "חתונה", size: 15, due: day(1) },
    { title: "Mix review", project: "חתונה", size: 90, over: ago(3) },
  ] },
  empty: { tasks: [] },
  one: { tasks: [{ title: "Send invoice to Uri", project: "Admin", size: 5, due: day(0) }] },
  long: { tasks: [
    { title: "Follow up with the production company about the revised cue sheet and the delivery deadline", project: "Reprise Productions International", size: 90 },
    { title: "x", project: "A", size: 5 },
  ] },
  many: { tasks: Array.from({ length: 9 }, (_, i) => ({ title: `Task ${i + 1}`, project: `Project ${i + 1}`, size: 30 })) },
  waiting: { tasks: [
    { title: "Waiting on Yuval", project: "Reprise", size: 30, over: { status: "waiting", waitingOn: "Yuval" } },
    { title: "Big edit", project: "Reprise", size: 240 },
  ] },
};

const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i < 0 ? null : args.splice(i, 2)[1] ?? true; };
const outDir = flag("--out") || path.join(require("os").tmpdir(), "daisey-preview");
const clicks = [];
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
    return { status: 200, body: { events: [{ title, start: new Date(start).toISOString(), end: new Date(start + 3600000).toISOString() }] } }; })();

const FAKES = {
  "js/config.js": "export const configured = true;",
  "js/firebase.js": `const user = { uid: "u1", email: "mor@example.com", displayName: "Mor" };
    export const onUser = (cb) => setTimeout(() => cb(user)); export const currentUid = () => "u1";
    export const signIn = async () => {}; export const signOut = () => {}; export const idToken = async () => "fake";`,
  "js/store.js": fs.readFileSync(path.join(__dirname, "fake-store.js"), "utf8"),
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: wide ? { width: 1200, height: 900 } : { width: 390, height: 844 }, deviceScaleFactor: 2,
    colorScheme: args.includes("--dark") ? "dark" : "light" });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
  await page.addInitScript((s) => { window.__FAKE = s; }, scenario);
  await page.route(ORIGIN + "/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\//, "") || "index.html";
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
  for (const sel of clicks) { await page.click(sel); await page.waitForTimeout(150); }
  if (tasksTab) { await page.click("#tabTasks"); await page.waitForTimeout(150); }
  if (args.includes("--text")) console.log(await page.innerText("body"));
  if (args.includes("--tasks-dump")) console.log(await page.evaluate(() => window.__store.tasks.map((t) => t.title + ": " + t.status + (t.skipCount ? " skips " + t.skipCount : "")).join(" | ")));
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${name}${tasksTab ? "-tasks" : ""}${cal ? "-cal" + cal.replace(/\W/g, "") : ""}${running ? "-run" + running.replace(/\W/g, "") : ""}${clicks.length ? "-" + clicks.join("").replace(/\W/g, "").slice(0, 24) : ""}${wide ? "-wide" : ""}${args.includes("--dark") ? "-dark" : ""}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
