// Job Hunt: Drive cards → tasks (app/js/jobs.js), the fit factor on the Now
// card's why line (engine.js), and the Drive read (functions/_daisey-lib/
// jobs-drive.js). Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { planSync, jobInput, jobLinks, jobDocId, JOB_PROJECT } from "../../app/js/jobs.js";
import { createTask } from "../../app/js/model.js";
import * as E from "../../app/js/engine.js";
const { readJobs } = createRequire(import.meta.url)("../../functions/_daisey-lib/jobs-drive.js");

const card = (id, status, extra = {}) => ({ id, type: "job_lead", status, title: "Mixer", company: `Co${id}`, location: "", arrangement: "",
  link: "https://jobs.example/" + id, deadline: "", fit: 8, why: "great match", next_step: "", cover_letter: "https://docs.example/cl" + id,
  cv: "https://docs.example/cv" + id, kit_folder: "https://drive.example/kit" + id, found: "", effort_min: "", project: "Job Hunt", ...extra });

// What the sync writes, applied to an in-memory task list.
function apply(tasks, plan){
  const out = tasks.map((t) => { const u = plan.update.find((x) => x.task.id === t.id); return u ? { ...t, ...u.patch } : t; });
  for (const { id, input } of plan.add) out.push({ id, ...createTask(input) });
  return out;
}

test("status picks the task, its size and its links", () => {
  const n = jobInput(card(1, "new")), r = jobInput(card(2, "review")), y = jobInput(card(3, "ready"));
  assert.equal(n.title, "Decide: Co1, Mixer worth a kit?"); assert.equal(n.size, 5);
  assert.equal(r.title, "Review Co2 CV + cover letter"); assert.equal(r.size, 20);
  assert.equal(y.title, "Apply to Co3, Mixer"); assert.equal(y.size, 30);
  assert.equal(n.project, JOB_PROJECT);
  assert.deepEqual(n.links.map((l) => l.label), ["Job post"]);
  assert.deepEqual(r.links.map((l) => l.label), ["CV", "Cover letter", "Kit folder"]);
  assert.deepEqual(y.links.map((l) => l.label), ["Job post", "Kit folder"]);
  assert.equal(jobInput(card(4, "applied")), null);
  assert.equal(jobInput(card(5, "passed")), null);
  assert.equal(jobInput(card(6, "ready", { effort_min: 45 })).size, 45);
});

test("empty fields are fine; non-web links are dropped", () => {
  const i = jobInput(card(7, "review", { company: "", cv: "javascript:alert(1)", cover_letter: "", kit_folder: "" }));
  assert.equal(i.title, "Review CV + cover letter");
  assert.equal(i.links, null);
  assert.equal(jobInput(card(8, "new", { fit: "", deadline: "soon" })).due, "");
});

test("8 cards → 8 tasks, and a second sync adds nothing", () => {
  const cards = [1, 2, 3].map((i) => card(i, "review")).concat([4, 5, 6, 7, 8].map((i) => card(i, "new")));
  const first = planSync(cards, []);
  assert.equal(first.add.length, 8);
  assert.equal(new Set(first.add.map((a) => a.id)).size, 8);
  const tasks = apply([], first);
  assert.equal(tasks.filter((t) => t.title.startsWith("Review")).length, 3);
  assert.equal(tasks.filter((t) => t.title.startsWith("Decide")).length, 5);
  const again = planSync(cards, tasks);
  assert.deepEqual(again, { add: [], update: [] });
});

// Firestore returns maps with sorted keys ({label,url}); a key-order-sensitive
// compare patched links on every snapshot, re-rendering Now forever (2026-10-21).
test("a second sync adds nothing when the store hands maps back key-sorted", () => {
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  const cards = [1, 2].map((i) => card(i, "review")).concat([3].map((i) => card(i, "ready")));
  const tasks = apply([], planSync(cards, [])).map(sorted);
  assert.deepEqual(planSync(cards, tasks), { add: [], update: [] });
});

