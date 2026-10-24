// Job Hunt cards (Drive's jobs.json) as Daisey tasks. PURE: no Firebase, no
// DOM, no clock, so the node tests in daisey/test/v1/ import this directly.
// jobs-sync.js fetches the cards and writes what planSync decides.
//
// This is the Job Hunt CONNECTION, not core: core (store.js) only emits
// task.done / task.deleted (task-events.js), and everything a job's stage
// means lives here and in functions/_daisey-lib/drive-move.js.
//
// Spec: "Daisey — Now Engine Spec v1" (Mor, 2026-10-24). Claude owns the
// cards; Daisey reads them and writes back only a job's stage (jobs-sync).
// A card's stage (stage, else the legacy status) picks its tasks, each on a
// doc id of its own so a refresh never makes a second one:
//   job-<id>             the stage task. Done / Delete on it is the job's
//                        transition (TRANSITIONS); nothing else is.
//     review   "Review & apply: <company>" — waiting while it has open gaps,
//              unless the deadline is within 7 days
//     ready    "Apply: <company>"
//     pending, in_process: waiting (off Now; in the Job Hunt project)
//     passed, closed: none (an open one is archived)
//   job-<id>-b-<gap>     "Build: <gap> for <company>", one per gap
//   job-<id>-nudge       pending: "Follow up: <company>" from follow_up_after,
//                        else 7 days after stage_at
//   job-<id>-interview   in_process with interview_at: a card on that day
// Done or Delete on a Build / nudge / interview task only dismisses it
// (dismissed keys, kept by jobs-sync); a Build task's Done clears its gap.
// A card that leaves the file keeps its tasks, marked source.stale.
import { toDate, toMinutes, toLinks, toTime } from "./model.js";
import { localDate } from "./daybound.js";

export const JOB_PROJECT = "Job Hunt";
export const JOB_APP = "jobhunt";

// The connection's pipeline: a copy of functions/_daisey-lib/drive-move.js
// TRANSITIONS (jobs.test.mjs fails if they drift), here so a tap changes the
// screen at once. The server's copy is the one that moves anything.
export const TRANSITIONS = {
  review: { done: "pending", deleted: "passed" },
  ready: { done: "pending", deleted: "passed" },
  pending: { done: "in_process", deleted: "passed" },
  in_process: { done: "closed", deleted: "passed" },
};
export const STAGES = ["review", "ready", "pending", "in_process", "passed", "closed"];
export const nextStage = (from, event) => (Object.hasOwn(TRANSITIONS, from) && Object.hasOwn(TRANSITIONS[from], event) ? TRANSITIONS[from][event] : "");

const EFFORT = { review: 20, ready: 30, pending: 5, in_process: 5 };
const BUILD_MIN = 30, NUDGE_MIN = 5, INTERVIEW_MIN = 60;
const SOON_DAYS = 7; // a deadline this close: Review & apply first, gaps or not
const NUDGE_DAYS = 7;
const OPEN = new Set(["ready", "waiting", "someday"]); // a task the user has not finished or let go

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const web = (v) => (/^https?:\/\/\S+$/i.test(str(v)) ? str(v) : "");
const reach = (v) => (/^(https?:\/\/|mailto:)\S+$/i.test(str(v)) ? str(v) : ""); // a web page or an email to send
const norm = (v) => str(v).toLowerCase().replace(/[\s-]+/g, "_");
const LEGACY = { new: "review", review: "review", ready: "ready", applied: "pending", pending: "pending", in_process: "in_process", passed: "passed", closed: "closed" };

// The stage a card is in: `stage`, else the legacy `status` (new/review →
// review, passed → passed, and the old applied → pending). "" when neither
// says. drive-move.js stageOf is the same function, server side.
export function stageOf(c){
  const s = norm(c?.stage);
  return STAGES.includes(s) ? s : LEGACY[norm(c?.status)] || "";
}

export const isJobTask = (t) => t?.source?.app === JOB_APP;
export const roleOf = (t) => t?.source?.role || "stage"; // tasks from before roles are stage tasks
// Doc ids can't hold "/"; the same card always lands on the same doc, so two
// devices syncing at once write one task, not two.
export const jobDocId = (cardId, suffix = "") => `job-${String(cardId).replace(/[^\w-]/g, "_")}${suffix ? "-" + suffix : ""}`;

// A gap's short, stable key (Hebrew has no \w, so a hash, not a slug).
export function gapKey(gap){
  let h = 5381;
  for (const ch of str(gap).toLowerCase()) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}
const gapsOf = (c) => (Array.isArray(c.gaps) ? [...new Set(c.gaps.map(str).filter(Boolean))].slice(0, 20) : []);

