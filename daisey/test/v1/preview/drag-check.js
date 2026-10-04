/* Drives the real Schedule panel (daisey/app) in Chromium and checks that
   dragging a block writes what it should. Same fakes as preview.js beside it;
   needs playwright from daisey/test/ (npm install there once).

     node daisey/test/v1/preview/drag-check.js

   Prints one ok/FAIL line per check and exits non-zero if any failed. It is
   the only thing covering the drag-to-move/resize and double-tap-to-rename
   gestures — the panel's writes have no other test, and the gestures can't be
   exercised by preview.js's --click. Run it after touching schedule.js's drag
   code, the .sch-edge/.sch-grip CSS, or calendar.js's retime(). */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..", "..");  // daisey/
const { chromium } = require(path.join(ROOT, "test", "node_modules", "playwright"));
const APP = path.join(ROOT, "app");
const ORIGIN = "http://daisey.preview";

const at = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

let events = [{ id: "e1", calendarId: "primary", editable: true, allDay: false, busy: true,
  title: "Studio session", start: at(16), end: at(18), color: "#e67c73" }];
const writes = [];

const FAKES = {
  "js/config.js": "export const configured = true;",
  "js/firebase.js": `const user = { uid: "u1", email: "mor@example.com", displayName: "Mor" };
    export const onUser = (cb) => setTimeout(() => cb(user)); export const currentUid = () => "u1";
    export const signIn = async () => {}; export const signOut = () => {}; export const idToken = async () => "fake";`,
  "js/store.js": fs.readFileSync(path.join(__dirname, "fake-store.js"), "utf8"),
};

const results = [];
const check = (name, pass, got) => { results.push({ name, pass, got }); console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : "  → " + got}`); };

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
      // Behave like the real thing: apply it, so the next read shows the change.
      const ev = events.find((e) => e.id === body.eventId);
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
  await page.waitForSelector(".sch-row.editable");
  const row = page.locator(".sch-day").first().locator(".sch-row.editable").first();

  // 1. The closed row's edge bars must not take the tap that opens it.
  const edge = row.locator(".sch-edge.top");
  check("closed row: edge bars don't take pointer events",
    await edge.evaluate((el) => getComputedStyle(el).pointerEvents) === "none",
    await edge.evaluate((el) => getComputedStyle(el).pointerEvents));

  // 2. Drag the dot down two steps: the whole block moves +30 min.
  const grip = row.locator(".sch-grip");
  let box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 26, { steps: 4 });
  const midText = await row.locator(".sch-time").textContent();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 52, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  check("mid-drag the row shows the new times", midText === "16:15–18:15", midText);
  const w1 = writes.at(-1);
  check("drag the dot: moves both ends +30 min",
    w1 && w1.action === "move" && hhmm(w1.start) === "16:30" && hhmm(w1.end) === "18:30",
    w1 && `${w1.action} ${hhmm(w1.start)}–${hhmm(w1.end)}`);
  check("the list shows the moved block", (await row.locator(".sch-time").textContent()) === "16:30–18:30",
    await row.locator(".sch-time").textContent());
  check("the change can be undone", await page.locator(".sch-undo").count() === 1, "no undo offered");

  // 3. Open it, then drag the bottom bar down one step: only the end moves.
  await row.locator(".sch-open").click();
  await page.waitForTimeout(200);
  check("open row: the edge bars are live",
    await edge.evaluate((el) => getComputedStyle(el).pointerEvents) === "auto",
    await edge.evaluate((el) => getComputedStyle(el).pointerEvents));
  const bottom = row.locator(".sch-edge.bottom");
  box = await bottom.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 26, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const w2 = writes.at(-1);
  check("drag the bottom bar: only the end moves",
    w2 && hhmm(w2.start) === "16:30" && hhmm(w2.end) === "18:45", w2 && `${hhmm(w2.start)}–${hhmm(w2.end)}`);

  // 4. Drag the top bar up: only the start moves.
  const top = row.locator(".sch-edge.top");
  box = await top.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 26, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const w3 = writes.at(-1);
  check("drag the top bar: only the start moves",
    w3 && hhmm(w3.start) === "16:15" && hhmm(w3.end) === "18:45", w3 && `${hhmm(w3.start)}–${hhmm(w3.end)}`);

  // 5. A drag that ends where it started writes nothing.
  const before = writes.length;
  box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 30, { steps: 3 });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  check("a drag back to where it started writes nothing", writes.length === before, `${writes.length - before} write(s)`);

  // 6. Double-tap the name: it becomes a field, and Enter renames.
  const title = row.locator(".sch-open");
  await title.click();
  await title.click({ delay: 50 });
  await page.waitForTimeout(200);
  check("double-tap opens the rename field", await page.locator(".sch-rename").count() === 1,
    `${await page.locator(".sch-rename").count()} field(s)`);
  await page.fill(".sch-rename", "Mix night");
  await page.press(".sch-rename", "Enter");
  await page.waitForTimeout(400);
  const w4 = writes.at(-1);
  check("Enter writes the new name", w4 && w4.action === "rename" && w4.title === "Mix night", w4 && JSON.stringify(w4));
  check("the row shows the new name", (await row.locator(".sch-title").textContent()).includes("Mix night"),
    await row.locator(".sch-title").textContent());

  await page.screenshot({ path: path.join(require("os").tmpdir(), "daisey-drag-check.png"), fullPage: true });
  await browser.close();
  const bad = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
