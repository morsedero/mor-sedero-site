// Job Hunt: Drive cards → tasks by stage (app/js/jobs.js), the fit factor on
// the Now card's why line (engine.js), the Drive read and the stage write-back
// (functions/_daisey-lib/jobs-drive.js, drive-move.js). Spec: "Daisey — Now
// Engine Spec v1". Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { planSync, jobTasks, buildTasks, gapOf, withStages, jobActions, jobDocId, stageOf, gapKey, TRANSITIONS, STAGES, JOB_PROJECT } from "../../app/js/jobs.js";
import { createTask } from "../../app/js/model.js";
import * as E from "../../app/js/engine.js";
import { viewCv, withPrintButton } from "../../app/js/cv.js";
const require = createRequire(import.meta.url);
const { readJobs, readCv, writeStages } = require("../../functions/_daisey-lib/jobs-drive.js");
const driveMove = require("../../functions/_daisey-lib/drive-move.js");
const { FOLDERS: F } = driveMove;

const TODAY = "2026-10-24";
const card = (id, stage, extra = {}) => ({ id, stage, title: "Mixer", company: `Co${id}`, link: "https://jobs.example/" + id, deadline: "",
  fit: 8, why: "great match", cover_letter: "https://docs.example/cl" + id, cv: "https://docs.example/cv" + id, effort_min: 20, ...extra });
const plan = (cards, tasks = [], o = {}) => planSync(cards, tasks, { today: TODAY, ...o });

// What the sync writes, applied to an in-memory task list.
function apply(tasks, p){
  const out = tasks.map((t) => { const u = p.update.find((x) => x.task.id === t.id); return u ? { ...t, ...u.patch } : t; });
  for (const { id, input, patch } of p.add) out.push({ id, ...createTask(input), ...patch });
  return out;
}
const sync = (cards, tasks = [], o = {}) => apply(tasks, plan(cards, tasks, o));
const byTitle = (tasks, re) => tasks.filter((t) => re.test(t.title));

// ---------- stages ----------
test("stage wins; the legacy status is the fallback (new/review → review, passed → passed)", () => {
  assert.equal(stageOf({ stage: "in_process", status: "review" }), "in_process");
  assert.equal(stageOf({ status: "new" }), "review");
  assert.equal(stageOf({ status: "review" }), "review");
  assert.equal(stageOf({ status: "passed" }), "passed");
  assert.equal(stageOf({ stage: "In process" }), "in_process");
  assert.equal(stageOf({}), "");
});

test("the app's pipeline and stage reading are the connection config's (drive-move.js)", () => {
  assert.deepEqual(TRANSITIONS, driveMove.TRANSITIONS);
  assert.deepEqual(STAGES, driveMove.STAGES);
  for (const c of [{ stage: "ready" }, { status: "new" }, { status: "applied" }, { status: "in process" }, { stage: "bogus", status: "passed" }, {}]) {
    assert.equal(stageOf(c), driveMove.stageOf(c), JSON.stringify(c));
  }
  assert.deepEqual(Object.keys(F).sort(), ["in_process", "passed", "pending", "ready", "review"]);
  assert.equal(F.review, "1RZplmNbCyxeLTArQ10bl1zhse0teajNh");
  assert.equal(F.in_process, "1-vbR7puV7TgFgtlhT7RvtIKe6hLPEDh6");
});

// ---------- what shows ----------
test("review, no gaps → Review & apply, effort_min long, ready", () => {
  const [t] = sync([card(1, "review", { effort_min: 25 })]);
  assert.equal(t.title, "Review & apply: Co1"); assert.equal(t.size, 25); assert.equal(t.status, "ready");
  assert.equal(t.project, JOB_PROJECT); assert.equal(t.id, jobDocId(1));
});

test("review with gaps → Build tasks first; Done on each clears its gap; none left → Review & apply", () => {
  const c = card(2, "review", { gaps: ["Wwise", "FMOD"] });
  let tasks = sync([c]);
  const stage = tasks.find((t) => t.id === jobDocId(2));
  assert.equal(stage.status, "waiting");
  assert.deepEqual(byTitle(tasks, /^Build/).map((t) => t.title), ["Build: Wwise for Co2", "Build: FMOD for Co2"]);
  assert.ok(byTitle(tasks, /^Build/).every((t) => t.status === "ready"));
  // Done on the first Build task: the gap is cleared, the review still waits on the other.
  tasks = tasks.map((t) => (t.title === "Build: Wwise for Co2" ? { ...t, status: "done" } : t));
  tasks = sync([c], tasks);
  assert.equal(tasks.find((t) => t.id === jobDocId(2)).status, "waiting");
  // The second one is dismissed (deleted), so none remain.
  const key = byTitle(tasks, /FMOD/)[0].source.key;
  tasks = sync([c], tasks.filter((t) => !/FMOD/.test(t.title)), { dismissed: new Set([key]) });
  assert.equal(tasks.find((t) => t.id === jobDocId(2)).status, "ready");
  assert.equal(byTitle(tasks, /FMOD/).length, 0); // not made again
  assert.deepEqual(plan([c], tasks, { dismissed: new Set([key]) }), { add: [], update: [] });
});