const addDays = (day, n) => { const d = new Date(`${day}T12:00`); d.setDate(d.getDate() + n); return localDate(d.getTime()); };
// A date and an optional HH:MM from an ISO date or datetime. One with a zone
// (Z, +03:00) is read in this device's time; one without is taken as written.
function whenOf(v){
  const s = str(v);
  if (/T\d\d:\d\d.*([zZ]|[+-]\d\d:?\d\d)$/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return { day: localDate(d.getTime()), time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
  }
  const day = toDate(s.slice(0, 10));
  return day ? { day, time: toTime(s.slice(11, 16)) } : null;
}

// The card's chips (spec 4): CV, Cover letter, Job post, Apply (an email
// too); empty ones hidden, and the post not twice when it is the apply link.
// No kit folder, no HTML CV.
function linksOf(c){
  const link = web(c.link), apply = reach(c.apply_link);
  return toLinks([["CV", web(c.cv)], ["Cover letter", web(c.cover_letter)], ["Job post", link === apply ? "" : link], ["Apply", apply]]
    .map(([label, url]) => ({ url, label })).filter((l) => l.url));
}

const fitOf = (c) =>{ const n = Number(c.fit); return n >= 1 && n <= 10 ? Math.round(n) : null; };

// Queued stage changes laid over the cards: { cardId: [{ event, from, at }] },
// taps Drive hasn't confirmed, in order. Each one whose job is still in
// `from` shows as done already (one already in Drive is skipped); `unsynced`
// marks every card with a tap in the queue. Where the file has the job
// somewhere else (Claude moved it on), the file wins from there.
export function withStages(cards, queue){
  return cards.map((c) => {
    const list = queue?.[str(c.id)];
    if (!list?.length) return c;
    let stage = stageOf(c), at = c.stage_at;
    for (const q of list) {
      const to = nextStage(q.from, q.event);
      if (to && stage === q.from) { stage = to; at = q.at; } else if (stage !== to) break;
    }
    return { ...c, stage, stage_at: at, unsynced: true };
  });
}

// What a card asks for: [{ id, role, key, input }] (input: addTask input).
// dismissed: keys of side tasks done or deleted ("<cardId>:<role>:<what>").
// today: the logical date, for "deadline within 7 days".
export function jobTasks(c, { dismissed = new Set(), today = localDate() } = {}){
  const cardId = str(c.id), stage = stageOf(c);
  if (!cardId || !(stage in EFFORT)) return [];
  const co = str(c.company) || str(c.title) || "this job";
  const due = toDate(str(c.deadline).slice(0, 10)), links = toLinks(linksOf(c));
  const base = { app: JOB_APP, cardId, stage, fit: fitOf(c), why: str(c.why), stale: false,
    applyNote: str(c.apply_note), unsynced: !!c.unsynced };
  // One doc per role (per gap for Build); the key also names the date a nudge or interview is for.
  const task = (role, key, title, size, extra = {}) => ({ id: jobDocId(cardId, role === "stage" ? "" : role === "build" ? key : role), role, key: `${cardId}:${key}`,
    input: { title, project: JOB_PROJECT, area: "job", size, links, nextStep: "", ...extra,
      source: { ...base, role, key: `${cardId}:${key}`, deadline: extra.due || null } } });

  const gaps = stage === "review" || stage === "ready" || stage === "pending" || stage === "in_process"
    ? gapsOf(c).filter((g) => !dismissed.has(`${cardId}:b-${gapKey(g)}`)) : [];
  const soon = !!due && due <= addDays(today, SOON_DAYS);
  const out = [];

  const size = toMinutes(c.effort_min) || EFFORT[stage];
  const dated = (stage === "review" || stage === "ready") && due ? { due, dateKind: "deadline" } : {};
  if (stage === "review") {
    const blocked = gaps.length > 0 && !soon;
    out.push(task("stage", "stage", `Review & apply: ${co}`, size, { ...dated, status: blocked ? "waiting" : "ready", waitingOn: blocked ? "Build tasks" : null }));
  } else if (stage === "ready") {
    out.push(task("stage", "stage", `Apply: ${co}`, size, { ...dated, status: "ready", waitingOn: null }));
  } else {
    out.push(task("stage", "stage", `${stage === "pending" ? "Applied" : "In process"}: ${co}`, size, { status: "waiting", waitingOn: co }));
  }
  for (const g of gaps) out.push(task("build", `b-${gapKey(g)}`, `Build: ${g} for ${co}`, BUILD_MIN, { ...(soon && stage === "review" ? dated : {}), status: "ready" }));

  if (stage === "pending") {
    const at = whenOf(c.stage_at);
    const day = whenOf(c.follow_up_after)?.day || (at ? addDays(at.day, NUDGE_DAYS) : "");
    if (day && !dismissed.has(`${cardId}:nudge-${day}`)) out.push(task("nudge", `nudge-${day}`, `Follow up: ${co}`, NUDGE_MIN, { notBefore: day, status: "ready" }));
  }
  if (stage === "in_process") {
    const w = whenOf(c.interview_at);
    if (w && !dismissed.has(`${cardId}:interview-${w.day}${w.time ? "T" + w.time : ""}`)) {
      out.push(task("interview", `interview-${w.day}${w.time ? "T" + w.time : ""}`, `Interview: ${co}`, INTERVIEW_MIN,
        { notBefore: w.day, due: w.day, dueTime: w.time, dateKind: "deadline", status: "ready" }));
    }
  }
  return out;
}

// Key order must not matter: Firestore hands maps back with sorted keys, and a
// compare that saw {label,url} != {url,label} patched forever (each snapshot
// re-rendered Now, so nothing on it could be clicked, 2026-10-21).
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v ?? null);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// The fields a fresh step sets on a task (its title, size, dates, status).
const stepFields = (i) => ({
  title: i.title, size: i.size, links: i.links, nextStep: null,
  due: i.due || null, dueTime: i.dueTime || null, dateKind: i.due ? i.dateKind : null,
  notBefore: i.notBefore || null, startTime: null,
  status: i.status, waitingOn: i.waitingOn || null, doneAt: null, checkOn: null, onHold: null, progress: 0,
});