test("a status change updates the task; applied and passed archive it", () => {
  let tasks = apply([], planSync([card(1, "new"), card(2, "ready"), card(3, "new")], []));
  tasks = apply(tasks, planSync([card(1, "review"), card(2, "applied"), card(3, "passed")], tasks));
  const byId = (i) => tasks.find((t) => t.source.cardId === String(i));
  assert.equal(byId(1).title, "Review Co1 CV + cover letter"); assert.equal(byId(1).size, 20); assert.equal(byId(1).status, "ready");
  assert.equal(byId(2).status, "dropped"); assert.equal(byId(3).status, "dropped");
  assert.equal(tasks.length, 3);
  // …and nothing more on the next pass
  assert.deepEqual(planSync([card(1, "review"), card(2, "applied"), card(3, "passed")], tasks), { add: [], update: [] });
});

test("a card with no active status makes no task; a finished task is reopened by a new step", () => {
  assert.deepEqual(planSync([card(1, "applied")], []).add, []);
  let tasks = apply([], planSync([card(2, "new")], []));
  tasks[0] = { ...tasks[0], status: "done" };
  assert.deepEqual(planSync([card(2, "new")], tasks), { add: [], update: [] }); // done stays done
  tasks = apply(tasks, planSync([card(2, "review")], tasks));
  assert.equal(tasks[0].status, "ready");
});

test("a card that leaves the file keeps its task, marked stale — unless the file is unknown", () => {
  const tasks = apply([], planSync([card(1, "new"), card(2, "new")], []));
  const gone = planSync([card(1, "new")], tasks);
  assert.equal(gone.add.length, 0);
  assert.equal(gone.update.length, 1);
  assert.equal(gone.update[0].patch.source.stale, true);
  assert.deepEqual(planSync([], tasks, { complete: false }), { add: [], update: [] });
  // back in the file → no longer stale
  const back = apply(apply(tasks, gone), planSync([card(1, "new"), card(2, "new")], apply(tasks, gone)));
  assert.equal(back.find((t) => t.source.cardId === "2").source.stale, false);
});

test("the user's edits to a task stand while the step is the same", () => {
  const tasks = apply([], planSync([card(1, "new")], []));
  tasks[0] = { ...tasks[0], title: "My own words", size: 15 };
  assert.deepEqual(planSync([card(1, "new")], tasks), { add: [], update: [] });
});

test("a deadline in the file becomes a real deadline", () => {
  const tasks = apply([], planSync([card(1, "ready", { deadline: "2026-10-24" })], []));
  assert.equal(tasks[0].due, "2026-10-24"); assert.equal(tasks[0].dateKind, "deadline");
  const moved = planSync([card(1, "ready", { deadline: "2026-10-30" })], tasks);
  assert.equal(moved.update[0].patch.due, "2026-10-30");
});

test("doc ids are stable and safe", () => {
  assert.equal(jobDocId("a/b c"), "job-a_b_c");
  assert.equal(jobDocId("x"), jobDocId("x"));
});

test("jobLinks: web links of a job task only", () => {
  const t = { source: { app: "jobhunt" }, links: [{ url: "https://a.b/c", label: "A" }, { url: "mailto:x@y.z", label: "M" }] };
  assert.deepEqual(jobLinks(t).map((l) => l.label), ["A"]);
  assert.deepEqual(jobLinks({ links: t.links }), []);
});

// ---------- ranking and the why line ----------
const NOW = new Date(2026, 9, 21, 10).getTime();
const moment = (o = {}) => E.readMoment({ now: NOW, ...o });
const jobTask = (c) => ({ id: c.id, ...createTask(jobInput(c), { now: NOW }), status: "ready" });

test("higher fit ranks higher; a deadline in 3 days beats fit", () => {
  const hi = jobTask(card(1, "new", { fit: 9 })), lo = jobTask(card(2, "new", { fit: 5 }));
  const a = E.scoreTask(hi, moment()), b = E.scoreTask(lo, moment());
  assert.ok(a.score > b.score);
  const soon = jobTask(card(3, "new", { fit: 5, deadline: "2026-10-23" }));
  assert.ok(E.scoreTask(soon, moment()).score > a.score);
});

test("the why line leads with Fit and the card's why", () => {
  const s = E.scoreTask(jobTask(card(1, "new", { fit: 8, why: "Same stack" })), moment());
  assert.match(E.whyLine(s), /^Fit 8\/10 · Same stack/);
  const bare = E.scoreTask(jobTask(card(2, "new", { fit: 4, why: "" })), moment());
  assert.ok(!/^Fit/.test(E.whyLine(bare)) || E.whyLine(bare).startsWith("Fit 4/10"));
  assert.doesNotMatch(E.whyLine(E.scoreTask(createTask({ title: "Call the bank" }, { now: NOW }), moment())), /Fit/);
});

