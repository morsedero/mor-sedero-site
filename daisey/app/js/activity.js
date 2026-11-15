// PC activity (2026-11-15): what the Daisey Tracker tray app saw on your
// computers, read back from daisey-now-tracker. Ported from the tracker's own
// dashboard (github.com/morsedero/Daisey-Tracker, dashboard/daisey.html).
// Day = a journal of work sessions, newest first; week = seven day stripes on
// one hour scale. A day runs 06:00 to 05:59, like the tracker's files.
// Also the link screen: the tray app opens Daisey with ?tracker=<req> and the
// person approves it here, with one click.
import { idToken } from "./firebase.js";

const URL_ = "/.netlify/functions/daisey-now-tracker";
export const TRACKER_DOWNLOAD = "https://github.com/morsedero/Daisey-Tracker/releases/latest/download/DaiseyTracker.exe";

async function api(body){
  const r = await fetch(URL_, { method: "POST",
    headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `http ${r.status}`), { code: j.error });
  return j;
}
export const trackerDevices = async () => (await api({ action: "read", dates: [], icons: false })).devices || [];
export const trackerDisconnect = (deviceId) => api({ action: "disconnect", ...(deviceId ? { deviceId } : {}) });
export const trackerInfo = (req) => api({ action: "info", req });
export const trackerApprove = (req) => api({ action: "approve", req });

// The last `days` days (today included) for the planner (profile.js). Cached:
// the planner asks on every render, the tracker uploads every few minutes.
// → { days: { date: [summary per PC] }, today } ; rejects when no PC is linked
// or the read fails (the planner then plans without it).
let history = { at: 0, value: null, pending: null };
export function trackerHistory({ days = 14, maxAge = 10 * 60 * 1000 } = {}){
  if (history.value && Date.now() - history.at < maxAge) return Promise.resolve(history.value);
  if (history.pending) return history.pending;
  const today = todayIso(), dates = [...Array(days)].map((_, i) => iso(addDays(logicalToday(), -i)));
  history.pending = api({ action: "read", dates, icons: false })
    .then((r) => { history.value = { days: r.days || {}, today }; history.at = Date.now(); return history.value; })
    .finally(() => { history.pending = null; });
  return history.pending;
}

// ---------- shared ----------
const NAMES = { "chrome":"Chrome","msedge":"Edge","firefox":"Firefox","code":"VS Code","devenv":"Visual Studio","windowsterminal":"Terminal",
  "explorer":"File Explorer","claude":"Claude","spotify":"Spotify","discord":"Discord","slack":"Slack","ms-teams":"Teams","outlook":"Outlook",
  "winword":"Word","excel":"Excel","powerpnt":"PowerPoint","notepad":"Notepad","obs64":"OBS","vlc":"VLC","steam":"Steam","cubase14":"Cubase",
  "applicationframehost":"Windows app","whatsapp":"WhatsApp","whatsapp.root":"WhatsApp","microsoft.media.player":"Media Player",
  "photos":"Photos","systemsettings":"Settings","daiseytracker":"Daisey Tracker","googledrivefs":"Google Drive","uad console":"UAD Console" };
const nice = (a) => { let b = String(a).replace(/\.exe$/i, ""); if (NAMES[b.toLowerCase()]) return NAMES[b.toLowerCase()];
  b = b.replace(/^(Microsoft|Windows)\./i, "").replace(/\.(Root|App|Exe)$/i, "").replace(/\./g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\d+$/, "");
  return b.charAt(0).toUpperCase() + b.slice(1); };