test("a deadline within 7 days: Review & apply anyway, the Build tasks after it", () => {
  const tasks = sync([card(3, "review", { gaps: ["Wwise"], deadline: "2026-10-29" })]);
  const stage = tasks.find((t) => t.id === jobDocId(3)), build = byTitle(tasks, /^Build/)[0];
  assert.equal(stage.status, "ready"); assert.equal(stage.due, "2026-10-29"); assert.equal(stage.dateKind, "deadline");
  assert.equal(build.status, "ready");
  // Ranked: the review first, its Build task right behind.
  const m = E.readMoment({ now: new Date(2026, 9, 24, 10).getTime() });
  assert.ok(E.scoreTask(stage, m).score >= E.scoreTask(build, m).score);
  // 9 days away: back to Build first.
  assert.equal(sync([card(3, "review", { gaps: ["Wwise"], deadline: "2026-11-02" })]).find((t) => t.id === jobDocId(3)).status, "waiting");
});

test("ready → Apply; pending and in_process are off Now; passed and closed show nothing", () => {
  assert.equal(sync([card(4, "ready")])[0].title, "Apply: Co4");
  const pend = sync([card(5, "pending", { stage_at: "2026-10-20T09:00:00Z" })]);
  assert.equal(pend.find((t) => t.id === jobDocId(5)).status, "waiting");
  assert.equal(sync([card(6, "in_process")]).find((t) => t.id === jobDocId(6)).status, "waiting");
  assert.deepEqual(sync([card(7, "passed"), card(8, "closed"), card(9, "review", { stage: "", status: "passed" })]), []);
});

test("pending: one nudge on follow_up_after, else 7 days after stage_at; Done only dismisses it", () => {
  const c = card(10, "pending", { stage_at: "2026-10-20T09:00:00" });
  let tasks = sync([c]);
  const nudge = byTitle(tasks, /^Follow up/)[0];
  assert.equal(nudge.title, "Follow up: Co10"); assert.equal(nudge.notBefore, "2026-10-27"); assert.equal(nudge.id, jobDocId(10, "nudge"));
  assert.equal(byTitle(sync([{ ...c, follow_up_after: "2026-11-03" }]), /^Follow up/)[0].notBefore, "2026-11-03");
  // Done on the nudge: it stays done, the job stays pending, no second nudge.
  tasks = tasks.map((t) => (t.id === nudge.id ? { ...t, status: "done" } : t));
  const after = sync([c], tasks, { dismissed: new Set([nudge.source.key]) });
  assert.equal(after.find((t) => t.id === nudge.id).status, "done");
  assert.equal(after.find((t) => t.id === jobDocId(10)).status, "waiting");
  // A new follow-up date from Claude: a new nudge on the same doc.
  const again = sync([{ ...c, follow_up_after: "2026-11-05" }], after, { dismissed: new Set([nudge.source.key]) });
  assert.equal(again.find((t) => t.id === nudge.id).status, "ready");
  assert.equal(again.find((t) => t.id === nudge.id).notBefore, "2026-11-05");
});

test("in_process: a card on interview_at, nothing else; the nudge goes when it leaves pending", () => {
  const c = card(11, "pending", { stage_at: "2026-10-20" });
  let tasks = sync([c]);
  tasks = sync([{ ...c, stage: "in_process", interview_at: "2026-10-30T14:30" }], tasks);
  assert.equal(byTitle(tasks, /^Follow up/)[0].status, "dropped");
  const iv = byTitle(tasks, /^Interview/)[0];
  assert.equal(iv.title, "Interview: Co11"); assert.equal(iv.notBefore, "2026-10-30");
  assert.equal(iv.due, "2026-10-30"); assert.equal(iv.dueTime, "14:30");
  assert.equal(byTitle(sync([card(12, "in_process")]), /^Interview/).length, 0);
});

