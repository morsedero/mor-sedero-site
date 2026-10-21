// Job Hunt sync: fetch the cards (daisey-now-jobs reads Drive with the stored
// Google grant — no Drive token in the browser), then write what jobs.planSync
// decides. Read only: nothing here ever writes to Drive.
//
// When Daisey opens and every 30 minutes after. The last good copy is kept in
// localStorage, so a failed fetch (offline, expired grant) still syncs from it
// and the Now card never waits on Drive.
import { idToken } from "./firebase.js";
import { watchTasks, addTaskAt, patchTask, watchProjectNames, saveProjectNames } from "./store.js";
import { planSync, JOB_PROJECT } from "./jobs.js";

const URL_ = "/.netlify/functions/daisey-now-jobs";
const CACHE_KEY = "daisey.jobs.v1";
const EVERY = 30 * 60000;

// status: "loading" · "ok" · "needs_reauth" · "needs_drive" (both: Reconnect)
// · "not_connected" · "error"
export function startJobs(uid, onStatus = () => {}){
  let tasks = null, fromCache = true, cards = null, complete = false;
  let stopped = false, loading = null, projectChecked = false;

  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (Array.isArray(saved?.cards)) { cards = saved.cards; complete = !!saved.modified; }
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
    if (stopped || !tasks || !cards) return;
    const plan = planSync(cards, tasks, { complete });
    // A snapshot from the offline cache may not know a task the server has:
    // creating from it could write one over the user's edits. Updates are safe.
    if (!fromCache) for (const { id, input } of plan.add) addTaskAt(uid, id, input, tasks).catch(fail);
    for (const { task, patch } of plan.update) patchTask(uid, task.id, patch).catch(fail);
    if (!fromCache && cards.length) ensureProject();
  }

  async function fetchCards(){
    const res = await fetch(URL_, { headers: { Authorization: `Bearer ${await idToken()}` } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { status: "ok", cards: Array.isArray(body.cards) ? body.cards : [], modified: body.modified || null };
    return { status: ["not_connected", "needs_reauth", "needs_drive"].includes(body.error) ? body.error : "error" };
  }

  function load(){
    if (loading) return loading;
    loading = fetchCards().catch((e) => { console.error("[daisey] jobs", e); return { status: "error" }; })
      .then((r) => {
        if (stopped) return;
        if (r.status === "ok") {
          cards = r.cards; complete = !!r.modified; // no file found: nothing is marked stale
          try { localStorage.setItem(CACHE_KEY, JSON.stringify({ cards, modified: r.modified, at: Date.now() })); } catch { /* no cache */ }
          reconcile();
        }
        onStatus(r.status);
      })
      .finally(() => { loading = null; });
    return loading;
  }

  const fail = (e) => console.error("[daisey] jobs", e);
  const unwatch = watchTasks(uid, (ts, meta) => { tasks = ts; fromCache = !!meta?.fromCache; reconcile(); }, fail);
  const timer = setInterval(load, EVERY);
  onStatus("loading");
  load();

  return { refresh: load, stop(){ stopped = true; clearInterval(timer); unwatch?.(); } };
}
