// Boot: sign-in → load data → show card.
import { configured } from "./config.js";

const $ = (s) => document.querySelector(s);
const GUEST_KEY = "daisey_guest_mode";
const GUEST_UID = "guest-local";
const guestMode = () => { try { return localStorage.getItem(GUEST_KEY) === "1"; } catch { return false; } };

import { flash, h, bdi, icon } from "./ui.js";

// The header's chips (round 3, New Design/6): green "✓ N done" today, and
// amber "N need you", each only when there is something. now.js reports both.
// Words on both (2026-10-06): bare numbers beside "Today" read as "2 Today 0".
// The daisy itself is always the full five-petal logo.
// Plan and Done are one chip (Mor, 2026-10-08): it opens the plan, the day's
// done list sits under it. "Plan d/t" (done-today tasks outside the plan count in both); no plan but tasks done → "✓ n".
let doneNow = 0, planNow = null;
function paintDone(n){ doneNow = n; paintChip(); }
function paintPlan(p){ planNow = p; paintChip(); }
function paintChip(){
  const p = planNow, n = doneNow;
  $("#planChip").hidden = false;
  $("#planChip").classList.toggle("empty", !p && !n);
  $("#planW").textContent = p ? "Plan " : n ? "" : "Plan my day";
  $("#planN").textContent = p ? `${p.done}/${p.total}` : n ? `✓ ${n}` : "";
  $("#planChip").ariaLabel = p ? `Today's plan: ${p.done} of ${p.total} done. Open it to change it`
    : n ? `${n === 1 ? "1 task" : `${n} tasks`} done today. Open the plan` : "Plan my day";
}
function paintNeeds(n){
  $("#needsChip").hidden = !n;
  $("#needsN").textContent = String(n);
  $("#needsW").textContent = ` need${n === 1 ? "s" : ""} you`;
  $("#needsChip").ariaLabel = `Needs you: ${n} decision${n === 1 ? "" : "s"}`;
}


// Top-bar clock and date (Mor, 2026-10-08): 24h like the rest of the app,
// repainted on the minute, and straight away when the tab comes back.
function paintClock(){
  const d = new Date();
  $("#hdrTime").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  $("#hdrDate").textContent = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
paintClock();
setInterval(() => { if (!document.hidden) paintClock(); }, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) paintClock(); });

// The home screen is exactly the window's height (app.css .shell). 100dvh
// alone ran ~50px past the bottom in the installed app on Mor's Android
// phone (2026-10-06), pushing Tell Daisey off-screen; innerHeight is what's
// really there.
const fitHeight = () => document.documentElement.style.setProperty("--app-h", `${innerHeight}px`);
fitHeight();
addEventListener("resize", fitHeight);
visualViewport?.addEventListener("resize", fitHeight);

// Registering a worker is what makes "add to home screen" offer a real app
// window; sw.js caches nothing on purpose.
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((e) => console.warn("[daisey] sw", e)));
}
// One status box for everything before the board: it holds only what's true
// now, and is emptied once signed in. (Four hidden sections used to sit in
// the page for good — "Firebase isn't configured" and a second "Sign in with
// Google" among them, read out by screen readers and page readers alike.)
let onSignIn = () => {};
let onGuest = () => {};
// The opening daisy (index.html) covers everything until there's something
// true to show: the sign-in box, an error, or the Now card's first real draw
// (now.js onReady). A slow or failed load still lifts it after 12s.
// It stays at least long enough for all five petals to open, so a fast load
// doesn't flash it.
// Slow-changing captions under the daisy: a new line every ~3.5s, fading
// out and in. Stops when the splash lifts.
const SPLASH_LINES = [
  "Waking Daisey up…",
  "Fluffing the petals…",
  "Checking your calendar…",
  "Reading your Trello cards…",
  "Finding the right next thing…",
  "Almost there…",
];
(function splashLines(){
  const el = $("#splashMsg");
  if (!el) return;
  let i = 0;
  const t = setInterval(() => {
    if (!el.isConnected) { clearInterval(t); return; }
    el.classList.add("fade");
    setTimeout(() => {
      i = Math.min(i + 1, SPLASH_LINES.length - 1);
      el.textContent = SPLASH_LINES[i];
      el.classList.remove("fade");
    }, 600);
  }, 3500);
})();
function splashOff(){
  const s = $("#splash");
  if (!s || s.classList.contains("gone")) return;
  const wait = 900 - performance.now();
  if (wait > 0) { setTimeout(splashOff, wait); return; }
  s.classList.add("gone");
  setTimeout(() => s.remove(), 400);
}
setTimeout(splashOff, 12000);
function show(view, text = ""){
  const box = $("#status");
  if (view === "signedin") { box.hidden = true; box.replaceChildren(); return; }
  splashOff();
  box.hidden = false;
  if (view === "signedout") {
    const msg = Object.assign(document.createElement("p"), { className: "msg", role: "alert" });
    const googleBtn = Object.assign(document.createElement("button"), { className: "btn primary", type: "button", textContent: "Sign in with Google" });
    const guestBtn = Object.assign(document.createElement("button"), { className: "btn secondary", type: "button", textContent: "Continue as guest" });
    googleBtn.onclick = () => onSignIn(msg);
    guestBtn.onclick = () => onGuest(msg);
    box.replaceChildren(
      Object.assign(document.createElement("p"), { textContent: "Sign in to sync your tasks, or try Daisey as a guest. Guest data stays on this device." }),
      googleBtn,
      guestBtn,
      msg,
    );
    return;
  }
  box.replaceChildren(Object.assign(document.createElement("p"), { className: view === "loading" ? "muted" : "", textContent: text || "Loading…" }));
}

