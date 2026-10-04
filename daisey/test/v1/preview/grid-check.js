/* Drives the real Schedule grid (daisey/app) in Chromium and checks that it
   draws the day to scale and that dragging a block writes what it should.
   Same fakes as preview.js beside it; needs playwright from daisey/test/
   (npm install there once).

     node daisey/test/v1/preview/grid-check.js

   Prints one ok/FAIL line per check and exits non-zero if any failed. It is
   the only cover the grid has: the geometry (a block's height IS its length,
   its top IS its start), the drag gestures, tap-empty-grid-to-create, and
   double-tap-to-rename can't be exercised by preview.js's --click. Run it
   after touching schedule.js, the .sch-* CSS, or calendar.js's retime(). */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..", ".."); // daisey/
const { chromium } = require(path.join(ROOT, "test", "node_modules", "playwright"));
const APP = path.join(ROOT, "app");
const ORIGIN = "http://daisey.preview";

const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

let events = [
  { id: "e1", calendarId: "primary", editable: true, allDay: false, busy: true, title: "Studio session", start: at(16), end: at(18), color: "#e67c73" },
  { id: "e2", calendarId: "primary", editable: true, allDay: false, busy: true, title: "Call with Uri", start: at(16, 30), end: at(17), color: "#33b679" },
  { id: "e3", calendarId: "primary", editable: false, allDay: false, busy: true, title: "Standup", start: at(9), end: at(9, 15), color: "#7986cb" },
];
const writes = [];

const FAKES = {
  "js/config.js": "export const configured = true;",
  "js/firebase.js": `const user = { uid: "u1", email: "mor@example.com", displayName: "Mor" };
    export const onUser = (cb) => setTimeout(() => cb(user)); export const currentUid = () => "u1";
    export const signIn = async () => {}; export const signOut = () => {}; export const idToken = async () => "fake";`,
  "js/store.js": fs.readFileSync(path.join(__dirname, "fake-store.js"), "utf8"),
};