const fmt = (m) => m >= 60 ? Math.floor(m / 60) + "h " + String(Math.round(m % 60)).padStart(2, "0") + "m" : Math.round(m) + "m";
const hm = (m) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(Math.round(m % 60)).padStart(2, "0");
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const num = (v) => typeof v === "number" && isFinite(v) && v > 0 ? v : 0;
const isPng = (s) => typeof s === "string" && s.startsWith("data:image/png;base64,");
const atMidnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const weekStart = (d) => addDays(atMidnight(d), -atMidnight(d).getDay()); // weeks start on Sunday
const DAY_START = 360;
const logicalNow = () => new Date(Date.now() - DAY_START * 6e4);
const logicalToday = () => atMidnight(logicalNow());
const todayIso = () => iso(logicalNow());
// Minutes on the clock since the start of the logical day's date (06:00 = 360, 01:00 next night = 1500).
const nowClock = () => { const n = new Date(), m = n.getHours() * 60 + n.getMinutes(); return m < DAY_START ? m + 1440 : m; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function cleanRuns(d){
  const raw = (Array.isArray(d?.timeline) ? d.timeline : []).filter((r) => Array.isArray(r) && typeof r[0] === "number" && typeof r[1] === "number" && r[1] > r[0] && typeof r[2] === "string").sort((x, y) => x[0] - y[0]);
  const runs = [], off = typeof d?.dayStartMinute === "number" ? d.dayStartMinute : 0;
  for (let [s, e, app, det] of raw){ s += off; e += off;
    const p = runs[runs.length - 1], detail = typeof det === "string" ? det : "";
    if (p && p[2] === app && p[3] === detail && s - p[1] <= 1){ p[1] = e; continue; }
    runs.push([s, e, app, detail]);
  }
  return runs;
}
// Colors follow the most-used apps: top 4 get a hue, the rest grey.
function colorsFor(byApp){ const c = {}; Object.entries(byApp).sort((x, y) => y[1] - x[1]).slice(0, 4).forEach(([k], i) => c[k] = "--act-s" + (i + 1)); return c; }
const totalOf = (d) => d ? num(d.activeMinutes) || Object.values(d.appMinutes || {}).reduce((a, b) => a + num(b), 0) : 0;
function iconImg(icons, app){ if (!isPng(icons[app])) return null; const img = new Image(); img.src = icons[app]; img.alt = ""; return img; }
const tipOf = (app, detail, s, e) => `${nice(app)}${detail ? " · " + detail : ""}  ${hm(s)}–${hm(e)} (${fmt(e - s)})`;

// Several PCs on one day: add the minutes up; on the timeline, a minute used on two PCs goes to the one that started first.
function mergeDays(parts){
  if (parts.length === 1) return { ...parts[0] };
  const add = (a, b) => { for (const [k, v] of Object.entries(b || {})) a[k] = (a[k] || 0) + v; return a; };
  const out = { date: parts[0].date, dayStartMinute: parts[0].dayStartMinute, activeMinutes: 0, appMinutes: {}, siteMinutes: {}, detailMinutes: {}, timeline: [] };
  for (const p of parts){
    out.activeMinutes += p.activeMinutes || 0;
    add(out.appMinutes, p.appMinutes); add(out.siteMinutes, p.siteMinutes);
    for (const [app, d] of Object.entries(p.detailMinutes || {})) add(out.detailMinutes[app] ??= {}, d);
  }
  const runs = parts.flatMap((p) => p.timeline || []).map((r) => [...r]).sort((a, b) => a[0] - b[0]);
  let end = -1;
  for (const r of runs){ if (r[0] < end) r[0] = end; if (r[1] > r[0]){ out.timeline.push(r); end = r[1]; } }
  return out;
}

// A session is work without a break of 5+ min; the same app + project picked
// up again after under 30 min is one session with the break inside.
function sessionsOf(runs){
  const out = [];
  for (const r of runs){ const cur = out[out.length - 1]; if (cur && r[0] - cur.e < 5){ cur.runs.push(r); cur.e = r[1]; } else out.push({ s: r[0], e: r[1], runs: [r] }); }
  out.forEach(summarize);
  const merged = [];
  for (const ses of out){
    const p = merged[merged.length - 1];
    if (p && p.main === ses.main && p.detail === ses.detail && ses.s - p.e < 30){ p.breaks.push([p.e, ses.s]); p.runs.push(...ses.runs); p.e = ses.e; summarize(p); }
    else { ses.breaks = []; merged.push(ses); }
  }
  return merged;
}
function summarize(ses){
  const by = {}, det = {};
  for (const [s, e, app, d] of ses.runs){ by[app] = (by[app] || 0) + (e - s); if (d){ const k = app + "\u0001" + d; det[k] = (det[k] || 0) + (e - s); } }
  ses.apps = Object.entries(by).sort((x, y) => y[1] - x[1]);
  ses.main = ses.apps[0][0];
  const d = Object.entries(det).filter(([k]) => k.startsWith(ses.main + "\u0001")).sort((x, y) => y[1] - x[1])[0];
  ses.detail = d ? d[0].split("\u0001")[1] : "";
  ses.active = ses.apps.reduce((a, [, m]) => a + m, 0);
}
function strip(runs, s0, e0, color, cls){
  const st = el("div", cls || "act-strip"), W = Math.max(1, e0 - s0);
  for (const [s, e, app, detail] of runs){
    const i = el("i"); i.style.insetInlineStart = ((s - s0) / W * 100) + "%"; i.style.width = Math.max(.4, (e - s) / W * 100) + "%";
    i.style.background = `var(${color[app] || "--act-so"})`; i.dataset.app = app; i.dataset.tip = tipOf(app, detail, s, e); st.append(i);
  }
  return st;
}

export function mountActivity(dialog){
  dialog.classList.add("activity");
  dialog.innerHTML = `
    <div class="now-head"><h2 id="actTitle">PC activity</h2><button class="now-x" type="button" aria-label="Close">✕</button></div>
    <div class="act-bar">
      <div class="act-nav"><button type="button" data-step="-1" aria-label="Previous">&#8249;</button><p class="act-date"></p><button type="button" data-step="1" aria-label="Next">&#8250;</button></div>
      <div class="act-seg"><button type="button" data-view="day" aria-pressed="true">Day</button><button type="button" data-view="week" aria-pressed="false">Week</button></div>
    </div>
    <p class="act-total">–</p>
    <p class="act-stale" role="alert" hidden></p>
    <div class="act-cal"><p class="act-empty">Loading…</p></div>
    <p class="act-note" role="status"></p>
    <div class="act-tip"></div>`;
  const q = (s) => dialog.querySelector(s);
  const cal = q(".act-cal"), total = q(".act-total"), note = q(".act-note"), stale = q(".act-stale"), tip = q(".act-tip");
  const next = q('[data-step="1"]');
  const cache = {}; let icons = {}, updatedAt = null, devices = 0, busy = false, timer = 0;
  const state = { view: "day", day: logicalToday() };

  function renderDay(d, isToday){
    total.innerHTML = ""; total.append(fmt(totalOf(d)), el("small", null, "active"));
    if (!d){ cal.replaceChildren(el("p", "act-empty", "Nothing tracked this day.")); return; }
    const color = colorsFor(Object.fromEntries(Object.entries(d.appMinutes || {}).map(([k, v]) => [k, num(v)])));
    const runs = cleanRuns(d);
    if (!runs.length){ cal.replaceChildren(el("p", "act-empty", "Nothing tracked yet.")); return; }
    const list = sessionsOf(runs).reverse(), out = [];
    if (isToday && nowClock() - list[0].e > 3){
      const aw = el("div", "act-away"); aw.append(el("i", "act-pulse"), el("span", null, `away for ${fmt(nowClock() - list[0].e)}`)); out.push(aw);
    }
    list.forEach((ses, i) => {
      if (i) out.push(el("div", "act-gap", `${fmt(list[i - 1].s - ses.e)} away`));
      const row = el("article", "act-ses"), when = el("div", "act-when");
      const live = isToday && i === 0 && nowClock() - ses.e <= 3;
      when.append(el("span", null, hm(ses.s)));
      if (live){ const n = el("span"); n.append(el("i", "act-pulse"), "now"); when.append(n); row.classList.add("live"); row.style.setProperty("--c", `var(${color[ses.main] || "--act-so"})`); }
      else when.append(el("span", null, hm(ses.e)));
      const body = el("div", "act-body"), head = el("div", "act-head");
      const img = iconImg(icons, ses.main); if (img) head.append(img);
      head.append(el("b", null, nice(ses.main)));
      if (ses.detail){ const dd = el("span", "d", ses.detail); dd.dir = "auto"; head.append(dd); }
      head.append(el("span", "dur", fmt(ses.active)));
      const st = strip(ses.runs, ses.s, ses.e, color), W = Math.max(1, ses.e - ses.s);
      ses.breaks.forEach(([bs, be], bi) => {
        const k = el("i", "brk"); k.style.insetInlineStart = ((bs - ses.s) / W * 100) + "%"; k.style.width = ((be - bs) / W * 100) + "%";
        k.dataset.tip = `Break  ${hm(bs)}–${hm(be)} (${fmt(be - bs)})`; k.dataset.brk = String(bi); st.append(k);
      });
      body.append(head, st);
      // Under the strip: icon + time for the other apps' pieces that are wide enough (fitLabels hides the rest).
      const labs = el("div", "act-labs");
      for (const [s, e, app] of ses.runs){
        if (app === ses.main) continue;
        const l = el("span", "act-lab"); l.style.insetInlineStart = ((s - ses.s) / W * 100) + "%"; l.style.width = ((e - s) / W * 100) + "%";
        const im = iconImg(icons, app); if (im) l.append(im); l.append(fmt(e - s)); labs.append(l);
      }
      if (labs.childElementCount) body.append(labs);
      if (ses.apps.length > 1 || ses.breaks.length){
        const more = el("div", "act-more");
        const light = (test) => { st.classList.add("focus"); st.querySelectorAll("i").forEach((x) => x.classList.toggle("on", test(x))); };
        ses.breaks.forEach(([bs, be], bi) => {
          const c = el("span", "bnote", `${fmt(be - bs)} break`); c.dataset.tip = `Break  ${hm(bs)}–${hm(be)} (${fmt(be - bs)})`;
          c.onmouseenter = () => light((x) => x.dataset.brk === String(bi)); c.onmouseleave = () => st.classList.remove("focus"); more.append(c);
        });
        for (const [app, m] of ses.apps.slice(1, 7)){
          const c = el("span", "act-chip"); c.title = nice(app);
          c.onmouseenter = () => { light((x) => x.dataset.app === app); c.classList.add("sel"); };
          c.onmouseleave = () => { st.classList.remove("focus"); c.classList.remove("sel"); };
          const im = iconImg(icons, app); if (im) c.append(im); else c.append(el("em", null, nice(app)));
          c.append(fmt(m)); more.append(c);
        }
        body.append(more);
      }
      row.append(when, body); out.push(row);
    });
    cal.replaceChildren(...out);
    fitLabels();
  }
  function fitLabels(){
    cal.querySelectorAll(".act-labs").forEach((row) => {
      let any = false;
      row.querySelectorAll(".act-lab").forEach((l) => { const fits = l.getBoundingClientRect().width >= 40; l.style.visibility = fits ? "" : "hidden"; any ||= fits; });
      row.classList.toggle("none", !any);
    });
  }
  function renderWeek(start){
    const dates = [...Array(7)].map((_, i) => addDays(start, i)), all = {}; let sum = 0;
    for (const dt of dates){ const d = cache[iso(dt)]; if (!d) continue; sum += totalOf(d); for (const [k, v] of Object.entries(d.appMinutes || {})) all[k] = (all[k] || 0) + num(v); }
    total.innerHTML = ""; total.append(fmt(sum), el("small", null, "active this week"));
    const color = colorsFor(all), tIso = todayIso();
    const runsBy = Object.fromEntries(dates.map((dt) => [iso(dt), cleanRuns(cache[iso(dt)])]));
    const flat = Object.values(runsBy).flat();
    let a = flat.length ? Math.floor(Math.min(...flat.map((r) => r[0])) / 60) * 60 : 8 * 60, b = flat.length ? Math.ceil(Math.max(...flat.map((r) => r[1])) / 60) * 60 : 20 * 60;
    if (b - a < 360) b = a + 360;
    const wk = el("div", "act-wk"), axis = el("div", "act-axis"), stepH = (b - a) > 720 ? 6 : 3;
    for (let m = a; m <= b; m += stepH * 60){ const t = el("span", null, hm(m)); t.style.insetInlineStart = ((m - a) / (b - a) * 100) + "%"; axis.append(t); }
    wk.append(el("div"), axis, el("div"));
    for (const dt of dates){
      const k = iso(dt), lab = el("button", "act-wlab" + (k === tIso ? " is-today" : ""), dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }));
      lab.type = "button";
      const st = strip(runsBy[k], a, b, color, "act-wstrip");
      const tot = el("span", "act-wtot", cache[k] ? fmt(totalOf(cache[k])) : "");
      const open = () => { state.view = "day"; state.day = dt; go(); };
      lab.onclick = open; st.onclick = (e) => { if (!e.target.closest("i")) open(); };
      if (dt > logicalToday()){ lab.style.opacity = st.style.opacity = ".35"; lab.disabled = true; }
      wk.append(lab, st, tot);
    }
    cal.replaceChildren(wk);
  }

  async function fetchDays(dates){
    const t = todayIso(), need = dates.filter((d) => d === t || !(d in cache));
    if (!need.length) return;
    const r = await api({ action: "read", dates: need });
    icons = r.icons || icons;
    for (const d of need){
      const parts = r.days?.[d] || [];
      cache[d] = parts.length ? mergeDays(parts) : null;
      if (d === t){ updatedAt = parts.length ? Math.max(...parts.map((p) => p.updatedAt || 0)) : null; devices = parts.length; }
    }
  }

  async function go(){
    const t = logicalToday();
    if (state.day > t) state.day = t;
    dialog.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === state.view));
    let dates;
    if (state.view === "day"){
      dates = [iso(state.day)];
      q(".act-date").textContent = iso(state.day) === iso(t) ? "Today" : state.day.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
      next.disabled = state.day >= t;
    } else {
      const s = weekStart(state.day), e = addDays(s, 6);
      dates = [...Array(7)].map((_, i) => iso(addDays(s, i)));
      q(".act-date").textContent = `${s.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${e.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
      next.disabled = e >= t;
    }
    const paint = () => state.view === "day" ? renderDay(cache[dates[0]], dates[0] === todayIso()) : renderWeek(weekStart(state.day));
    if (dates.every((d) => d in cache)) paint(); else cal.replaceChildren(el("p", "act-empty", "Loading…"));
    if (busy) return; busy = true;
    try {
      await fetchDays(dates);
      paint();
      const at = updatedAt && new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      note.textContent = at ? "Updated " + at + (devices > 1 ? ` · ${devices} PCs` : "") : "";
      // Today but nothing new for 10 min from any PC: the tracker is off (it sends every couple of minutes, away or not).
      const isStale = state.view === "day" && iso(state.day) === todayIso() && updatedAt && Date.now() - updatedAt > 10 * 60 * 1000;
      stale.hidden = !isStale;
      if (isStale) stale.textContent = `Tracker isn't running. Last data ${at}.`;
    } catch (e) {
      console.error("[daisey] activity", e);
      note.textContent = "Couldn't load. Retrying in a minute.";
    } finally { busy = false; }
  }
  const step = (n) => { state.day = addDays(state.day, state.view === "day" ? n : 7 * n); go(); };

  dialog.querySelectorAll("[data-step]").forEach((b) => b.onclick = () => step(Number(b.dataset.step)));
  dialog.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => { state.view = b.dataset.view; go(); });
  dialog.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight" && !next.disabled) step(1); });
  const close = () => dialog.close();
  q(".now-x").onclick = close;
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  const showTip = (e) => {
    const t = e.target.closest?.("[data-tip]");
    if (!t){ tip.style.display = "none"; return; }
    tip.textContent = t.dataset.tip; tip.style.display = "block";
    tip.style.left = Math.max(8, Math.min(e.clientX - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 8)) + "px"; tip.style.top = (e.clientY - 38) + "px";
  };
  dialog.addEventListener("mousemove", showTip);
  dialog.addEventListener("click", showTip);
  addEventListener("resize", () => { if (dialog.open) fitLabels(); });
  dialog.addEventListener("close", () => { clearInterval(timer); tip.style.display = "none"; });

  return {
    open(){
      state.view = "day"; state.day = logicalToday();
      if (!dialog.open) dialog.showModal();
      go();
      clearInterval(timer);
      timer = setInterval(() => { if (!document.hidden) go(); }, 60 * 1000);
    },
  };
}

