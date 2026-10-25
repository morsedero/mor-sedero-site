// Job Hunt sync: fetch the cards (daisey-now-jobs reads Drive with the stored
// Google grant — no Drive token in the browser), lay the stage changes not yet
// in Drive over them, then write what jobs.planSync decides.
//
// Core's events (task-events.js) are read here, and only here: Done / Delete on
// a job's stage task is its transition (jobs.js TRANSITIONS: review done →
// pending, any delete → passed, …); on a Build / nudge / interview task it only
// dismisses that task. A transition goes into a queue in Firebase
// (store.watchJobStatus) and the same call POSTs it to daisey-now-jobs, which
// moves the job's folder and writes stage / stage_at into jobs.json. The task
// stays done whatever Drive says; a change Drive hasn't taken stays queued,
// shows the retry badge (onRetry), and is sent again on a tap of the badge,
// when Daisey opens, and every 30 minutes. Nothing is ever sent twice to a
// folder: the server checks the folder's parent before moving it. A change
// whose job has a stage_at as new as it (changed since) comes back "stale" and
// is dropped; the cards in that same reply are the refresh.
// Reads: on open, every 30 minutes while in view (the timer stops while
// hidden), and on coming back into view at most once a minute.
//
// The last good copy of the cards is kept in localStorage, so a failed fetch
// (offline, expired grant) still syncs from it and the Now card never waits on Drive.
import { idToken } from "./firebase.js";
import { watchTasks, addTaskAt, patchTask, watchProjectNames, saveProjectNames, watchJobStatus, saveJobStatus } from "./store.js";
import { planSync, withStages, JOB_PROJECT, isJobTask, roleOf, stageOf, nextStage } from "./jobs.js";
import { onTaskEvent } from "./task-events.js";
import { logicalDate } from "./model.js";

const URL_ = "/.netlify/functions/daisey-now-jobs";
// Job Hunt is Mor's alone (2026-10-25): main.js starts it only for this
// account. The server's own gate is functions/_daisey-lib/owner.js.
export const JOBS_OWNER = "morsedero@gmail.com";
const CACHE_KEY = "daisey.jobs.v2";
const EVERY = 30 * 60000;
const SOON = 60000; // back in view: read again, at most this often
const DONE_WITH = new Set(["ok", "conflict", "stale", "gone", "bad"]); // a reply that ends a queued change (the rest: send again)
const MAX_DISMISSED = 500;

