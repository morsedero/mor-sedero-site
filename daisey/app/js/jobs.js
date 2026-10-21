// Job Hunt cards (Drive's jobs.json) as Daisey tasks. PURE: no Firebase, no
// DOM, no clock, so the node tests in daisey/test/v1/ import this directly.
// jobs-sync.js fetches the cards and writes what planSync decides.
//
// Mor, 2026-10-21: Daisey reads the cards and shows each as one task under the
// "Job Hunt" project; it never writes back to Drive. The card's status picks
// the task, and the task is found again by card id (source.cardId), so a
// refresh never makes a second one.
//   new     Decide: <company>, <title> worth a kit?   5 min
//   review  Review <company> CV + cover letter       20 min
//   ready   Apply to <company>, <title>              30 min
//   applied, passed: no active task — an existing one is archived (dropped).
// A card that leaves the file keeps its task, marked source.stale.
import { toDate, toMinutes, toLinks } from "./model.js";

export const JOB_PROJECT = "Job Hunt";
export const JOB_APP = "jobhunt";
const EFFORT = { new: 5, review: 20, ready: 30 };
const OPEN = new Set(["ready", "waiting", "someday"]); // a task the user has not finished or let go

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const both = (...xs) => xs.map(str).filter(Boolean).join(", ");
const web = (v) => (/^https?:\/\/\S+$/i.test(str(v)) ? str(v) : "");

export const isJobTask = (t) => t?.source?.app === JOB_APP;
// Doc ids can't hold "/"; the same card always lands on the same doc, so two
// devices syncing at once write one task, not two.
export const jobDocId = (cardId) => `job-${String(cardId).replace(/[^\w-]/g, "_")}`;

function titleOf(c, status){
  const co = str(c.company), ti = str(c.title);
  if (status === "new") return `Decide: ${both(co, ti) || "this lead"} worth a kit?`;
  if (status === "review") return `Review ${co ? co + " " : ""}CV + cover letter`;
  return `Apply to ${both(co, ti) || "this job"}`;
}

// What Start opens, in the order it is worth opening them.
function linksOf(c, status){
  const pick = { review: [["cv", "CV"], ["cover_letter", "Cover letter"], ["kit_folder", "Kit folder"]],
    ready: [["link", "Job post"], ["kit_folder", "Kit folder"]], new: [["link", "Job post"]] }[status] || [];
  return toLinks(pick.map(([k, label]) => ({ url: web(c[k]), label })).filter((l) => l.url));
}

const fitOf = (c) => { const n = Number(c.fit); return n >= 1 && n <= 10 ? Math.round(n) : null; };

// The fields the file owns on the task.
function fromCard(c){
  const status = str(c.status).toLowerCase();
  const due = toDate(str(c.deadline).slice(0, 10));
  return {
    status, due, links: linksOf(c, status),
    source: { app: JOB_APP, cardId: str(c.id), status, fit: fitOf(c), why: str(c.why), deadline: due, stale: false },
  };
}

// The task a card asks for, as addTask input; null when the status has none.
export function jobInput(c){
  const f = fromCard(c);
  if (!(f.status in EFFORT)) return null;
  return {
    title: titleOf(c, f.status), project: JOB_PROJECT, area: "job",
    size: toMinutes(c.effort_min) || EFFORT[f.status],
    due: f.due || "", dateKind: f.due ? "deadline" : "",
    nextStep: str(c.next_step), links: f.links, source: f.source,
  };
}

// Key order must not matter: Firestore hands maps back with sorted keys, and a
// compare that saw {label,url} != {url,label} patched forever (each snapshot
// re-rendered Now, so nothing on it could be clicked, 2026-10-21).
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v ?? null);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// Cards + the user's tasks → what to write:
//   add:    [{ id, input }]   cards with no task yet (id = the doc id to use)
//   update: [{ task, patch }] raw field patches (these are not user edits)
// Idempotent: planning again after the writes land gives nothing.
// `complete` false (no trustworthy file) never marks anything stale.
export function planSync(cards, tasks, { complete = true } = {}){
  const mine = new Map();
  for (const t of tasks) if (isJobTask(t) && t.source.cardId) mine.set(t.source.cardId, t);
  const add = [], update = [], seen = new Set();

  for (const c of cards) {
    const f = fromCard(c);
    if (!f.source.cardId || seen.has(f.source.cardId)) continue;
    seen.add(f.source.cardId);
    const t = mine.get(f.source.cardId);

    if (!t) {
      const input = jobInput(c);
      if (input) add.push({ id: jobDocId(f.source.cardId), input });
      continue;
    }
    const patch = {};
    const src = { ...t.source, ...f.source };
    if (!same(src, t.source)) patch.source = src;

    if (!(f.status in EFFORT)) {
      // applied / passed: nothing to do any more. Archive it, unless it is already finished or let go.
      if (OPEN.has(t.status)) Object.assign(patch, { status: "dropped", waitingOn: null, checkOn: null, onHold: null });
    } else if (t.source.status !== f.status) {
      // The card moved on: the task becomes the new step, reopened if it had been finished.
      const input = jobInput(c);
      Object.assign(patch, {
        title: input.title, size: input.size, due: f.due, dateKind: f.due ? "deadline" : null, dueTime: null,
        links: f.links, nextStep: input.nextStep || null,
        status: "ready", doneAt: null, waitingOn: null, checkOn: null, onHold: null, progress: 0,
      });
    } else {
      // Same step: the user's edits stand. Only what the file owns follows it.
      if (f.due !== (t.source.deadline ?? null)) Object.assign(patch, { due: f.due, dateKind: f.due ? "deadline" : null });
      if (!same(f.links, t.links)) patch.links = f.links;
    }
    if (Object.keys(patch).length) update.push({ task: t, patch });
  }

  if (complete) for (const [id, t] of mine) {
    if (seen.has(id) || t.source.stale) continue;
    update.push({ task: t, patch: { source: { ...t.source, stale: true } } });
  }
  return { add, update };
}

// The links the Now card offers for a job task (web only: a stored URL is
// never trusted to be safe to open just because it came from a file).
export const jobLinks = (t) => (isJobTask(t) ? (t.links || []).filter((l) => /^https?:\/\//i.test(l.url || "")) : []);