// Theme (Mor, 2026-10-04). Auto follows the phone; Light and Dark override it
// and stay overridden. The choice is a data-theme attribute on <html> that
// app.css reads, written for the FIRST paint by the inline script in
// index.html and owned from here after that.
{
  const KEY = "daisey.theme";
  const PAPER = "#fbf8ef", NIGHT = "#16150f";
  const saved = () => { try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; } };

  // The address bar follows too. The two <meta>s are the light-media one and
  // the dark-media one; on Auto they keep their own colours, and an override
  // sets both to the chosen one so the system's answer can't win.
  function paintBar(choice){
    const [light, dark] = document.querySelectorAll('meta[name="theme-color"]');
    if (!light || !dark) return;
    light.content = choice === "dark" ? NIGHT : PAPER;
    dark.content = choice === "light" ? PAPER : NIGHT;
  }

  function apply(choice){
    if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
    else delete document.documentElement.dataset.theme;
    try { choice === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, choice); } catch { /* private window */ }
    for (const b of document.querySelectorAll("[data-set-theme]")) b.setAttribute("aria-checked", String(b.dataset.setTheme === choice));
    paintBar(choice);
  }

  for (const b of document.querySelectorAll("[data-set-theme]")) b.onclick = () => apply(b.dataset.setTheme);
  apply(saved());
}

if (!configured) {
  show("error", "Daisey isn't set up on this site yet.");
} else {
  boot().catch((e) => {
    console.error("[daisey] boot", e);
    show("error", "Couldn't load: " + (e.message || e));
  });
}

