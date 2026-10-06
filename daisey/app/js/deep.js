// Deep Focus (master spec §20–22, Mor 2026-10-06: it replaces plain focus mode,
// and Start no longer implies it). What a web page can honestly do, and nothing
// it can't: go full screen (on the tap that starts it), keep the screen awake,
// and notice when you leave Daisey and for how long — shown back to you on
// return, never as a scolding. It CANNOT block other apps, hold back
// notifications or stop you switching; the focus screen says so and points to
// Android's own App pinning, which can. Everything lives behind this one
// module, so a native shell could replace it later without touching the app.
let active = null; // { key, lock, leftAt, away: { count, ms } }
let onChange = () => {};

export const watch = (fn) => { onChange = fn; };
export const supported = () => !!document.documentElement.requestFullscreen;

async function wake(a){
  try { a.lock = await navigator.wakeLock?.request("screen"); } catch { /* denied, or not now */ }
}
function visibility(){
  const a = active;
  if (!a) return;
  if (document.hidden) { a.leftAt = Date.now(); return; }
  if (a.leftAt) { a.away.count++; a.away.ms += Date.now() - a.leftAt; a.leftAt = null; onChange(); }
  wake(a); // the lock is released whenever the page is hidden
}

// key: the run (taskId@startedAt). Call it from the tap that starts focus:
// full screen needs a user gesture. Entering again with the same key is a no-op.
export function enter(key){
  if (active?.key === key) return;
  leave();
  active = { key, lock: null, leftAt: null, away: { count: 0, ms: 0 } };
  document.documentElement.requestFullscreen?.().catch(() => {});
  wake(active);
  document.addEventListener("visibilitychange", visibility);
}
export function leave(){
  if (!active) return;
  document.removeEventListener("visibilitychange", visibility);
  active.lock?.release?.().catch(() => {});
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  active = null;
}
export const isOn = () => !!active;
// { count, ms } of the times you left Daisey during this focus.
export const away = () => (active ? { ...active.away } : { count: 0, ms: 0 });
// What it says: "Away 2× · 6 min", or "" when you haven't been.
export function awayText(a = away()){
  if (!a.count) return "";
  const min = Math.max(1, Math.round(a.ms / 60000));
  return `Away ${a.count}× · ${min} min`;
}