test("a job that is passed or closed archives every open task it had", () => {
  let tasks = sync([card(13, "review", { gaps: ["Wwise"] })]);
  tasks = sync([card(13, "passed", { gaps: ["Wwise"] })], tasks);
  assert.ok(tasks.every((t) => t.status === "dropped"));
});

// ---------- the card ----------
test("chips: CV, Cover letter, Job post, Apply (mailto too); empty ones hidden; the note shows", () => {
  const [t] = sync([card(14, "ready", { apply_link: "mailto:jobs@x.example", apply_note: "Email CV + portfolio" })]);
  const a = jobActions(t);
  assert.deepEqual(a.links.map((l) => l.label), ["CV", "Cover letter", "Job post", "Apply"]);
  assert.equal(a.links[3].url, "mailto:jobs@x.example");
  assert.equal(a.note, "Email CV + portfolio");
  const [bare] = sync([card(15, "ready", { cv: "", cover_letter: "javascript:alert(1)", kit_folder: "https://drive.google.com/drive/folders/abcdefghijk" })]);
  assert.deepEqual(jobActions(bare).links.map((l) => l.label), ["Job post"]);
  // The post is not shown twice when it is the apply link.
  const [same] = sync([card(16, "ready", { apply_link: "https://jobs.example/16" })]);
  assert.deepEqual(jobActions(same).links.map((l) => l.label), ["CV", "Cover letter", "Apply"]);
  assert.equal(jobActions({ title: "not a job" }), null);
});

test("chips per step: a Build task gets the post only, no note, and names the company in the top row", () => {
  const tasks = sync([card(18, "review", { gaps: ["Trailer mix"], apply_link: "mailto:jobs@x.example", apply_note: "Email CV" })]);
  const b = jobActions(byTitle(tasks, /^Build/)[0]);
  assert.deepEqual(b.links.map((l) => l.label), ["Job post"]);
  assert.equal(b.note, "");
  assert.equal(b.title, "Build: Trailer mix");
  assert.equal(b.where, tasks[0].title.replace("Review & apply: ", ""));
  const r = jobActions(tasks.find((t) => t.id === jobDocId(18)));
  assert.deepEqual(r.links.map((l) => l.label), ["CV", "Cover letter", "Job post", "Apply"]);
  assert.equal(r.note, "Email CV");
  assert.equal(r.title, undefined);
});

test("Hebrew company, gap and note come through whole; two Hebrew gaps get two tasks", () => {
  const tasks = sync([card(17, "review", { company: "סאונד בע״מ", gaps: ["מיקס", "מאסטרינג"], apply_note: "לשלוח קו״ח במייל" })]);
  assert.equal(tasks.find((t) => t.id === jobDocId(17)).title, "Review & apply: סאונד בע״מ");
  assert.deepEqual(byTitle(tasks, /^Build/).map((t) => t.title), ["Build: מיקס for סאונד בע״מ", "Build: מאסטרינג for סאונד בע״מ"]);
  assert.notEqual(gapKey("מיקס"), gapKey("מאסטרינג"));
  assert.equal(jobActions(tasks[0]).note, "לשלוח קו״ח במייל");
});

// ---------- sync ----------
test("a second sync changes nothing, also with key-sorted maps back from the store", () => {
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  const cards = [card(1, "review", { gaps: ["Wwise"] }), card(2, "ready", { deadline: "2026-11-20" }), card(3, "pending", { stage_at: "2026-10-01" }),
    card(4, "in_process", { interview_at: "2026-10-30T10:00:00Z" })];
  const tasks = sync(cards);
  assert.equal(tasks.length, 7); // review + its Build, ready, pending + its nudge, in_process + its interview
  assert.deepEqual(plan(cards, tasks), { add: [], update: [] });
  assert.deepEqual(plan(cards, sorted(tasks)), { add: [], update: [] });
});

test("a task from before stages (old status, no role) takes its step once", () => {
  const old = { id: jobDocId(1), ...createTask({ title: "Decide: Co1, Mixer worth a kit?", project: JOB_PROJECT, source: { app: "jobhunt", cardId: "1", status: "new" } }) };
  const tasks = sync([card(1, "review", { stage: undefined, status: "new" })], [old]);
  assert.equal(tasks[0].title, "Review & apply: Co1");
  assert.deepEqual(plan([card(1, "review", { stage: undefined, status: "new" })], tasks), { add: [], update: [] });
});

