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
};

const args = process.argv.slice(2);
const flag2 = (f) => { const i = args.indexOf(f); return i < 0 ? null : args.splice(i, 2)[1] ?? true; };
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
  const page = await browser.newPage({ viewport: wide ? { width: 1200, height: 900 } : { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
  await page.addInitScript((s) => { window.__FAKE = s; }, scenario);
  await page.route(ORIGIN + "/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\//, "") || "index.html";
    if (rel === ".netlify/functions/daisey-now-calendar") return route.fulfill({ status: calReply.status, contentType: "application/json", body: JSON.stringify(calReply.body) });
    if (FAKES[rel]) return route.fulfill({ contentType: "text/javascript", body: FAKES[rel] });
    const file = path.join(APP, rel);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ path: file });
  });
  await page.goto(ORIGIN + "/");
  await page.waitForSelector(".now-card, .focus, .now-empty, .tk-empty");
  await page.waitForTimeout(150);
  const typed = flag2("--type"); // text to put in the capture bar, then Enter
  if (typed) { await page.fill(".cap-input", typed); await page.press(".cap-input", "Enter"); await page.waitForTimeout(150); }
  for (const sel of clicks) { await page.click(sel); await page.waitForTimeout(150); }
  if (tasksTab) { await page.evaluate(() => { const b = document.querySelector("#board"); b.scrollLeft = b.scrollWidth; }); await page.waitForTimeout(100); }
  if (args.includes("--text")) console.log(await page.innerText("body"));
  if (args.includes("--tasks-dump")) console.log(await page.evaluate(() => window.__store.tasks.map((t) => t.title + ": " + t.status + (t.skipCount ? " skips " + t.skipCount : "")).join(" | ")));
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${name}${tasksTab ? "-tasks" : ""}${cal ? "-cal" + cal.replace(/\W/g, "") : ""}${running ? "-run" + running.replace(/\W/g, "") : ""}${clicks.length ? "-" + clicks.join("").replace(/\W/g, "").slice(0, 24) : ""}${wide ? "-wide" : ""}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