// Cards + the user's tasks → what to write:
//   add:    [{ id, input, patch }] tasks to make (id = the doc id to use;
//           patch: what createTask can't set, a task made waiting)
//   update: [{ task, patch }] raw field patches (these are not user edits)
// Idempotent: planning again after the writes land gives nothing.
// `complete` false (no trustworthy file) never marks anything stale.
export function planSync(cards, tasks, { complete = true, dismissed = new Set(), today = localDate() } = {}){
  const byId = new Map(), byCard = new Map();
  for (const t of tasks) {
    if (!isJobTask(t) || !t.source.cardId) continue;
    byId.set(t.id, t);
    if (!byCard.has(t.source.cardId)) byCard.set(t.source.cardId, []);
    byCard.get(t.source.cardId).push(t);
  }
  // A Build task finished here clears its gap even before jobs-sync has noted it.
  const gone = new Set(dismissed);
  for (const t of byId.values()) if (roleOf(t) === "build" && t.status === "done" && t.source.key) gone.add(t.source.key);
  const add = [], update = [], seen = new Set();

  for (const c of cards) {
    const cardId = str(c.id);
    if (!cardId || seen.has(cardId)) continue;
    seen.add(cardId);
    const want = jobTasks(c, { dismissed: gone, today }), wanted = new Set();

    for (const d of want) {
      wanted.add(d.id);
      const t = byId.get(d.id);
      if (!t) { add.push({ id: d.id, input: d.input, patch: d.input.status === "ready" ? {} : { status: d.input.status, waitingOn: d.input.waitingOn } }); continue; }
      const i = d.input, patch = {};
      const src = { ...t.source, ...i.source };
      if (!same(src, t.source)) patch.source = src;
      // A task from before roles (no source.role) takes its step once.
      const step = !t.source.role || (d.role === "stage" ? t.source.stage !== i.source.stage : t.source.key !== d.key);
      if (step) {
        // A new step (the stage moved on, a new nudge or interview date): the task becomes it, reopened.
        Object.assign(patch, stepFields(i));
      } else {
        if (d.role === "stage" && OPEN.has(t.status) && t.status !== "someday" && t.status !== i.status) {
          // Gaps cleared (or the deadline came close): the review task comes off waiting, or goes back on.
          Object.assign(patch, { status: i.status, waitingOn: i.waitingOn || null, checkOn: null });
        }
        // Same step: the user's edits stand. Only what the file owns follows it.
        if (i.source.deadline !== (t.source.deadline ?? null)) Object.assign(patch, { due: i.due || null, dateKind: i.due ? i.dateKind : null });
        if (!same(i.links, t.links)) patch.links = i.links;
      }
      if (Object.keys(patch).length) update.push({ task: t, patch });
    }
    // Asked for no more (stage passed or closed, a gap Claude removed, the
    // nudge after it left pending): archived, unless already finished or let go.
    for (const t of byCard.get(cardId) || []) {
      if (wanted.has(t.id) || !OPEN.has(t.status)) continue;
      update.push({ task: t, patch: { status: "dropped", waitingOn: null, checkOn: null, onHold: null } });
    }
  }

  if (complete) for (const [cardId, ts] of byCard) {
    if (seen.has(cardId)) continue;
    for (const t of ts) if (!t.source.stale) update.push({ task: t, patch: { source: { ...t.source, stale: true } } });
  }
  return { add, update };
}

// What the Now card shows for a job task (spec 4): its chips (CV, Cover
// letter, Job post, Apply; a web page or an email — a stored URL is never
// trusted to be safe to open just because it came from a file), the apply
// note, and whether a stage change is still on its way to Drive. null for
// any other task.
export function jobActions(t){
  if (!isJobTask(t)) return null;
  const links = (t.links || []).filter((l) => /^(https?:\/\/|mailto:)/i.test(l.url || ""));
  return { links, note: str(t.source.applyNote), unsynced: !!t.source.unsynced };
}