test("the user's edits stand on the same step; a new deadline in the file follows", () => {
  let tasks = sync([card(1, "review", { deadline: "2026-11-20" })]);
  tasks = tasks.map((t) => ({ ...t, title: "my own title", size: 90, due: "2026-11-15" }));
  assert.deepEqual(plan([card(1, "review", { deadline: "2026-11-20" })], tasks), { add: [], update: [] });
  tasks = sync([card(1, "review", { deadline: "2026-11-25" })], tasks);
  assert.equal(tasks[0].due, "2026-11-25"); assert.equal(tasks[0].title, "my own title");
});

test("a card that leaves the file marks its tasks stale — unless the file couldn't be read", () => {
  const tasks = sync([card(1, "review", { gaps: ["x"] })]);
  const after = apply(tasks, plan([], tasks));
  assert.ok(after.filter((t) => t.source.cardId === "1").every((t) => t.source.stale));
  // Its shared Build task has no job left waiting on it: archived, not stale.
  assert.equal(byTitle(after, /^Build/)[0].status, "dropped");
  assert.deepEqual(plan([], tasks, { complete: false }), { add: [], update: [] });
});

// ---------- shared gaps ----------
const gap = (name, effort_min, sessions) => ({ name, effort_min, sessions });

test("a string gap is one 30 min Build task; jobTasks itself makes none", () => {
  const c = card(1, "review", { gaps: ["Wwise"] });
  assert.equal(jobTasks(c, { today: TODAY }).filter((d) => d.role === "build").length, 0);
  const [b] = buildTasks([c], { today: TODAY });
  assert.equal(b.input.size, 30); assert.equal(b.input.title, "Build: Wwise for Co1"); assert.equal(b.id, "job-gap-" + gapKey("Wwise"));
});

test("{ effort_min, sessions } gives one task per session, each effort_min long, (n/N)", () => {
  const tasks = byTitle(sync([card(1, "review", { gaps: [gap("Wwise demo", 180, 3)] })]), /^Build/);
  assert.deepEqual(tasks.map((t) => t.title), ["Build: Wwise demo (1/3) for Co1", "Build: Wwise demo (2/3) for Co1", "Build: Wwise demo (3/3) for Co1"]);
  assert.ok(tasks.every((t) => t.size === 180));
  assert.deepEqual(gapOf(gap("x", 0, 99)), { name: "x", min: 30, sessions: 8 });
  assert.equal(gapOf({ effort_min: 60 }), null);
});

test("the same gap on two jobs (any case) is ONE set of tasks, for both", () => {
  const cards = [card(1, "review", { gaps: [gap("Wwise demo", 180, 2)] }), card(2, "ready", { gaps: ["wwise DEMO"] })];
  const builds = byTitle(sync(cards), /^Build/);
  assert.deepEqual(builds.map((t) => t.title), ["Build: Wwise demo (1/2) for Co1, Co2", "Build: Wwise demo (2/2) for Co1, Co2"]);
  assert.deepEqual(builds[0].source.cardIds, ["1", "2"]);
  assert.equal(jobActions(builds[0]).where, "Co1, Co2");
});

test("Review & apply waits until every session is done; the last one frees it, for every job", () => {
  // Card 2 lists it as a plain string: it still waits on the same two sessions.
  const cards = [card(2, "review", { gaps: ["Reel"] }), card(1, "review", { gaps: [gap("Reel", 60, 2)] })];
  let tasks = sync(cards);
  assert.deepEqual(byTitle(tasks, /^Build/).map((t) => t.title), ["Build: Reel (1/2) for Co2, Co1", "Build: Reel (2/2) for Co2, Co1"]);
  const stageOf1 = (ts, id) => ts.find((t) => t.id === jobDocId(id)).status;
  tasks = sync(cards, tasks.map((t) => (/\(1\/2\)/.test(t.title) ? { ...t, status: "done" } : t)));
  assert.equal(stageOf1(tasks, 1), "waiting"); assert.equal(stageOf1(tasks, 2), "waiting");
  tasks = sync(cards, tasks.map((t) => (/\(2\/2\)/.test(t.title) ? { ...t, status: "done" } : t)));
  assert.equal(stageOf1(tasks, 1), "ready"); assert.equal(stageOf1(tasks, 2), "ready");
  assert.deepEqual(plan(cards, tasks), { add: [], update: [] });
});