async function boot(){
  const fb = await import("./firebase.js");
  let mounted = null; // { now, tasks, adder } while signed in
  let onCard = null; // task id on the Now card, shared with the board

  onSignIn = async (msg) => {
    msg.textContent = "";
    try { await fb.signIn(); }
    catch (e) {
      if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
      msg.textContent = e.code === "auth/popup-blocked"
        ? "Popup was blocked. Allow popups for this site and try again."
        : "Sign-in failed: " + (e.code || e.message);
    }
  };
  onGuest = async (msg) => {
    msg.textContent = "";
    try {
      fb.enableGuestMode();
      location.reload();
    } catch (e) {
      msg.textContent = e?.message || "Guest sign-in failed.";
    }
  };
  // Account menu under the avatar.
  const menu = $("#acctMenu"), avatar = $("#avatar");
  const setMenu = (open) => { menu.hidden = !open; avatar.setAttribute("aria-expanded", String(open));
    // Stats in the menu (Mor, 2026-10-10): painted by projects.js while open.
    const box = $("#acctStats"), stats = mounted?.projects?.stats;
    box.hidden = !open || !stats;
    stats?.(open ? box : null); };
  avatar.onclick = (e) => { e.stopPropagation(); setMenu(menu.hidden); };
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
  $("#signout").onclick = () => {
    setMenu(false);
    try { localStorage.removeItem(GUEST_KEY); } catch { /* private window */ }
    fb.signOut().finally(() => location.reload());
  };
  // Settings: the avatar menu's one door to everything else (Mor, 2026-10-06).
  // A tap on the dim backdrop closes it, like Escape and ✕.
  const settings = $("#settingsdlg");
  $("#settingsBtn").onclick = () => { setMenu(false); settings.showModal(); };
  $("#projectsChip").onclick = () => window.__toggleProjects && window.__toggleProjects();
  $("#settingsX").onclick = () => settings.close();
  settings.addEventListener("click", (e) => { if (e.target === settings) settings.close(); });

  const SIGNED_IN = ["#board", "#dock"];

  const mountUser = (user) => {
    const isGuest = user?.uid === GUEST_UID;
    setMenu(false);
    if (mounted) { for (const m of Object.values(mounted)) m?.unmount(); mounted = null; }
    for (const s of SIGNED_IN) $(s).hidden = true;
    paintNeeds(0);
    paintPlan(null);
    paintDone(0);
    avatar.hidden = !user;
    $("#planChip").hidden = !user;
    $("#projectsChip").hidden = !user;
    if (!user) { show("signedout"); return; }

    const displayName = user.displayName || user.email || "Guest";
    $("#who").textContent = isGuest ? "Guest · this device" : displayName;
    $("#signout").textContent = isGuest ? "Exit guest mode" : "Sign out";
    avatar.setAttribute("aria-label", isGuest ? "Guest account" : `Account: ${user.email}`);
    avatar.replaceChildren();
    const initial = () => { avatar.textContent = displayName.trim()[0].toUpperCase(); };
    if (user.photoURL) {
      const img = Object.assign(document.createElement("img"), { src: user.photoURL, alt: "", referrerPolicy: "no-referrer" });
      img.onerror = () => { img.remove(); initial(); };
      avatar.append(img);
    } else initial();
    show("signedin"); // no element of its own: just clears loading/sign-in views

    Promise.all([import("./now.js"), import("./projects.js"), import("./addtask.js"), import("./needs.js"), import("./import-trello.js"), import("./addevent.js"), import("./store.js"), import("./deadlines.js"), import("./day.js"), import("./calendar.js"), import("./schedule.js"), import("./push.js")])
      .then(([{ mountNow }, { mountProjects }, { mountAddTask }, { mountNeeds }, { mountImport, connectTrello, finishTrelloConnect, trelloConnected }, { mountAddEvent }, { migrateTasks, watchSettings, saveSettings, watchTasks, watchRun, watchDayPlan, resetAll }, { mountDeadlines }, { dayHours, minText, mealPrefs }, { watchCalendar, connectCalendar, setCalendarHint, listCalendars, saveCalendars }, { mountSchedule }, push]) => {
        if ((!isGuest && fb.currentUid() !== user.uid) || mounted) return;
        const m = mounted = {};
        setCalendarHint(isGuest ? "" : user.email);
        // Old tasks get the new fields first; then, once, which dates are real.
        const stopMigrate = migrateTasks(user.uid);
        m.migrate = { unmount: stopMigrate };
        m.deadlines = mountDeadlines($("#deadlinedlg"), user.uid);
        m.event = mountAddEvent($("#eventdlg"), { localOnly: isGuest });
        m.importer = mountImport($("#importdlg"), user.uid);
        // Reset Daisey: erase this account's Daisey data (tasks and state),
        // optionally forget the Google and Trello connections, and reload so
        // it all starts over. Never touches the calendar or Trello themselves.
        const resetBtn = $("#resetBtn"), resetPanel = $("#resetPanel"), resetMsg = $("#resetMsg"), resetGo = $("#resetGo");
        const openReset = (open) => { resetPanel.hidden = !open; resetBtn.setAttribute("aria-expanded", String(open)); resetMsg.textContent = ""; if (open) resetPanel.scrollIntoView({ block: "nearest" }); };
        resetBtn.onclick = () => openReset(resetPanel.hidden);
        $("#resetCancel").onclick = () => openReset(false);
        $("#resetDisc").parentElement.hidden = isGuest; // a guest has nothing connected
        resetGo.onclick = async () => {
          resetGo.disabled = true; resetMsg.textContent = "Erasing…";
          try {
            if (!isGuest && $("#resetDisc").checked) {
              const res = await fetch("/.netlify/functions/daisey-now-disconnect", { method: "POST",
                headers: { Authorization: `Bearer ${await fb.idToken()}`, "Content-Type": "application/json" }, body: "{}" });
              if (!res.ok && res.status !== 404) throw new Error(`disconnect ${res.status}`); // 404: nothing was connected
            }
            // Firestore answers a delete when it reaches the server, which waits offline: don't hang the reset on it.
            await Promise.race([resetAll(user.uid), new Promise((r) => setTimeout(r, 8000))]);
            for (const k of ["daisey.where.v1", "daisey.panel"]) { try { localStorage.removeItem(k); } catch { /* private window */ } }
            location.replace(location.pathname);
          } catch (e) {
            console.error("[daisey] reset", e);
            resetMsg.textContent = "Couldn't reset. Nothing more was changed after the step that failed; try again.";
            resetGo.disabled = false;
          }
        };
        // Connect Trello (import-trello.js): whether it's linked is asked once
        // here, and again each time Settings opens. A guest has no Google
        // account to link it to.
        const trelloBtn = $("#connectTrello"), trelloNote = $("#trelloNote");
        const paintTrello = (on) => {
          trelloBtn.hidden = isGuest;
          trelloBtn.textContent = on ? "Import" : "Connect";
          trelloBtn.onclick = on ? () => { $("#settingsdlg").close(); m.importer.open(); } : connectTrello;
          trelloNote.textContent = isGuest ? "Sign in first" : on ? "Connected" : "Not connected";
        };
        const checkTrello = () => { if (!isGuest) trelloConnected().then(paintTrello); else paintTrello(false); };
        $("#settingsBtn").addEventListener("click", checkTrello);
        checkTrello();
        const fail = (e) => console.error("[daisey] menu", e);
        // Day hours in the account menu (DAISEY_SPEC "Day hours"), saved on change.
        const start = $("#dayStart"), end = $("#dayEnd");
        // Finished tasks into the "Daisey log" calendar (now.js logFinished): on unless switched off.
        const logSwitch = $("#logDone");
        const laptopAsk = $("#askLaptop");
        // The morning brief (push.js): this device's switch, a test button,
        // and — while it's on anywhere — the task snapshot the server counts.
        const pushSwitch = $("#pushBrief"), pushNote = $("#pushNote"), pushTest = $("#pushTest"), pushKinds = $("#pushKinds");
        let briefOn = false, briefTasks = null, hours = dayHours({}), lastSettings = {}, briefRun = null, briefPlan = null;
        // The running task goes too: what you're actually doing beats the plan (reality.js).
        // And today's approved plan: approving it counts as doing something (miss.js).
        const snap = () => { if (briefOn && briefTasks) push.syncSnapshot(briefTasks, lastSettings, hours, briefRun, briefPlan); };
        // On screen: the card's banner asks about a missed slot, so the server doesn't (notify.js "miss").
        const seen = () => { if (briefOn && !document.hidden) push.seen(); };
        const seenTick = setInterval(seen, 60000);
        document.addEventListener("visibilitychange", seen);
        const note = (t) => { pushNote.textContent = t || ""; pushNote.hidden = !t; };
        const paintPush = () => push.deviceOn().catch(() => false).then((on) => { pushSwitch.checked = on; pushTest.hidden = !on; pushKinds.hidden = !on; });
        // Which kinds: one account-wide setting (settings.notify), the server reads it from the snapshot.
        const kindBoxes = [...pushKinds.querySelectorAll("input[data-kind]")];
        kindBoxes.forEach((b) => { b.onchange = () => saveSettings(user.uid,
          { notify: Object.fromEntries(kindBoxes.map((x) => [x.dataset.kind, x.checked])) }).catch(fail); });
        // How early the meeting reminder goes (notify.js "meeting").
        const leadPick = $("#meetingLead"), meetingBox = kindBoxes.find((b) => b.dataset.kind === "meeting");
        leadPick.onchange = () => saveSettings(user.uid, { meetingLead: Number(leadPick.value) }).catch(fail);
        if (isGuest) {
          pushSwitch.disabled = true;
          pushTest.hidden = true;
          pushKinds.hidden = true;
          note("Notifications need Google sign-in.");
        } else if (!push.pushSupported()) { pushSwitch.disabled = true; note("This browser can't show notifications."); } else paintPush();
        pushSwitch.onchange = async () => {
          pushSwitch.disabled = true; note("");
          try {
            if (pushSwitch.checked) {
              await push.enablePush(hours);
              saveSettings(user.uid, { morningBrief: true }).catch(fail);
              note(`On. The morning brief comes at ${minText(hours.start)}, when your day starts.`);
            } else await push.disablePush();
          } catch (e) {
            note({ denied: "Notifications are blocked for this site in the browser settings.", not_configured: "Not set up on the server yet.",
              unsupported: "This browser can't show notifications." }[e.code] || "Couldn't change it. Try again.");
          }
          pushSwitch.disabled = false; paintPush();
        };
        // Send the brief now: Settings closes straight away (Mor, 2026-10-06);
        // the notification itself is the answer, and a toast says if it failed.
        pushTest.onclick = async () => {
          $("#settingsdlg").close();
          try {
            const r = await push.sendTest();
            if (!r.sent) flash("The brief didn't arrive. Switch notifications off and on again.");
            else if (r.cal !== "ok") flash("Sent, but the calendar couldn't be read.");
          } catch (e) { flash("Couldn't send the brief."); }
        };
        const stopBriefTasks = watchTasks(user.uid, (ts) => { briefTasks = ts; snap(); }, fail);
        const stopBriefRun = watchRun(user.uid, (r) => { briefRun = r || null; snap(); }, fail);
        const stopBriefPlan = watchDayPlan(user.uid, (d) => { briefPlan = d || null; snap(); }, fail);
        const stopSettings = watchSettings(user.uid, (s) => {
          const hrs = dayHours(s || {});
          const usual = dayHours({ ...s, dayEndToday: null }); // the field shows the usual day, not today's stretch
          if (!dayDrag) paintDay(usual.start, usual.end);
          $("#dayTrack").dataset.end = usual.end; // saveHours: did the end move?
          paintMeals(s || {});
          logSwitch.checked = !isGuest && s?.logDone !== false;
          logSwitch.disabled = isGuest;
          laptopAsk.checked = s?.askLaptop === true;
          hours = hrs;
          lastSettings = s || {};
          briefOn = !!s?.morningBrief;
          seen();
          kindBoxes.forEach((b) => { b.checked = s?.notify?.[b.dataset.kind] !== false; });
          leadPick.value = String(s?.meetingLead ?? 10);
          leadPick.disabled = !meetingBox.checked;
          snap();
        }, fail);
        logSwitch.onchange = () => saveSettings(user.uid, { logDone: logSwitch.checked }).catch(fail);
        laptopAsk.onchange = () => saveSettings(user.uid, { askLaptop: laptopAsk.checked }).catch(fail);
        // Meal breaks (Mor, 2026-10-08): Breakfast, Lunch, Dinner, each on or
        // off, with one time (the plan puts it in the hour from there) and a
        // length. The time is a − 13:00 + stepper (Mor, 2026-10-08: not the
        // browser's clock picker): 15 min a tap, held it repeats; it saves
        // once the stepping stops, and nothing repaints under a held finger.
        const mealList = $("#mealList"), MEAL_LENS = [15, 20, 30, 45, 60, 90];
        let meals = mealPrefs({});
        const saveMeals = () => saveSettings(user.uid, { meals: meals.map((m) => ({ name: m.name, on: m.on, at: minText(m.at), minutes: m.minutes })) }).catch(fail);
        const STEP = 15;
        let stepping = null, stepSave = null;
        const stepper = (m) => {
          const read = h("output", { className: "meal-at", textContent: minText(m.at), ariaLive: "polite" });
          const nudge = (d) => {
            m.at = Math.max(0, Math.min(1440 - STEP, Math.round((m.at + d * STEP) / STEP) * STEP));
            read.textContent = minText(m.at);
            clearTimeout(stepSave); stepSave = setTimeout(() => { stepSave = null; saveMeals(); }, 700);
          };
          const btn = (d) => {
            const b = h("button", { type: "button", className: "meal-step", textContent: d < 0 ? "−" : "+", ariaLabel: `${m.name} ${d < 0 ? "earlier" : "later"}` });
            // Tap = one step; hold = keeps going. Keyboard Enter/Space = one step.
            b.addEventListener("pointerdown", (e) => {
              e.preventDefault(); nudge(d);
              let wait = 400; const go = () => { nudge(d); wait = Math.max(60, wait * 0.75); stepping = setTimeout(go, wait); };
              stepping = setTimeout(go, wait);
            });
            const stop = () => { clearTimeout(stepping); stepping = null; };
            ["pointerup", "pointerleave", "pointercancel"].forEach((t) => b.addEventListener(t, stop));
            b.addEventListener("click", (e) => { if (e.detail === 0) nudge(d); }); // keyboard only; pointer handled above
            return b;
          };
          return h("span", { className: "meal-stepper", role: "group", ariaLabel: `${m.name} time` }, btn(-1), read, btn(1));
        };
        function paintMeals(s){
          if (stepping || stepSave) return; // a later snapshot paints it
          meals = mealPrefs(s);
          mealList.replaceChildren(...meals.map((m) => h("div", { className: "meal-row" + (m.on ? "" : " off") },
            h("label", { className: "menu-check" },
              h("input", { type: "checkbox", checked: m.on, onchange: (e) => { m.on = e.target.checked; saveMeals(); } }), m.name),
            m.on && h("span", { className: "meal-when" },
              stepper(m),
              h("select", { className: "menu-select", ariaLabel: `${m.name} length`, onchange: (e) => { m.minutes = +e.target.value; saveMeals(); } },
                ...[...new Set([...MEAL_LENS, m.minutes])].sort((a, b) => a - b).map((n) => h("option", { value: n, selected: n === m.minutes, textContent: `${n} min` })))))));
        }
        // My day as one 24h bar with two handles: drag an end (or tap the bar to
        // pull the nearer end there), arrows nudge 15 min (Shift: 1 h). Saves once,
        // on release, not on every pixel.
        const SNAP = 15, MIN_SPAN = 60, track = $("#dayTrack"), fill = track.querySelector(".db-fill"), read = $("#dayRead");
        let dayS = 480, dayE = 1320, dayDrag = null;
        function paintDay(s, e){
          dayS = s; dayE = e;
          const pct = (m) => (m / 1440 * 100) + "%";
          start.style.left = pct(s); end.style.left = pct(e);
          fill.style.left = pct(s); fill.style.width = ((e - s) / 1440 * 100) + "%";
          read.textContent = `${minText(s)} – ${e === 1440 ? "24:00" : minText(e)}`;
          start.setAttribute("aria-valuenow", s); start.setAttribute("aria-valuetext", minText(s));
          end.setAttribute("aria-valuenow", e); end.setAttribute("aria-valuetext", minText(e));
        }
        // Moving the end here wins over today's stretch from Tell Daisey ("until
        // 23:00 today"), which would otherwise keep today's end where it was.
        const saveHours = () => saveSettings(user.uid, { dayStart: minText(dayS), dayEnd: minText(Math.min(dayE, 1439)),
          ...(String(dayE) !== track.dataset.end ? { dayEndToday: null } : {}) }).catch(fail);
        // Move one end, keeping at least an hour between them.
        const setEnd = (which, m) => {
          m = Math.round(m / SNAP) * SNAP;
          if (which === start) paintDay(Math.max(0, Math.min(m, dayE - MIN_SPAN)), dayE);
          else paintDay(dayS, m >= 1440 - SNAP ? 1439 : Math.max(m, dayS + MIN_SPAN)); // top of the bar = 23:59
        };
        const atX = (x) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * 1440; };
        track.addEventListener("pointerdown", (e) => {
          const m = atX(e.clientX);
          dayDrag = e.target === start || e.target === end ? e.target
            : Math.abs(m - dayS) <= Math.abs(m - dayE) ? start : end;
          track.setPointerCapture(e.pointerId);
          track.classList.add("dragging"); dayDrag.focus({ preventScroll: true });
          setEnd(dayDrag, m);
          e.preventDefault();
        });
        track.addEventListener("pointermove", (e) => { if (dayDrag) setEnd(dayDrag, atX(e.clientX)); });
        const dropDay = () => { if (!dayDrag) return; dayDrag = null; track.classList.remove("dragging"); saveHours(); };
        track.addEventListener("pointerup", dropDay);
        track.addEventListener("pointercancel", dropDay);
        [start, end].forEach((el) => el.addEventListener("keydown", (e) => {
          const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
          if (!step) return;
          e.preventDefault();
          setEnd(el, (el === start ? dayS : dayE) + step * (e.shiftKey ? 60 : SNAP));
          saveHours();
        }));
        paintDay(dayS, dayE);
        // + → Event is off while the calendar isn't connected.
        let calOk = false;
        // Settings → Integrations: Connect (or Reconnect) Google Calendar. A
        // guest has no Google account to connect, so it says so instead.
        const connectBtn = $("#connectCal"), calNote = $("#calNote");
        connectBtn.onclick = connectCalendar;
        // Choose calendars: tick which of your Google calendars Daisey reads.
        const pickBtn = $("#pickCal"), pickPanel = $("#pickPanel"), pickList = $("#pickList"), pickMsg = $("#pickMsg"), pickSave = $("#pickSave");
        const pickBoxes = () => [...pickList.querySelectorAll("input")];
        const pickCount = () => { pickSave.disabled = !pickBoxes().some((b) => b.checked); };
        const openPick = async (open) => {
          pickPanel.hidden = !open; pickBtn.setAttribute("aria-expanded", String(open)); pickMsg.textContent = "";
          if (!open) return;
          pickList.replaceChildren(); pickSave.disabled = true; pickMsg.textContent = "Loading…";
          try {
            const { calendars, chosen } = await listCalendars();
            pickList.replaceChildren(...calendars.map((c) => {
              const box = Object.assign(document.createElement("input"), { type: "checkbox", value: c.id, checked: chosen ? chosen.includes(c.id) : c.selected, onchange: pickCount });
              const dot = Object.assign(document.createElement("span"), { className: "pick-dot" });
              dot.style.background = c.color || "var(--ink-2)";
              const name = Object.assign(document.createElement("span"), { className: "pick-name", textContent: c.name || c.id, dir: "auto" });
              const label = Object.assign(document.createElement("label"), { className: "menu-check pick-row" });
              label.append(box, dot, name);
              return label;
            }));
            pickMsg.textContent = ""; pickCount();
            pickPanel.scrollIntoView({ block: "nearest" });
          } catch (e) { console.error("[daisey] calendars", e); pickMsg.textContent = "Couldn't load your calendars. Try again."; }
        };
        pickBtn.onclick = () => openPick(pickPanel.hidden);
        $("#pickCancel").onclick = () => openPick(false);
        pickSave.onclick = async () => {
          pickSave.disabled = true; pickMsg.textContent = "Saving…";
          try {
            await saveCalendars(pickBoxes().filter((b) => b.checked).map((b) => b.value));
            openPick(false); flash("Calendars saved.");
          } catch (e) { console.error("[daisey] calendars", e); pickMsg.textContent = "Couldn't save. Try again."; pickCount(); }
        };
        // Right after connecting, the choice is the first thing asked.
        if (new URLSearchParams(location.search).get("calendar") === "connected") {
          setTimeout(() => { $("#settingsdlg").showModal(); openPick(true); }, 400);
        }
        const stopCal = watchCalendar((c) => {
          calOk = c.status === "ok";
          pickBtn.hidden = isGuest || !calOk;
          connectBtn.hidden = isGuest || calOk;
          connectBtn.textContent = c.status === "needs_reauth" ? "Reconnect" : "Connect";
          calNote.textContent = isGuest ? "Sign in first" : calOk ? "Connected" : c.status === "needs_reauth" ? "Expired" : "Not connected";
        });
        m.menu = { unmount(){ stopSettings(); stopCal(); stopBriefTasks(); stopBriefRun(); stopBriefPlan(); clearInterval(seenTick); document.removeEventListener("visibilitychange", seen); start.onchange = end.onchange = logSwitch.onchange = laptopAsk.onchange = pushSwitch.onchange = pushTest.onclick = null;
          kindBoxes.forEach((b) => { b.onchange = null; }); } };

        // Full screens (a project, Needs you) sit on the history stack, so the
        // phone's Back closes them like a page.
        const screens = {
          open(kind){ if (history.state?.daisey !== kind) history.pushState({ daisey: kind }, ""); },
          back(){ if (history.state?.daisey) history.back(); else closeScreens(); },
        };
        const closeScreens = () => { m.now?.closePlan(); m.projects?.closeProject(); m.needs?.close(); $("#weekview").hidden = true; syncPanel(); };
        const onPop = () => {
          const at = history.state?.daisey;
          if (!at) closeScreens();
          else if (at !== "needs") m.needs?.close();
        };
        // The home panel: the Schedule, or Projects (the grid or one project)
        // in its place. The Projects button toggles between them (Mor, 2026-10-08).
        const syncPanel = () => {
          const on = !$("#projPage").hidden || !$("#projectview").hidden, plan = !$("#planPage").hidden;
          $("#schedPage").hidden = on || plan;
          $("#projectsChip").setAttribute("aria-pressed", String(on));
          $("#planChip").setAttribute("aria-pressed", String(plan));
          $("#panel").setAttribute("aria-label", plan ? "Plan" : on ? "Projects" : "Schedule");
        };
        window.__toggleProjects = () => {
          if (!$("#planPage").hidden) m.now?.closePlan();
          if (!$("#schedPage").hidden) { m.projects.openAll(); syncPanel(); return; }
          m.projects.closeProject(); m.projects.closeAll(); syncPanel();
          if (history.state?.daisey === "project") history.back();
        };
        addEventListener("popstate", onPop);
        m.history = { unmount(){ removeEventListener("popstate", onPop); } };
        // Start from anywhere: back to home first, then focus mode.
        const startTask = (id) => { if (history.state?.daisey) history.back(); closeScreens(); m.now?.start(id); };

        m.adder = mountAddTask($("#addtask"), user.uid, { onStart: startTask });
        m.needs = mountNeeds($("#needsview"), user.uid, { onClose: () => screens.back() });
        m.schedule = mountSchedule($("#schedPage"), user.uid, { onEvent: (ev) => m.event.view(ev), onNew: (date, at) => m.event.open(date, at), onOpen: (task) => m.adder.edit(task), });
        // ARCHIVED (Mor, 2026-10-08): the Week page is built but switched off until
        // people ask for it. To bring it back: pass onWeek to the mount above
        //   onWeek: () => { $("#weekview").hidden = false; $("#weekPage").scrollTop = 0; screens.open("week"); }
        // and mount the week page:
        //   m.week = mountSchedule($("#weekPage"), user.uid, { mode: "week", onEvent: (ev) => m.event.view(ev), onNew: (date, at) => m.event.open(date, at), onOpen: (task) => m.adder.edit(task), onDay: (ymd) => { m.schedule.go(ymd); screens.back(); } });
        //   $("#weekBack").onclick = () => screens.back();
        m.projects = mountProjects({ grid: $("#projPage"), page: $("#projPage"), view: $("#projectview"), dialog: $("#projdlg") }, user.uid, {
          onOpen: (task) => m.adder.edit(task),
          onAdd: (project) => m.adder.open(project),
          onStart: startTask,
          onScreen: (name) => { if (name) { screens.open("project"); syncPanel(); } else screens.back(); },
        });
        syncPanel();
        $("#planChip").onclick = () => m.now?.plan();
        m.now = mountNow($("#nowcard"), user.uid, {
          name: (user.displayName || "").trim().split(/\s+/)[0], onDone: paintDone, onNeedsCount: paintNeeds, onPlanProgress: paintPlan,
          planRoot: $("#planPage"),
          // Two frames so the panel and chips settle under the daisy first.
          onReady: () => requestAnimationFrame(() => requestAnimationFrame(splashOff)),
          onPlanScreen: (open) => {
            if (open) { m.projects?.closeProject(); m.projects?.closeAll(); if (history.state?.daisey === "project") history.back(); }
            $("#planPage").hidden = !open; if (open) $("#planPage").scrollTop = 0; syncPanel();
          },
          onCard: (id) => m.projects?.setCurrent(id),
          onOpen: (task) => m.adder.edit(task),
          onProject: (name) => m.projects.openProject(name),
          onEvent: (ev) => m.event.view(ev),
          onWrap: () => { m.needs.open("wrap"); screens.open("needs"); },
          guest: isGuest,
        });
        $("#needsChip").onclick = () => { m.needs.open(); screens.open("needs"); };
        // A notification's tap: "?open=wrap" on a fresh start, or a message
        // from sw.js when Daisey was already open.
        // "?open=lighter": the silence check's Lighter plan (notify.js "miss").
        const openFrom = (what) => {
          if (what === "wrap" || what === "needs") { m.needs.open(what); screens.open("needs"); }
          if (what === "lighter") { if (history.state?.daisey) history.back(); closeScreens(); m.now.lighter(); }
        };
        const params = new URL(location.href).searchParams;
        const asked = params.get("open"), startId = params.get("start"), shortenId = params.get("shorten");
        // Shared into Daisey (manifest share_target, 2026-10-06): read like a Tell message → cards.
        const shared = [...new Set(["title", "text", "url"].map((k) => (params.get(k) || "").trim()).filter(Boolean))].join("\n");
        // Back from Google's consent screen (daisey-auth-google-callback).
        const cal = params.get("calendar");
        if (cal === "connected") flash("Google Calendar connected.");
        else if (cal === "failed") flash("Couldn't connect Google Calendar. Try again.");
        if (cal) history.replaceState(history.state, "", location.pathname);
        // Back from Trello's authorize page (daisey-auth-trello-callback).
        finishTrelloConnect().then((ok) => {
          if (ok === null) return;
          flash(ok ? "Trello connected." : "Couldn't connect Trello. Try again.");
          if (ok) { paintTrello(true); m.importer.open(); }
        });
        if (asked || shared || startId || shortenId) history.replaceState(history.state, "", location.pathname);
        if (asked) openFrom(asked);
        // "Start task" on a notification (sw.js): straight into focus mode.
        const startFrom = (id) => { if (history.state?.daisey) history.back(); closeScreens(); m.now.startFromNotice(id); };
        if (startId) startFrom(startId);
        // "Shorten" on a missed slot's notification: halve it, then the card.
        const shortenFrom = (id) => { if (history.state?.daisey) history.back(); closeScreens(); m.now.shortenFromNotice(id); };
        if (shortenId) shortenFrom(shortenId);
        const onSwMessage = (e) => {
          if (e.data?.daisey === "open") openFrom(e.data.what);
          if (e.data?.daisey === "start" && e.data.id) startFrom(String(e.data.id));
          if (e.data?.daisey === "shorten" && e.data.id) shortenFrom(String(e.data.id));
          if (e.data?.daisey === "quiet") m.now.quiet();
        };
        navigator.serviceWorker?.addEventListener("message", onSwMessage);
        m.swMessages = { unmount(){ navigator.serviceWorker?.removeEventListener("message", onSwMessage); } };
        // + in the Tell Daisey pill: a task (in the project on screen, if
        // any) or a calendar event.
        const plusMenu = $("#plusMenu"), plus = $("#plus");
        const setPlus = (open) => {
          plusMenu.hidden = !open;
          plus.setAttribute("aria-expanded", String(open));
          if (open) {
            const ev = $("#plusEvent");
            ev.disabled = !calOk;
            ev.title = calOk ? "" : "Connect the calendar first";
          }
        };
        plus.onclick = (e) => { e.stopPropagation(); setPlus(plusMenu.hidden); };
        const tabProject = () => m.projects.shownProject() || undefined;
        $("#plusTask").onclick = () => { setPlus(false); m.adder.open(tabProject()); };
        $("#plusEvent").onclick = () => { setPlus(false); m.event.open(); };
        document.addEventListener("click", (e) => { if (!plusMenu.hidden && !plusMenu.contains(e.target)) setPlus(false); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") setPlus(false); });
        // Tell Daisey: plain language in, confirm cards out (tell.js).
        import("./tell.js").then(({ mountTell }) => {
          if (mounted !== m) return; // signed out while it loaded
          m.tell = mountTell($("#tell"), $("#tellInput"), $("#mic"), user.uid, {
            guest: isGuest,
            openAdd: (project, title) => m.adder.open(project ?? tabProject(), title),
            openTask: (task) => m.adder.edit(task),
          });
          if (shared) m.tell.ask(shared.slice(0, 800));
        }).catch((e) => console.error("[daisey] tell", e));
        for (const s of SIGNED_IN) $(s).hidden = false;
      }).catch((e) => console.error("[daisey] boot views", e));
  };
  if (guestMode()) mountUser({ uid: GUEST_UID, displayName: "Guest", isAnonymous: true });
  else fb.onUser(mountUser);
}