// status: "loading" · "ok" · "needs_reauth" · "needs_drive" (both: Reconnect)
// · "not_connected" · "error". onRetry(n): how many jobs hold a change a write
// has missed (0: no badge).
export function startJobs(uid, onStatus = () => {}, { now = () => new Date(), onRetry = () => {} } = {}){
  let tasks = null, fromCache = true, cards = null, complete = false;
  let queue = null, dismissed = []; // users/{uid}/state/jobstatus; queue is null until its first snapshot
  let stopped = false, loading = null, flushing = null, projectChecked = false;

  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (Array.isArray(saved?.cards)) { cards = saved.cards; complete = !!saved.modified; }
  } catch { /* private window: no cache */ }
  const keep = (modified) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ cards, modified, at: Date.now() })); } catch { /* no cache */ }
  };

  function ensureProject(){
    if (projectChecked) return;
    projectChecked = true;
    let done = false;
    const stop = watchProjectNames(uid, (names) => {
      if (done) return;
      done = true;
      setTimeout(() => stop?.());
      if (!names.includes(JOB_PROJECT)) saveProjectNames(uid, [...names, JOB_PROJECT]).catch(fail);
    }, fail);
  }

  const badge = () => onRetry(queue ? Object.values(queue).filter((list) => list.some((e) => e.failed)).length : 0);

  function reconcile(){
    // Not before the queue is known: without the pending changes a card would
    // read as it did before them, and its task would flip back.
    if (stopped || !tasks || !cards || !queue) return;
    const plan = planSync(withStages(cards, queue), tasks, { complete, dismissed: new Set(dismissed), today: logicalDate(now().getTime()) });
    // A snapshot from the offline cache may not know a task the server has:
    // creating from it could write one over the user's edits. Updates are safe.
    if (!fromCache) for (const { id, input, patch } of plan.add) addTaskAt(uid, id, input, tasks, patch).catch(fail);
    for (const { task, patch } of plan.update) patchTask(uid, task.id, patch).catch(fail);
    if (!fromCache && cards.length) ensureProject();
  }

  const REASONS = ["not_connected", "needs_reauth", "needs_drive"];
  const auth = async () => ({ Authorization: `Bearer ${await idToken()}` });

  async function fetchCards(){
    const res = await fetch(URL_, { headers: await auth() });
    const body = await res.json().catch(() => ({}));
    // canWrite false: the cards read, but a stage move would fail — Reconnect.
    if (res.ok) return { status: body.canWrite === false ? "needs_drive" : "ok", cards: Array.isArray(body.cards) ? body.cards : [], modified: body.modified || null };
    return { status: REASONS.includes(body.error) ? body.error : "error" };
  }

  // Sends the first queued change of every job; the ones Drive settles leave
  // the queue (a job's next one goes in the next round), the rest are marked
  // failed. A change queued while this runs waits for the next round.
  function flush(){
    if (flushing) return flushing;
    if (stopped || !queue || !Object.keys(queue).length) return Promise.resolve();
    flushing = (async () => {
      for (let round = 0; round < 4 && Object.keys(queue).length; round++) {
        const sent = Object.fromEntries(Object.entries(queue).map(([id, list]) => [id, list[0]]));
        const updates = Object.fromEntries(Object.entries(sent).map(([id, e]) => [id, { event: e.event, from: e.from, at: e.at }]));
        let results = null;
        try {
          const res = await fetch(URL_, { method: "POST", headers: { ...(await auth()), "Content-Type": "application/json" }, body: JSON.stringify({ updates }) });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) { if (REASONS.includes(body.error)) onStatus(body.error); throw new Error(`stage write ${res.status} ${body.error || ""}`); }
          results = body.results || {};
          if (Array.isArray(body.cards)) { cards = body.cards; complete = true; keep(body.modified || null); }
        } catch (e) { console.error("[daisey] jobs", e); }
        if (stopped) return;
        // By value: a snapshot hands back new objects.
        const isSent = (id, e) => sent[id] && e.at === sent[id].at && e.from === sent[id].from;
        let settled = 0;
        queue = Object.fromEntries(Object.entries(queue).map(([id, list]) => [id, list.flatMap((e) => {
          if (!isSent(id, e)) return [e];
          if (results && DONE_WITH.has(results[id])) { settled++; return []; }
          return [{ ...e, failed: true }];
        })]).filter(([, list]) => list.length));
        saveJobStatus(uid, { queue }).catch(fail);
        reconcile();
        badge();
        if (!settled) break;
      }
    })().finally(() => { flushing = null; });
    return flushing;
  }

  // A stage change: queued (so it survives), shown at once, then sent.
  function queueStage(cardId, event, from){
    if (stopped || !queue || !cardId || !nextStage(from, event)) return Promise.resolve();
    queue = { ...queue, [cardId]: [...(queue[cardId] || []), { event, from, at: now().toISOString() }] };
    saveJobStatus(uid, { queue }).catch(fail);
    reconcile();
    return flushing ? flushing.then(flush) : flush(); // a write in flight didn't carry this one
  }

  function dismiss(key){
    if (stopped || dismissed.includes(key)) return;
    dismissed = [...dismissed, key].slice(-MAX_DISMISSED);
    saveJobStatus(uid, { dismissed }).catch(fail);
    reconcile();
  }

  let lastLoad = 0;
  function load(){
    if (loading) return loading;
    lastLoad = Date.now();
    loading = flush().then(fetchCards).catch((e) => { console.error("[daisey] jobs", e); return { status: "error" }; })
      .then((r) => {
        if (stopped) return;
        if (r.cards) {
          cards = r.cards; complete = !!r.modified; // no file found: nothing is marked stale
          keep(r.modified);
          reconcile();
        }
        onStatus(r.status);
      })
      .finally(() => { loading = null; });
    return loading;
  }

  const fail = (e) => console.error("[daisey] jobs", e);
  const unwatch = watchTasks(uid, (ts, meta) => { tasks = ts; fromCache = !!meta?.fromCache; reconcile(); }, fail);
  let first = true;
  const unwatchStatus = watchJobStatus(uid, (s) => {
    queue = s.queue; dismissed = s.dismissed;
    reconcile(); badge();
    if (first) { first = false; flush(); } // Daisey opened: send what an earlier session left queued
  }, fail);
  const unlistenTasks = onTaskEvent(({ type, task }) => {
    if (stopped || !isJobTask(task)) return;
    const event = type === "task.done" ? "done" : type === "task.deleted" ? "deleted" : "";
    if (!event) return;
    if (roleOf(task) === "stage") queueStage(task.source.cardId, event, task.source.stage || stageOf({ status: task.source.status }));
    else if (task.source.key) dismiss(task.source.key);
  });
  let timer = null;
  const tick = (on) => { clearInterval(timer); timer = on ? setInterval(load, EVERY) : null; };
  const onVisible = () => {
    tick(!document.hidden);
    if (!document.hidden && Date.now() - lastLoad >= SOON) load();
  };
  document.addEventListener("visibilitychange", onVisible);
  tick(!document.hidden);
  onStatus("loading");
  load();

  return { refresh: load, retry: () => flush().then(load), stop(){ stopped = true; tick(false); document.removeEventListener("visibilitychange", onVisible); unlistenTasks(); unwatch?.(); unwatchStatus?.(); } };
}