test("an old per job Build task: archived; one already done keeps that job's gap cleared", () => {
  const old = (cardId, status) => ({ id: jobDocId(cardId, "b-" + gapKey("Wwise")), ...createTask({ title: `Build: Wwise for Co${cardId}`, project: JOB_PROJECT,
    source: { app: "jobhunt", cardId: String(cardId), stage: "review", role: "build", key: `${cardId}:b-${gapKey("Wwise")}` } }), status });
  const cards = [card(1, "review", { gaps: ["Wwise"] }), card(2, "review", { gaps: ["Wwise"] })];
  const tasks = sync(cards, [old(1, "done"), old(2, "ready")]);
  assert.equal(tasks.find((t) => t.id === jobDocId(2, "b-" + gapKey("Wwise"))).status, "dropped");
  assert.equal(tasks.find((t) => t.id === jobDocId(1)).status, "ready");
  assert.equal(tasks.find((t) => t.id === jobDocId(2)).status, "waiting");
  assert.equal(tasks.find((t) => t.id === "job-gap-" + gapKey("Wwise")).title, "Build: Wwise for Co2");
  assert.deepEqual(plan(cards, tasks), { add: [], update: [] });
});

test("a job passes: the shared title drops it; the last one passes: the task is archived", () => {
  const cards = [card(1, "review", { gaps: ["Wwise"] }), card(2, "review", { gaps: ["Wwise"] })];
  let tasks = sync(cards);
  tasks = sync([card(1, "passed", { gaps: ["Wwise"] }), cards[1]], tasks);
  const b = () => byTitle(tasks, /^Build/)[0];
  assert.equal(b().title, "Build: Wwise for Co2"); assert.equal(b().status, "ready");
  tasks = sync([card(1, "passed"), card(2, "passed")], tasks);
  assert.equal(b().status, "dropped");
});

test("complete: false never drops or stales a shared Build task; planning twice writes nothing", () => {
  const cards = [card(1, "review", { gaps: [gap("Reel", 90, 2)], deadline: "2026-10-28" }), card(2, "pending", { gaps: ["Reel"], stage_at: "2026-10-20" })];
  const tasks = sync(cards);
  assert.deepEqual(plan(cards, tasks), { add: [], update: [] });
  assert.deepEqual(plan([], tasks, { complete: false }), { add: [], update: [] });
  const builds = byTitle(tasks, /^Build: Reel \(/);
  assert.ok(builds.every((t) => t.due === "2026-10-28")); // the nearest review deadline, within 7 days
});

test("withStages: a queued Done shows the next stage at once, chained; a job Claude moved stays as the file says", () => {
  const c = card(1, "review");
  const q = { 1: [{ event: "done", from: "review", at: "2026-10-24T10:00:00Z" }] };
  assert.deepEqual([withStages([c], q)[0].stage, withStages([c], q)[0].unsynced], ["pending", true]);
  const two = { 1: [...q[1], { event: "deleted", from: "pending", at: "2026-10-24T10:05:00Z" }] };
  assert.equal(withStages([c], two)[0].stage, "passed");
  assert.equal(withStages([{ ...c, stage: "pending" }], q)[0].stage, "pending"); // already in Drive
  assert.equal(withStages([{ ...c, stage: "in_process" }], q)[0].stage, "in_process"); // Claude moved it on
  assert.equal(withStages([c], {})[0], c);
  assert.equal(withStages([c], { 1: [] })[0], c);
  // On screen: the review task becomes the waiting pending task.
  const tasks = sync(withStages([c], q), sync([c]));
  assert.equal(tasks[0].title, "Applied: Co1"); assert.equal(tasks[0].status, "waiting"); assert.equal(tasks[0].source.unsynced, true);
});

// ---------- ranking and the why line ----------
const NOW = new Date(2026, 9, 21, 10).getTime();
const moment = (o = {}) => E.readMoment({ now: NOW, ...o });
const jobTask = (c) => ({ id: c.id, ...createTask(jobTasks(c, { today: "2026-10-21" })[0].input, { now: NOW }), status: "ready" });

test("higher fit ranks higher; a deadline in 3 days beats fit", () => {
  const hi = jobTask(card(1, "review", { fit: 9 })), lo = jobTask(card(2, "review", { fit: 5 }));
  const a = E.scoreTask(hi, moment()), b = E.scoreTask(lo, moment());
  assert.ok(a.score > b.score);
  const soon = jobTask(card(3, "review", { fit: 5, deadline: "2026-10-23" }));
  assert.ok(E.scoreTask(soon, moment()).score > a.score);
});

test("the why line leads with Fit and the card's why", () => {
  const s = E.scoreTask(jobTask(card(1, "review", { fit: 8, why: "Same stack" })), moment());
  assert.match(E.whyLine(s), /^Fit 8\/10 · Same stack/);
  assert.doesNotMatch(E.whyLine(E.scoreTask(createTask({ title: "Call the bank" }, { now: NOW }), moment())), /Fit/);
});

// ---------- the Drive read ----------
const res = (status, body, text) => ({ ok: status < 300, status, json: async () => body, text: async () => text ?? JSON.stringify(body) });

test("readJobs finds jobs.json by name in the Job Hunt folder, newest first, on every read", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push(String(url)); assert.equal(init.headers.Authorization, "Bearer tok");
    return String(url).includes("alt=media") ? res(200, null, JSON.stringify([{ id: "a" }, { nope: 1 }, null]))
      : res(200, { files: [{ id: "F1", modifiedTime: "2026-10-20T00:00:00Z" }] });
  };
  assert.deepEqual(await readJobs("tok", fetchFn), { cards: [{ id: "a" }], modified: "2026-10-20T00:00:00Z", fileId: "F1" });
  const q = new URL(calls[0]).searchParams;
  assert.match(q.get("q"), /name='jobs\.json' and '1_sAGh_9VYSD2YEDxzQqnLzvII3Q4JgiE' in parents and trashed=false/);
  assert.equal(q.get("orderBy"), "modifiedTime desc");
  assert.match(calls[1], /files\/F1\?alt=media/);
  await readJobs("tok", fetchFn);
  assert.equal(calls.filter((c) => new URL(c).searchParams.has("q")).length, 2); // looked up again, not remembered
});

