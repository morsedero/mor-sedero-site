// Phrase-bank harness for Tell Daisey (2026-10-19). Each phrases.csv row runs
// through the same steps as the bar: tell-read.js requestBody() with the
// row's clock and a fixed task list (expect.mjs STATE), the server's
// understand() (prompt → Gemini → tidy), then tell-read.js readAnswer(). The
// structured answer is scored against expect.mjs, never the wording.
//
//   node daisey/test/phrases/run.mjs                 dev rows (the default)
//   node daisey/test/phrases/run.mjs --split=holdout  only at the end of a round
//   node daisey/test/phrases/run.mjs --ids=27,28 --gap=4000 --dry
//
// --split dev | holdout | fresh | example | all. fresh = Mor's rows H61-H80 (2026-10-20): run once per round, reported alone, never tuned on. --gap ms between model calls (spread
// out for the API's per-minute limit). --dry: no model, every answer empty;
// checks the harness itself. The key: GEMINI_API_KEY, else test/.gemini-key
// (gitignored). Writes the report to stdout and to results/.
//
// Holdout rows never go in the prompt and are never tuned on; date maths that
// fails is fixed in code, not the prompt.
process.env.TZ = "Asia/Jerusalem";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { requestBody, readAnswer } from "../../app/js/tell-read.js";
import { STATE, EXPECT } from "./expect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const chat = createRequire(import.meta.url)("../../functions/daisey-now-chat.js");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const SPLIT = arg("split", "dev"), GAP = Number(arg("gap", 4000)), DRY = process.argv.includes("--dry");
const IDS = arg("ids", "") ? arg("ids").split(",") : null;

// --- CSV ---
function parseCsv(text){
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some(Boolean));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// --- the clock ---
// "Tue 14:00", "Tue 01:30 (night)", "Oct 26", "" → ms, in the week Sun 10-18 … Sat 10-24.
const WEEK = { sun: 18, mon: 19, tue: 20, wed: 21, thu: 22, fri: 23, sat: 24 };
function clockOf(s){
  const t = String(s || "").toLowerCase();
  const hm = t.match(/(\d{1,2}):(\d{2})/);
  const [h, m] = hm ? [Number(hm[1]), Number(hm[2])] : [10, 0];
  const oct = t.match(/oct\s+(\d{1,2})/);
  const wd = Object.keys(WEEK).find((k) => t.startsWith(k));
  return new Date(2026, 9, oct ? Number(oct[1]) : wd ? WEEK[wd] : 19, h, m).getTime();
}
const RealDate = Date;
function freeze(ms){
  globalThis.Date = class extends RealDate {
    constructor(...a){ if (a.length) super(...a); else super(ms); }
    static now(){ return ms; }
  };
}
const thaw = () => { globalThis.Date = RealDate; };

// --- scoring ---
const MUTATES = new Set(["add", "update", "waiting", "drop", "done", "project", "event", "moment", "switch", "later", "hold", "resume", "undo"]);
const KNOWN = new Set([...MUTATES, "query"]);
let TASKS = STATE.tasks; // this row's task list
const titleOf = (a) => a.kind === "add" || a.kind === "event" ? a.title || ""
  : `${TASKS.find((t) => t.id === a.taskId)?.title || ""}${a.title ? ` → ${a.title}` : ""}`;
function fieldOk(want, got){
  if (want === undefined) return true;
  if (want === null) return got == null || got === "";
  if (want instanceof RegExp) return typeof got === "string" && want.test(got);
  if (typeof want === "function") return want(got);
  return want === got;
}
function matches(m, a){
  if (!(m.kind === "change" ? a.kind === "add" || a.kind === "update" : a.kind === m.kind)) return false;
  return Object.entries(m).every(([k, want]) => k === "kind" ? true
    : k === "task" ? want.test(titleOf(a))
    : k === "not" ? !want.test(a.title || "")
    : fieldOk(want, a[k]));
}
const datesOf = (a) => [a.due, a.notBefore, a.date, a.checkOn, a.routine?.until].filter(Boolean);
const asked = (r) => !!r.question || (!r.actions.length && /\?\s*$/.test(r.reply || ""));

