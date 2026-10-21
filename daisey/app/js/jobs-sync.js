// Job Hunt sync: fetch the cards and Mor's decisions (daisey-now-jobs reads
// Drive with the stored Google grant — no Drive token in the browser), lay the
// decisions over the cards, then write what jobs.planSync decides.
//
// jobs.json is never written. A tap (decide) goes into a queue in Firebase
// (store.watchJobStatus) and the same call POSTs it to daisey-now-jobs, which
// merges it into Daisey's own daisey-status.json. A queue entry is dropped only
// when Drive confirms it; until then the task wears a "not synced" dot and every
// sync retries it. A tap is never lost.
//
// When Daisey opens and every 30 minutes after. The last good copy is kept in
// localStorage, so a failed fetch (offline, expired grant) still syncs from it
// and the Now card never waits on Drive.
import { idToken } from "./firebase.js";
import { watchTasks, addTaskAt, patchTask, watchProjectNames, saveProjectNames, watchJobStatus, saveJobStatus } from "./store.js";
import { planSync, withStatus, JOB_PROJECT } from "./jobs.js";

const URL_ = "/.netlify/functions/daisey-now-jobs";
const CACHE_KEY = "daisey.jobs.v1";
const EVERY = 30 * 60000;

// status: "loading" · "ok" · "needs_reauth" · "needs_drive" (both: Reconnect)
// · "not_connected" · "error". A failed WRITE reports only the two Reconnect
// ones; anything else leaves the dot on the task and the tap in the queue.
export function startJobs(uid, onStatus = () => {}, { now = () => new Date() } = {}){
  let tasks = null, fromCache = true, cards = null, complete = false;
  let decided = null; // daisey-status.json's jobs, as Drive last said
  let queue = null, fileId = ""; // users/{uid}/state/jobstatus; queue is null until its first snapshot
  let stopped = false, loading = null, flushing = null, projectChecked = false;

  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (Array.isArray(saved?.cards)) { cards = saved.cards; complete = !!saved.modified; decided = saved.status || null; }
  } catch { /* private window: no cache */ }

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

  function reconcile(){
    // Not before the queue is known: without Mor's pending taps a card would
    // read as it did before them, and its task would flip back.
    if (stopped || !tasks || !cards || !queue) return;
    const plan = planSync(withStatus(cards, decided, queue), tasks, { complete });
    // A snapshot from the offline cache may not know a task the server has:
    // creating from it could write one over the user's edits. Updates are safe.
    if (!fromCache) for (const { id, input } of plan.add) addTaskAt(uid, id, input, tasks).catch(fail);
    for (const { task, patch } of plan.update) patchTask(uid, task.id, patch).catch(fail);
    if (!fromCache && cards.length) ensureProject();
  }

  const REASONS = ["not_connected", "needs_reauth", "needs_drive"];
  const auth = async () => ({ Authorization: `Bearer ${await idToken()}` });

  async function fetchCards(){
    const res = await fetch(fileId ? `${URL_}?file=${encodeURIComponent(fileId)}` : URL_, { headers: await auth() });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { status: "ok", cards: Array.isArray(body.cards) ? body.cards : [], modified: body.modified || null,
      decided: body.status && typeof body.status === "object" ? body.status : null, fileId: body.statusFileId || "" };
    return { status: REASONS.includes(body.error) ? body.error : "error" };
  }

  // Sends every queued tap; the ones Drive confirms leave the queue. A tap made
  // while this runs stays queued for the next round.
  function flush(){
    if (flushing) return flushing;
    if (stopped || !queue || !Object.keys(queue).length) return Promise.resolve();
    const sent = queue;
    flushing = (async () => {
      const res = await fetch(URL_, { method: "POST", headers: { ...(await auth()), "Content-Type": "application/json" }, body: JSON.stringify({ fileId, updates: sent }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { if (REASONS.includes(body.error)) onStatus(body.error); throw new Error(`status write ${res.status} ${body.error || ""}`); }
      if (stopped) return;
      decided = body.status || decided;
      fileId = body.fileId || fileId;
      queue = Object.fromEntries(Object.entries(queue).filter(([id, e]) => sent[id]?.at !== e.at)); // by value: a snapshot hands back new objects
      saveJobStatus(uid, { fileId, queue }).catch(fail);
      reconcile();
    })().catch((e) => console.error("[daisey] jobs", e)).finally(() => { flushing = null; });
    return flushing;
  }

  // Mor's tap: queued (so it survives), shown at once, then written.
  function decide(cardId, status, note = ""){
    if (stopped || !queue || !cardId) return Promise.resolve();
    queue = { ...queue, [cardId]: { status, at: now().toISOString(), ...(note ? { note } : {}) } };
    saveJobStatus(uid, { queue }).catch(fail);
    reconcile();
    return flushing ? flushing.then(flush) : flush(); // a write in flight didn't carry this one
  }

  function load(){
    if (loading) return loading;
    loading = flush().then(fetchCards).catch((e) => { console.error("[daisey] jobs", e); return { status: "error" }; })
      .then((r) => {
        if (stopped) return;
        if (r.status === "ok") {
          cards = r.cards; complete = !!r.modified; // no file found: nothing is marked stale
          if (r.decided) decided = r.decided;
          if (r.fileId && r.fileId !== fileId) { fileId = r.fileId; saveJobStatus(uid, { fileId }).catch(fail); }
          try { localStorage.setItem(CACHE_KEY, JSON.stringify({ cards, modified: r.modified, status: decided, at: Date.now() })); } catch { /* no cache */ }
          reconcile();
        }
        onStatus(r.status);
      })
      .finally(() => { loading = null; });
    return loading;
  }

  const fail = (e) => console.error("[daisey] jobs", e);
  const unwatch = watchTasks(uid, (ts, meta) => { tasks = ts; fromCache = !!meta?.fromCache; reconcile(); }, fail);
  const unwatchStatus = watchJobStatus(uid, (s) => { fileId = s.fileId || fileId; queue = s.queue; reconcile(); }, fail);
  const timer = setInterval(load, EVERY);
  onStatus("loading");
  load();

  return { refresh: load, decide, stop(){ stopped = true; clearInterval(timer); unwatch?.(); unwatchStatus?.(); } };
}