test("readJobs: no file → no cards; 401 → reauth; 403 scope → scope; bad JSON → error", async () => {
  assert.deepEqual(await readJobs("t", async () => res(200, { files: [] })), { cards: [], modified: null, fileId: null });
  await assert.rejects(readJobs("t", async () => res(401, {})), { reauth: true });
  await assert.rejects(readJobs("t", async () => res(403, { error: { message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } })), { scope: true });
  await assert.rejects(readJobs("t", async (u) => (String(u).includes("alt=media") ? res(200, null, "{oops") : res(200, { files: [{ id: "F" }] }))), /not JSON/);
});

// ---------- the folder move ----------
// A fake Drive: folders by id → parents; records PATCHes.
const fakeFolders = (parents, { failMove = false } = {}) => {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url), id = decodeURIComponent(u.pathname.split("/").pop());
    calls.push({ method: init.method || "GET", id, add: u.searchParams.get("addParents"), remove: u.searchParams.get("removeParents") });
    if (init.method === "PATCH") { if (failMove) return res(500, { error: { message: "boom" } }); parents[id] = [u.searchParams.get("addParents")]; return res(200, { id }); }
    return parents[id] ? res(200, { id, parents: parents[id] }) : res(404, {});
  };
  return { calls, fetchFn };
};

test("a job's folder moves by id to the stage its done/delete leads to", async () => {
  for (const [from, event] of [["review", "done"], ["ready", "done"], ["pending", "done"], ["review", "deleted"], ["ready", "deleted"], ["pending", "deleted"], ["in_process", "deleted"]]) {
    const to = TRANSITIONS[from][event];
    const d = fakeFolders({ JOBFOLDER123: [F[from]] });
    const out = await driveMove.moveJobFolder("tok", { folderId: "JOBFOLDER123", from, to }, d.fetchFn);
    assert.equal(out.moved, true, `${from} ${event}`);
    assert.deepEqual(d.calls.at(-1), { method: "PATCH", id: "JOBFOLDER123", add: F[to], remove: F[from] });
  }
});

test("never a double move: checked first; already there → no PATCH; elsewhere → conflict; closed stays put", async () => {
  const there = fakeFolders({ JOBFOLDER123: [F.pending] });
  assert.equal((await driveMove.moveJobFolder("tok", { folderId: "JOBFOLDER123", from: "review", to: "pending" }, there.fetchFn)).moved, false);
  assert.ok(!there.calls.some((c) => c.method === "PATCH"));
  const off = fakeFolders({ JOBFOLDER123: ["SOMEWHEREELSE"] });
  await assert.rejects(driveMove.moveJobFolder("tok", { folderId: "JOBFOLDER123", from: "review", to: "pending" }, off.fetchFn), { conflict: true });
  const closed = fakeFolders({ JOBFOLDER123: [F.in_process] });
  assert.equal((await driveMove.moveJobFolder("tok", { folderId: "JOBFOLDER123", from: "in_process", to: "closed" }, closed.fetchFn)).moved, false);
  assert.equal(closed.calls.length, 0);
  await assert.rejects(driveMove.moveJobFolder("tok", { folderId: F.pending, from: "review", to: "pending" }, closed.fetchFn), { bad: true });
});