// ---------- the Drive read ----------
const res = (status, body, text) => ({ ok: status < 300, status, json: async () => body, text: async () => text ?? JSON.stringify(body) });

test("readJobs looks the file up by name, newest first, then reads it", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push(String(url)); assert.equal(init.headers.Authorization, "Bearer tok");
    return String(url).includes("alt=media") ? res(200, null, JSON.stringify([{ id: "a" }, { nope: 1 }, null]))
      : res(200, { files: [{ id: "F1", modifiedTime: "2026-10-20T00:00:00Z" }] });
  };
  const out = await readJobs("tok", fetchFn);
  assert.deepEqual(out.cards, [{ id: "a" }]);
  const q = new URL(calls[0]).searchParams;
  assert.match(q.get("q"), /name='jobs\.json' and '1_sAGh_9VYSD2YEDxzQqnLzvII3Q4JgiE' in parents and trashed=false/);
  assert.equal(q.get("orderBy"), "modifiedTime desc");
  assert.match(calls[1], /files\/F1\?alt=media/);
});

test("readJobs: no file → no cards; 401 → reauth; 403 scope → scope; bad JSON → error", async () => {
  assert.deepEqual(await readJobs("t", async () => res(200, { files: [] })), { cards: [], modified: null });
  await assert.rejects(readJobs("t", async () => res(401, {})), { reauth: true });
  await assert.rejects(readJobs("t", async () => res(403, { error: { message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } })), { scope: true });
  await assert.rejects(readJobs("t", async () => res(403, { error: { message: "Drive API has not been used", errors: [{ reason: "accessNotConfigured" }] } })), (e) => !e.scope && !e.reauth);
  const bad = async (u) => (String(u).includes("alt=media") ? res(200, null, "{oops") : res(200, { files: [{ id: "F" }] }));
  await assert.rejects(readJobs("t", bad), /not JSON/);
});

// ---------- Apply / Review / View CV (2026-10-21) ----------
import { jobActions, cvId } from "../../app/js/jobs.js";
import { viewCv, withPrintButton } from "../../app/js/cv.js";
import { readCv } from "../../functions/_daisey-lib/jobs-drive.js";
const taskOf = (c) => createTask(jobInput(c), { now: NOW });
const DRIVE = "https://drive.google.com/file/d/1AbC-dEf_9/view";

test("Start: review → the cover-letter Doc; new/ready → apply_link, else the job post + apply_note", () => {
  const doc = "https://docs.google.com/document/d/REV/edit";
  assert.equal(jobActions(taskOf(card(1, "review", { cover_letter: doc }))).start, doc);
  const withApply = card(2, "ready", { apply_link: "https://co.example/apply", apply_note: "ignored" });
  assert.deepEqual([jobActions(taskOf(withApply)).start, jobActions(taskOf(withApply)).note], ["https://co.example/apply", ""]);
  assert.equal(jobActions(taskOf(card(3, "new", { apply_link: "https://co.example/apply" }))).start, "https://co.example/apply");
  assert.equal(jobActions(taskOf(card(4, "ready", { apply_link: "mailto:jobs@co.example?subject=Hi" }))).start, "mailto:jobs@co.example?subject=Hi");
  const none = jobActions(taskOf(card(5, "ready", { apply_link: "", apply_note: "Apply on the careers page" })));
  assert.deepEqual([none.start, none.note], ["https://jobs.example/5", "Apply on the careers page"]);
  assert.equal(jobActions(taskOf(card(6, "new", { apply_link: "javascript:alert(1)" }))).start, "https://jobs.example/6");
});

test("old cards without the new fields still work", () => {
  const old = card(7, "ready"); // no apply_link / apply_note
  const a = jobActions(taskOf(old));
  assert.deepEqual([a.start, a.note, a.cv], ["https://jobs.example/7", "", ""]);
  assert.equal(jobActions(createTask({ title: "x", source: { app: "jobhunt", cardId: "9", status: "ready" } }, { now: NOW })).start, "");
  assert.equal(jobActions(createTask({ title: "Call the bank" }, { now: NOW })), null);
});

