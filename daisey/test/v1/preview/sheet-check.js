/* Drives the real Schedule panel (daisey/app) in Chromium and checks the way
   an event is opened and edited: tap a row, see its details, Edit, Save,
   Remove — Google's own flow, in Daisey's sheet (addevent.js). Same fakes as
   preview.js beside it; needs playwright from daisey/test/ (npm install there
   once).

     node daisey/test/v1/preview/sheet-check.js

   Prints one ok/FAIL line per check and exits non-zero if any failed. It is
   the only cover the sheet has: none of this can be exercised by preview.js's
   --click, and every check here is a write Daisey makes to a real calendar.
   Run it after touching addevent.js, schedule.js's rows, or calendar.js. */
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
  { id: "e2", calendarId: "primary", editable: false, allDay: false, busy: true, title: "Someone else's meeting", start: at(9), end: at(9, 30), color: "#7986cb" },
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
      if (ev && body.action === "delete") events = events.filter((e) => e !== ev);
      if (body.action === "create") events = [...events, { id: "new" + writes.length, calendarId: body.calendarId, editable: true,
        title: body.title, start: body.start, end: body.end, allDay: false, busy: true }];
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
  await page.waitForSelector(".sch-row");
  const day = page.locator(".sch-day").first();
  const sheet = page.locator("#eventdlg");

  // ---- the day is a list again, not a time grid.
  check("the day is a list of rows", await day.locator(".sch-row").count() >= 2 && await day.locator(".sch-block").count() === 0,
    `${await day.locator(".sch-row").count()} rows, ${await day.locator(".sch-block").count()} blocks`);
  check("a free stretch is one line, not empty height", await day.locator(".sch-gap").count() > 0, "no gap line");
  check("nothing on a row is draggable", await day.locator(".sch-grip, .sch-edge").count() === 0, "a drag handle is still there");

  // ---- tap a row: its details, the way Google opens an event.
  await day.locator(".sch-row", { hasText: "Studio session" }).locator(".sch-open").click();
  await page.waitForTimeout(200);
  check("tapping a row opens the sheet", await sheet.evaluate((el) => el.open), "the sheet didn't open");
  check("the details show the name and the time",
    (await sheet.locator(".ev-name").textContent()).includes("Studio session") && (await sheet.locator(".ev-time").textContent()).includes("16:00"),
    await sheet.locator(".ev-detail").innerText());
  check("the details are details, not a form", await sheet.locator("form:visible").count() === 0, "a form is showing");
  check("an event of yours offers Edit and Remove", await sheet.locator(".ev-acts .btn").count() === 2,
    `${await sheet.locator(".ev-acts .btn").count()} button(s)`);

  // ---- Edit: the same sheet, filled in.
  await sheet.getByText("Edit", { exact: true }).click();
  await page.waitForTimeout(150);
  const vals = await sheet.evaluate((el) => [...el.querySelectorAll("input,select")].map((i) => i.value));
  check("Edit fills the form with the event's own values", vals.includes("16:00") && vals.includes("120"), JSON.stringify(vals));

  // ---- Save writes only what changed.
  await sheet.locator('input[type="time"]').fill("17:00");
  await sheet.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(400);
  let w = writes.at(-1);
  check("saving a new start moves the event", w && w.action === "move" && hhmm(w.start) === "17:00" && hhmm(w.end) === "19:00",
    w && `${w.action} ${hhmm(w.start)}–${hhmm(w.end)}`);
  check("the title wasn't rewritten when only the time changed", !writes.some((x) => x.action === "rename"),
    "a rename went out too");
  check("the sheet closes on save", !(await sheet.evaluate((el) => el.open)), "still open");
  check("the change can be undone", await page.locator(".toast-undo").count() === 1, "no undo offered");

  // ---- Undo puts it back.
  await page.click(".toast-undo");
  await page.waitForTimeout(400);
  w = writes.at(-1);
  check("Undo restores the old times", w && w.action === "move" && hhmm(w.start) === "16:00" && hhmm(w.end) === "18:00",
    w && `${hhmm(w.start)}–${hhmm(w.end)}`);

  // ---- renaming goes through the same Save.
  await day.locator(".sch-row", { hasText: "Studio session" }).locator(".sch-open").click();
  await page.waitForTimeout(200);
  await sheet.getByText("Edit", { exact: true }).click();
  await page.waitForTimeout(150);
  await sheet.locator('input[dir="auto"]').fill("Mix night");
  await sheet.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(400);
  w = writes.at(-1);
  check("saving a new name renames it", w && w.action === "rename" && w.title === "Mix night", w && JSON.stringify(w));
  check("the row shows the new name", await day.locator(".sch-row", { hasText: "Mix night" }).count() === 1, "the list didn't catch up");

  // ---- someone else's event opens read-only.
  await day.locator(".sch-row", { hasText: "Someone else" }).locator(".sch-open").click();
  await page.waitForTimeout(200);
  check("a read-only event offers no Edit or Remove", await sheet.locator(".ev-acts").count() === 0,
    "it offered to change someone else's event");
  await page.keyboard.press("Escape");

  // ---- Remove goes on one tap, and the toast puts it back.
  await day.locator(".sch-row", { hasText: "Mix night" }).locator(".sch-open").click();
  await page.waitForTimeout(200);
  const before = writes.length;
  await sheet.getByRole("button", { name: "Remove" }).click();
  await page.waitForTimeout(400);
  w = writes.at(-1);
  check("Remove deletes on the first tap", writes.length === before + 1 && w.action === "delete", w && JSON.stringify(w));
  check("the row is gone", await day.locator(".sch-row", { hasText: "Mix night" }).count() === 0, "the row is still listed");
  check("Remove offers an undo", await page.locator(".toast-undo").count() === 1, "no undo offered");
  await page.click(".toast-undo");
  await page.waitForTimeout(500);
  w = writes.at(-1);
  check("undoing a Remove writes it back to its own calendar",
    w.action === "create" && w.title === "Mix night" && w.calendarId === "primary", w && JSON.stringify(w));
  check("the row is back", await day.locator(".sch-row", { hasText: "Mix night" }).count() === 1, "the event didn't come back");

  // ---- the header's + still opens an empty new event.
  await page.click(".sch-add");
  await page.waitForTimeout(200);
  check("+ opens a new event with an empty name",
    await sheet.evaluate((el) => el.open) && (await sheet.locator('input[dir="auto"]').inputValue()) === "",
    "the new-event form didn't come up empty");

  await page.screenshot({ path: path.join(require("os").tmpdir(), "daisey-sheet-check.png"), fullPage: true });
  await browser.close();
  const bad = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