const results = [];
const check = (name, pass, got) => { results.push({ pass }); console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : "  → " + got}`); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
  const d = new Date(); d.setHours(10, 30, 0, 0);
  await page.clock.install({ time: d });
  await page.addInitScript((s) => { window.__FAKE = s; }, { tasks: [{ title: "Send invoice", project: "Admin", size: 5 }] });
  await page.route(ORIGIN + "/**", async (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\//, "") || "index.html";
    if (rel === ".netlify/functions/daisey-now-calendar-write") {
      const body = route.request().postDataJSON();
      writes.push(body);
      const ev = events.find((e) => e.id === body.eventId); // behave like the real thing: apply it
      if (ev && body.action === "move") { ev.start = body.start; ev.end = body.end; }
      if (ev && body.action === "rename") ev.title = body.title;
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    if (rel === ".netlify/functions/daisey-now-calendar") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events }) });
    if (rel === ".netlify/functions/daisey-now-trello") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    if (FAKES[rel]) return route.fulfill({ contentType: "text/javascript", body: FAKES[rel] });
    const file = path.join(APP, rel);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ path: file });
  });
  await page.goto(ORIGIN + "/");
  await page.waitForSelector(".now-card, .now-empty, .tk-empty");
  await page.click("#tabSchedule");
  await page.waitForSelector(".sch-block");
  const day = page.locator(".sch-day").first();
  const studio = day.locator(".sch-block", { hasText: "Studio session" });
  const call = day.locator(".sch-block", { hasText: "Call with Uri" });
  const standup = day.locator(".sch-block", { hasText: "Standup" });

  // ---- geometry: the grid has to be true, or none of the rest means anything.
  let box = await studio.boundingBox();
  check("a 2-hour block is 120px tall (one pixel a minute)", Math.round(box.height) === 120, `${box.height}px`);
  const gap = (await call.boundingBox()).y - box.y;
  check("a block starting 30 min later sits 30px lower", Math.round(gap) === 30, `${gap}px`);
  const short = await standup.boundingBox();
  check("a 15-min block is floored to a readable height", short.height >= 18 && short.height <= 20, `${short.height}px`);
  const lanesW = (await day.locator(".sch-lanes").boundingBox()).width;
  check("overlapping blocks share the width", (await call.boundingBox()).width <= lanesW * 0.6 && box.width <= lanesW * 0.6,
    `${(await call.boundingBox()).width} and ${box.width} of ${lanesW}`);
  check("an hour line is drawn for each hour", await day.locator(".sch-hour").count() >= 12,
    String(await day.locator(".sch-hour").count()));
  check("the now line is on the grid", await day.locator(".sch-nowline").count() === 1, "missing");
  check("a free gap is empty space, not a row", await day.locator(".sch-gap").count() === 0, "a gap row is still rendered");

  // ---- drag the block body: the whole thing moves.
  // The grid is taller than the panel, so a block has to be brought into view
  // before its own coordinates mean anything to the mouse.
  const drag = async (locator, dy, from = "center") => {
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    const y = from === "center" ? b.y + b.height / 2 : from === "top" ? b.y + 3 : b.y + b.height - 3;
    await page.mouse.move(b.x + b.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, y + dy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  };
  await drag(studio, 30);
  let w = writes.at(-1);
  check("drag the block: moves both ends by exactly the pixels dragged",
    w && w.action === "move" && hhmm(w.start) === "16:30" && hhmm(w.end) === "18:30", w && `${hhmm(w.start)}–${hhmm(w.end)}`);
  check("the change can be undone", await page.locator(".sch-undo").count() === 1, "no undo offered");

  // ---- the edges only resize once the block is open (a tap must not be eaten).
  await page.mouse.move(2, 2); // off every block: a mouse resting on one is allowed its edges
  check("a closed block's edges take no pointer events",
    await studio.locator(".sch-edge.top").evaluate((el) => getComputedStyle(el).pointerEvents) === "none",
    await studio.locator(".sch-edge.top").evaluate((el) => getComputedStyle(el).pointerEvents));
  await studio.click();
  await page.waitForTimeout(250);
  check("a tap opens the bar", await page.locator(".sch-bar").count() === 1, `${await page.locator(".sch-bar").count()} bar(s)`);
  check("an open block's edges are live",
    await studio.locator(".sch-edge.top").evaluate((el) => getComputedStyle(el).pointerEvents) === "auto",
    await studio.locator(".sch-edge.top").evaluate((el) => getComputedStyle(el).pointerEvents));
  await drag(studio, 15, "bottom");
  w = writes.at(-1);
  check("drag the bottom edge: only the end moves", w && hhmm(w.start) === "16:30" && hhmm(w.end) === "18:45",
    w && `${hhmm(w.start)}–${hhmm(w.end)}`);
  await drag(studio, -15, "top");
  w = writes.at(-1);
  check("drag the top edge: only the start moves", w && hhmm(w.start) === "16:15" && hhmm(w.end) === "18:45",
    w && `${hhmm(w.start)}–${hhmm(w.end)}`);

  // ---- a drag that ends where it began is not a change.
  const before = writes.length;
  await studio.scrollIntoViewIfNeeded();
  const b = await studio.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 40, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("a drag back to where it started writes nothing", writes.length === before, `${writes.length - before} write(s)`);

  // ---- double-tap renames.
  await studio.click();
  await studio.click({ delay: 60 });
  await page.waitForTimeout(250);
  check("double-tap opens the rename field", await page.locator(".sch-rename").count() === 1,
    `${await page.locator(".sch-rename").count()} field(s)`);
  await page.fill(".sch-rename", "Mix night");
  await page.press(".sch-rename", "Enter");
  await page.waitForTimeout(400);
  w = writes.at(-1);
  check("Enter writes the new name", w && w.action === "rename" && w.title === "Mix night", w && JSON.stringify(w));

  // ---- tapping empty grid starts an event in that slot.
  await day.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(100);
  const lanes = day.locator(".sch-lanes");
  const lb = await lanes.boundingBox();
  const grid = await day.locator(".sch-hour").first().boundingBox(); // the first hour line = the window's start
  await page.mouse.click(lb.x + lb.width / 2, grid.y + 127); // 127 min past the window's start
  await page.waitForTimeout(250);
  const evOpen = await page.locator("#eventdlg[open]").count();
  const slot = evOpen ? await page.locator('#eventdlg input[type="time"]').inputValue() : "";
  check("tapping empty grid opens a new event at that slot, snapped to the quarter",
    evOpen === 1 && /:(00|15|30|45)$/.test(slot), evOpen ? slot : "the dialog didn't open");

  await page.screenshot({ path: path.join(require("os").tmpdir(), "daisey-grid-check.png"), fullPage: true });
  await browser.close();
  const bad = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