function scoreOne(s, r){
  const used = new Set(), missing = [];
  for (const m of s.expect || []) {
    const i = r.actions.findIndex((a, j) => !used.has(j) && matches(m, a));
    if (i < 0) missing.push(m); else used.add(i);
  }
  const why = [];
  if (s.dates) {
    const all = r.actions.flatMap(datesOf);
    const bad = all.filter((d) => !s.dates.includes(d));
    if (bad.length) why.push(`date ${bad.join(",")} (want ${s.dates.join(" or ")})`);
    if (s.needDate && !all.length) why.push(`no date read (want ${s.dates.join(" or ")})`);
    if (s.needDate) r.actions.forEach((a, j) => { if (datesOf(a).some((d) => s.dates.includes(d))) used.add(j); });
  }
  if (s.time) for (const a of r.actions) if (a.kind === "event" && a.time !== s.time) why.push(`time ${a.time} (want ${s.time})`);
  if (s.ask && !r.question) why.push("didn't ask");
  for (const m of missing) why.push(KNOWN.has(m.kind) || m.kind === "change" ? `missing ${show(m)}` : `needs "${m.kind}" (no such action yet)`);
  const extra = r.actions.filter((a, j) => !used.has(j) && MUTATES.has(a.kind) && !(s.extra || []).includes(a.kind));
  if (extra.length) why.push(`changed what it shouldn't: ${extra.map(say).join("; ")}`);
  return { pass: !why.length, why, falses: extra.length };
}
function score(spec, r){
  const tries = (spec.alt || [spec]).map((s) => scoreOne(s, r));
  const win = tries.find((t) => t.pass);
  if (win) return win;
  // the closest alternative names the failure; false mutations count the fewest any reading allows
  const best = tries.reduce((a, b) => (b.why.length < a.why.length ? b : a));
  return { ...best, falses: Math.min(...tries.map((t) => t.falses)) };
}

// --- words for the report ---
const re = (v) => (v instanceof RegExp ? v.source : typeof v === "function" ? "…" : JSON.stringify(v));
const show = (m) => `${m.kind}(${Object.entries(m).filter(([k]) => k !== "kind").map(([k, v]) => `${k}:${re(v)}`).join(" ")})`;
function say(a){
  const bits = [a.kind];
  if (a.taskId) bits.push(a.taskId);
  if (a.title) bits.push(`"${a.title}"`);
  for (const k of ["project", "size", "minutes", "due", "notBefore", "date", "time", "waitingOn", "checkOn", "place", "dayEnd", "query", "range", "part"]) if (a[k] != null) bits.push(`${k}=${a[k]}`);
  if (a.routine) bits.push(`routine=${JSON.stringify(a.routine)}`);
  return bits.join(" ");
}