test("View CV: only review/ready, only a Drive file URL; the CV and Start links are not doubled as chips", () => {
  assert.equal(cvId(DRIVE), "1AbC-dEf_9");
  assert.equal(cvId("https://docs.example/cv1"), "");
  assert.equal(jobActions(taskOf(card(1, "review", { cv: DRIVE }))).cv, "1AbC-dEf_9");
  assert.equal(jobActions(taskOf(card(2, "ready", { cv: DRIVE }))).cv, "1AbC-dEf_9");
  assert.equal(jobActions(taskOf(card(3, "new", { cv: DRIVE }))).cv, "");
  assert.equal(jobActions(taskOf(card(4, "review", { cv: "https://docs.example/cv4" }))).cv, "");
  const a = jobActions(taskOf(card(5, "review", { cv: DRIVE, cover_letter: "https://docs.google.com/document/d/R/edit" })));
  assert.deepEqual(a.links.map((l) => l.label), ["Kit folder"]);
});

test("a synced task picks the new fields up, and a second sync changes nothing", () => {
  const before = createTask({ ...jobInput(card(1, "ready")), source: { app: "jobhunt", cardId: "1", status: "ready", fit: 8, why: "great match", deadline: null, stale: false } }, { now: NOW });
  const tasks = [{ id: "t", ...before }];
  const cards = [card(1, "ready", { apply_link: "https://co.example/apply", cv: DRIVE })];
  const p = planSync(cards, tasks);
  assert.equal(p.update.length, 1);
  assert.equal(p.update[0].patch.source.start, "https://co.example/apply");
  assert.equal(p.update[0].patch.source.cv, "1AbC-dEf_9");
  assert.equal(planSync(cards, apply(tasks, p)).update.length, 0);
});

test("readCv reads the file by id; 404 → notFound", async () => {
  const seen = [];
  assert.equal(await readCv("tok", "F/1", async (u, init) => { seen.push(String(u)); assert.equal(init.headers.Authorization, "Bearer tok"); return res(200, null, "<html>hi</html>"); }), "<html>hi</html>");
  assert.match(seen[0], /files\/F%2F1\?alt=media/);
  await assert.rejects(readCv("t", "F", async () => res(404, {})), { notFound: true });
});

test("the print button goes before </body>, or on the end", () => {
  assert.match(withPrintButton("<html><body>x</body></html>"), /x<style>[\s\S]*Print to PDF<\/button><\/body><\/html>$/);
  assert.match(withPrintButton("<p>no body tag</p>"), /^<p>no body tag<\/p><style>/);
  assert.match(withPrintButton("<body></body>"), /Background graphics/);
});

test("viewCv: window opens first, CV lands as a blob page, blob revoked when the window closes", async () => {
  const w = { closed: false, document: { body: {} }, location: {}, closes: 0, close(){ this.closes++; } };
  const made = [], revoked = [];
  const oc = URL.createObjectURL, orv = URL.revokeObjectURL;
  URL.createObjectURL = (b) => { made.push(b); return "blob:cv1"; }; URL.revokeObjectURL = (u) => revoked.push(u);
  try {
    const order = [];
    const r = await viewCv("FILE1", { every: 5, token: async () => "tok", open: () => { order.push("open"); return w; },
      fetchFn: async (u, init) => { order.push("fetch"); assert.match(u, /daisey-now-cv\?id=FILE1$/); assert.equal(init.headers.Authorization, "Bearer tok"); return res(200, { html: "<body>cv</body>" }); } });
    assert.equal(r, true); assert.deepEqual(order, ["open", "fetch"]);
    assert.equal(made[0].type, "text/html;charset=utf-8"); assert.match(await made[0].text(), /cv<style>/);
    assert.equal(w.location.href, "blob:cv1");
    await new Promise((s) => setTimeout(s, 20)); assert.deepEqual(revoked, []); // still open
    w.closed = true; await new Promise((s) => setTimeout(s, 20)); assert.deepEqual(revoked, ["blob:cv1"]);

    const w2 = { closed: false, document: { body: {} }, location: {}, closes: 0, close(){ this.closes++; } };
    const bad = await viewCv("F", { token: async () => "t", open: () => w2, fetchFn: async () => res(409, { error: "needs_reauth" }) });
    assert.match(bad, /reconnect/); assert.equal(w2.closes, 1);
    assert.match(await viewCv("F", { token: async () => "t", open: () => null, fetchFn: async () => assert.fail("no fetch") }), /blocked/);
  } finally { URL.createObjectURL = oc; URL.revokeObjectURL = orv; }
});