// ---------- the stage write-back ----------
// A fake Drive with jobs.json (reads: the texts the file has on each read, so
// Claude can save between Daisey's two reads) and job folders.
// ids: the file's id on each lookup (Claude's rewrite makes a new one).
function fakeDrive({ reads, ids = ["JOBS1"], parents = {}, failMove = false, failSave = false }){
  const saved = [], moves = [], savedTo = [];
  let n = 0, l = 0;
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url), id = decodeURIComponent(u.pathname.split("/").pop());
    if (u.pathname.startsWith("/upload/")) { if (failSave) return res(500, {}); saved.push(init.body); savedTo.push(id); return res(200, { id, modifiedTime: "2026-10-24T12:00:00Z" }); }
    if (u.searchParams.get("q")) return res(200, { files: [{ id: ids[Math.min(l++, ids.length - 1)], modifiedTime: "m0" }] });
    if (u.searchParams.get("alt") === "media") return res(200, null, reads[Math.min(n++, reads.length - 1)]);
    if (init.method === "PATCH") { if (failMove) return res(500, {}); moves.push([id, u.searchParams.get("addParents")]); parents[id] = [u.searchParams.get("addParents")]; return res(200, { id }); }
    return parents[id] ? res(200, { id, parents: parents[id] }) : res(404, {});
  };
  return { fetchFn, saved, moves, savedTo };
}
const AT = "2026-10-24T10:00:00.000Z";