// --- run ---
const key = DRY ? "" : (process.env.GEMINI_API_KEY || (() => {
  try { return fs.readFileSync(path.join(HERE, "..", ".gemini-key"), "utf8"); } catch { return ""; }
})()).trim().replace(/^GEMINI_API_KEY\s*=\s*/, "").replace(/^["']|["']$/g, "").trim();
if (!DRY && !key) { console.error("No key: set GEMINI_API_KEY or put it in daisey/test/.gemini-key"); process.exit(2); }

const rows = parseCsv(fs.readFileSync(path.join(HERE, "phrases.csv"), "utf8"))
  .filter((r) => (IDS ? IDS.includes(r.id) : SPLIT === "all" || r.split === SPLIT));
const sha = crypto.createHash("sha256").update(chat.SYSTEM + chat.understand.toString()).digest("hex").slice(0, 8); // the prompt text and how it is built
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const out = [], lines = [];
let failing = 0; // rows in a row the model failed on
const log = (s = "") => { lines.push(s); console.log(s); };

log(`Phrase bank · ${IDS ? `ids ${IDS.join(",")}` : SPLIT} · ${rows.length} rows · ${new RealDate().toISOString().slice(0, 16)}Z`);
log(`model ${DRY ? "(dry run, no model)" : chat.MODEL} · prompt ${chat.PROMPT_VERSION} · sha ${sha}`);
log(`clock Asia/Jerusalem, default Mon 2026-10-19 10:00, day boundary 04:00 · Now card t2 · last task t6`);
log("");

for (const row of rows) {
  const id = /^\d+$/.test(row.id) ? Number(row.id) : row.id, spec = EXPECT[id];
  TASKS = spec?.tasks || STATE.tasks;
  if (!spec) { log(`SKIP  #${id} no expectation`); continue; }
  const text = /^\[.*\]$/.test(row.phrase.trim()) ? "" : row.phrase.trim(); // "[silence/noise]": nothing heard
  const at = clockOf(row.clock_at_input);
  let res = { reply: "", actions: [] }, error = null;
  if (text && !DRY) {
    const WAITS = [30, 60, 120, 240]; // s: busy or rate-limited, back off (an outage once took 15 rows in a row)
    for (let attempt = 0; attempt <= WAITS.length; attempt++) {
      freeze(at);
      const body = requestBody(text, TASKS, { now: STATE.now, preview: spec.preview });
      thaw();
      const got = await chat.understand(body, key);
      if (got) { res = got; break; }
      if (attempt === WAITS.length) error = `model failed ${attempt + 1} times`;
      else await pause(WAITS[attempt] * 1000);
    }
  }
  freeze(at);
  const r = readAnswer(res, text, {}, { now: STATE.now });
  thaw();
  // The free tier allows 500 requests a day per model: when the API keeps failing, stop
  // (and save nothing) instead of burning the rest of the day on retries.
  failing = error ? failing + 1 : 0;
  if (failing >= 3) { console.error("\nStopped at #" + id + ": the model failed 3 rows in a row (daily quota? curl the API to see). No result saved."); process.exit(3); }
  const sc = error ? { pass: false, why: [error], falses: 0, error: true } : score(spec, r);
  const tag = error ? "ERROR" : sc.pass ? "PASS " : "FAIL ";
  out.push({ id, category: row.category, split: row.split, pass: sc.pass, error: !!error, falses: sc.falses, asked: asked(r) });
  const did = [...r.actions.map(say), ...(r.question ? [`ask "${r.question}" [${(r.choices || []).join(" | ")}]`] : [])].join("; ") || `nothing${r.reply ? ` ("${r.reply}")` : ""}`;
  log(`${tag} #${id} [${row.category}]${row.clock_at_input ? ` @${row.clock_at_input}` : ""} "${row.phrase}"`);
  log(`       → ${did}`);
  if (!sc.pass) log(`       ✗ ${sc.why.join(" · ")}`);
  if (spec.flag) log(`       ⚑ ${spec.flag}`);
  if (text && !DRY && rows.indexOf(row) < rows.length - 1) await pause(GAP);
}

// per category
log("");
const cats = [...new Set(out.map((o) => o.category))];
const pad = (s, n) => String(s).padEnd(n);
log(`${pad("Category", 30)} ${pad("Pass", 8)} False mutations`);
for (const c of cats) {
  const rs = out.filter((o) => o.category === c);
  log(`${pad(c, 30)} ${pad(`${rs.filter((o) => o.pass).length}/${rs.length}`, 8)} ${rs.reduce((n, o) => n + o.falses, 0)}`);
}
const passN = out.filter((o) => o.pass).length, falseRows = out.filter((o) => o.falses > 0).length;
log(`${pad("TOTAL", 30)} ${pad(`${passN}/${out.length}`, 8)} ${out.reduce((n, o) => n + o.falses, 0)} (in ${falseRows} rows)${out.some((o) => o.error) ? ` · ${out.filter((o) => o.error).length} errors` : ""}`);

fs.mkdirSync(path.join(HERE, "results"), { recursive: true });
const file = path.join(HERE, "results", `${new RealDate().toISOString().slice(0, 10)}-${sha}-${IDS ? "ids" : SPLIT}${DRY ? "-dry" : ""}.txt`);
fs.writeFileSync(file, lines.join("\n") + "\n");
console.log(`\n→ ${path.relative(process.cwd(), file)}`);