// The tray app opened Daisey with ?tracker=<req>: one screen, one Approve.
export async function approveTrackerFromUrl(dialog){
  const params = new URLSearchParams(location.search), req = params.get("tracker");
  if (!req) return;
  params.delete("tracker");
  history.replaceState(null, "", location.pathname + (params.size ? "?" + params : "") + location.hash);
  dialog.innerHTML = `
    <div class="now-head"><h2 id="trkTitle">Connect this PC?</h2><button class="now-x" type="button" aria-label="Close">✕</button></div>
    <p class="act-link-msg">Checking…</p>
    <div class="sheet-bottom"><button class="btn quiet" type="button" data-no>Not now</button><button class="btn primary" type="button" data-yes disabled>Approve</button></div>`;
  const msg = dialog.querySelector(".act-link-msg"), yes = dialog.querySelector("[data-yes]");
  const close = () => dialog.close();
  dialog.querySelector(".now-x").onclick = close; dialog.querySelector("[data-no]").onclick = close;
  dialog.showModal();
  try {
    const { device } = await trackerInfo(req);
    msg.textContent = `Daisey Tracker on “${device}” wants to send which apps you use on it, and for how long, to your Daisey. Window titles are never sent. Only approve it if you just started the tracker on this computer.`;
    yes.disabled = false;
  } catch (e) {
    msg.textContent = e.code === "gone" ? "This link has expired. Right-click the tray icon and choose Connect to Daisey again." : "Couldn't check the link. Try again from the tray icon.";
    yes.hidden = true;
    return;
  }
  yes.onclick = async () => {
    yes.disabled = true;
    try { await trackerApprove(req); msg.textContent = "Connected. You can close this tab; the tracker takes it from here. See it in the menu under PC activity."; yes.hidden = true; dialog.querySelector("[data-no]").textContent = "Done"; }
    catch { msg.textContent = "Couldn't connect. Try again."; yes.disabled = false; }
  };
}