test("Done on review: folder to pending, then only stage / stage_at written, merged into a fresh read", async () => {
  const mine = [{ id: "j1", company: "Co", status: "review", folder_id: "JOBFOLDER123", why: "x" }, { id: "j2", company: "Other", stage: "review" }];
  // Between Daisey's two reads Claude rewrites the file (a new id), editing j1's why and adding a job.
  const claude = [{ ...mine[0], why: "edited by Claude" }, mine[1], { id: "j3", company: "New", stage: "review" }];
  const d = fakeDrive({ reads: [JSON.stringify(mine, null, 2), JSON.stringify(claude, null, 2) + "\n"], ids: ["JOBS1", "JOBS2"], parents: { JOBFOLDER123: [F.review] } });
  const out = await writeStages("tok", { j1: { event: "done", from: "review", at: AT } }, d.fetchFn);
  assert.deepEqual(out.results, { j1: "ok" });
  assert.deepEqual(d.moves, [["JOBFOLDER123", F.pending]]);
  assert.equal(d.saved.length, 1); assert.deepEqual(d.savedTo, ["JOBS2"]); // into Claude's new file
  const file = JSON.parse(d.saved[0]);
  assert.deepEqual(file, [{ ...claude[0], stage: "pending", stage_at: AT }, claude[1], claude[2]]);
  assert.match(d.saved[0], /^\[\n  \{\n    "id": "j1"/); // Claude's indent kept
  assert.ok(d.saved[0].endsWith("}\n]\n"));
  assert.equal(out.cards.length, 3);
});

test("delete → passed; in_process done → closed with no move; Hebrew survives the write", async () => {
  const jobs = [{ id: "j1", company: "סאונד", stage: "ready", folder_id: "JOBFOLDER123", apply_note: "לשלוח במייל" }, { id: "j2", stage: "in_process", folder_id: "JOBFOLDER456" }];
  const d = fakeDrive({ reads: [JSON.stringify(jobs)], parents: { JOBFOLDER123: [F.ready], JOBFOLDER456: [F.in_process] } });
  const out = await writeStages("tok", { j1: { event: "deleted", from: "ready", at: AT }, j2: { event: "done", from: "in_process", at: AT } }, d.fetchFn);
  assert.deepEqual(out.results, { j1: "ok", j2: "ok" });
  assert.deepEqual(d.moves, [["JOBFOLDER123", F.passed]]);
  const file = JSON.parse(d.saved[0]);
  assert.deepEqual(file.map((j) => j.stage), ["passed", "closed"]);
  assert.equal(file[0].company, "סאונד"); assert.equal(file[0].apply_note, "לשלוח במייל");
});

test("a failed move saves nothing for that job (send it again); a retry after a half-done move doesn't move twice", async () => {
  const jobs = [{ id: "j1", stage: "review", folder_id: "JOBFOLDER123" }];
  const bad = fakeDrive({ reads: [JSON.stringify(jobs)], parents: { JOBFOLDER123: [F.review] }, failMove: true });
  assert.deepEqual((await writeStages("tok", { j1: { event: "done", from: "review", at: AT } }, bad.fetchFn)).results, { j1: "failed" });
  assert.equal(bad.saved.length, 0);
  // The folder did move but the save didn't land: the retry sees it there and only saves.
  const half = fakeDrive({ reads: [JSON.stringify(jobs)], parents: { JOBFOLDER123: [F.pending] } });
  assert.deepEqual((await writeStages("tok", { j1: { event: "done", from: "review", at: AT } }, half.fetchFn)).results, { j1: "ok" });
  assert.deepEqual(half.moves, []); assert.equal(half.saved.length, 1);
  // Both landed already: nothing moved, nothing written.
  const done = fakeDrive({ reads: [JSON.stringify([{ ...jobs[0], stage: "pending" }])], parents: { JOBFOLDER123: [F.pending] } });
  assert.deepEqual((await writeStages("tok", { j1: { event: "done", from: "review", at: AT } }, done.fetchFn)).results, { j1: "ok" });
  assert.deepEqual([done.moves, done.saved], [[], []]);
  // A save that fails throws: the app keeps the change queued.
  const noSave = fakeDrive({ reads: [JSON.stringify(jobs)], parents: { JOBFOLDER123: [F.review] }, failSave: true });
  await assert.rejects(writeStages("tok", { j1: { event: "done", from: "review", at: AT } }, noSave.fetchFn));
});

test("a job Claude moved on, a job not in the file, a bad update: left alone", async () => {
  const d = fakeDrive({ reads: [JSON.stringify([{ id: "j1", stage: "in_process", folder_id: "JOBFOLDER123" }])], parents: { JOBFOLDER123: [F.in_process] } });
  const out = await writeStages("tok", { j1: { event: "done", from: "review", at: AT }, j9: { event: "done", from: "review", at: AT }, j2: { event: "nope", from: "review", at: AT } }, d.fetchFn);
  assert.deepEqual(out.results, { j1: "conflict", j9: "gone", j2: "bad" });
  assert.deepEqual([d.moves, d.saved], [[], []]);
  await assert.rejects(writeStages("tok", {}, d.fetchFn), { bad: true });
});

test("a folder moved by hand is not moved again, and the stage is still saved", async () => {
  const d = fakeDrive({ reads: [JSON.stringify([{ id: "j1", stage: "review", folder_id: "JOBFOLDER123" }])], parents: { JOBFOLDER123: ["ELSEWHERE"] } });
  assert.deepEqual((await writeStages("tok", { j1: { event: "done", from: "review", at: AT } }, d.fetchFn)).results, { j1: "ok" });
  assert.deepEqual(d.moves, []);
  assert.equal(JSON.parse(d.saved[0])[0].stage, "pending");
});

test("a queued change applies only over an older stage_at; same or newer → stale, nothing moved or saved", async () => {
  const job = (o) => JSON.stringify([{ id: "j1", stage: "review", folder_id: "JOBFOLDER123", ...o }]);
  const ask = { j1: { event: "done", from: "review", at: AT } };
  const older = fakeDrive({ reads: [job({ stage_at: "2026-10-24T09:00:00Z" })], parents: { JOBFOLDER123: [F.review] } });
  assert.deepEqual((await writeStages("tok", ask, older.fetchFn)).results, { j1: "ok" });
  assert.deepEqual(older.moves, [["JOBFOLDER123", F.pending]]);
  assert.equal(JSON.parse(older.saved[0])[0].stage_at, AT);
  for (const t of [AT, "2026-10-24T11:00:00Z"]) {
    const d = fakeDrive({ reads: [job({ stage_at: t })], parents: { JOBFOLDER123: [F.review] } });
    const out = await writeStages("tok", ask, d.fetchFn);
    assert.deepEqual(out.results, { j1: "stale" }, t);
    assert.deepEqual([d.moves, d.saved], [[], []]);
    assert.equal(out.cards[0].stage_at, t); // the reply's cards are the refresh
  }
  // Its own earlier save (already pending at AT): ok, nothing again.
  const mine = fakeDrive({ reads: [job({ stage: "pending", stage_at: AT })], parents: { JOBFOLDER123: [F.pending] } });
  assert.deepEqual((await writeStages("tok", ask, mine.fetchFn)).results, { j1: "ok" });
  assert.deepEqual([mine.moves, mine.saved], [[], []]);
  // Claude sets a newer stage_at between Daisey's two reads: not saved over.
  const race = fakeDrive({ reads: [job({}), job({ stage_at: "2026-10-24T11:00:00Z" })], parents: { JOBFOLDER123: [F.review] } });
  assert.deepEqual((await writeStages("tok", ask, race.fetchFn)).results, { j1: "stale" });
  assert.deepEqual(race.saved, []);
});

// ---------- View CV (cv.js, kept; not on the job card any more) ----------
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

