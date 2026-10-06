// Boot: sign-in → load data → show card.
import { configured } from "./config.js";

const $ = (s) => document.querySelector(s);

import { mountPlaces } from "./places.js";

// The header's chips (round 3, New Design/6): green "✓ N" done today, and
// amber Needs you with its count, only when there is something. now.js
// reports both. The daisy itself is always the full five-petal logo.
function paintDone(n){
  $("#doneN").textContent = String(n);
  $("#doneChip").ariaLabel = `${n === 1 ? "1 task" : `${n} tasks`} done today`;
}
function paintNeeds(n){
  $("#needsChip").hidden = !n;
  $("#needsN").textContent = String(n);
  $("#needsChip").ariaLabel = `Needs you: ${n} decision${n === 1 ? "" : "s"}`;
}


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
function show(view, text = ""){
  const box = $("#status");
  if (view === "signedin") { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  if (view === "signedout") {
    const msg = Object.assign(document.createElement("p"), { className: "msg", role: "alert" });
    const btn = Object.assign(document.createElement("button"), { className: "btn primary", type: "button", textContent: "Sign in with Google" });
    btn.onclick = () => onSignIn(msg);
    box.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Sign in to see your tasks." }), btn, msg);
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
  // Account menu under the avatar.
  const menu = $("#acctMenu"), avatar = $("#avatar");
  const setMenu = (open) => { menu.hidden = !open; avatar.setAttribute("aria-expanded", String(open)); };
  avatar.onclick = (e) => { e.stopPropagation(); setMenu(menu.hidden); };
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
  $("#signout").onclick = () => { setMenu(false); fb.signOut(); };
  // Where you are, by hand, and saved places (this device only).
  const places = mountPlaces($("#placedlg"));
  $("#placesBtn").onclick = () => { setMenu(false); places.open(); };

  const SIGNED_IN = ["#board", "#dock", "#doneChip"];


  fb.onUser((user) => {
    setMenu(false);
    if (mounted) { for (const m of Object.values(mounted)) m?.unmount(); mounted = null; }
    for (const s of SIGNED_IN) $(s).hidden = true;
    paintNeeds(0);
    avatar.hidden = !user;
    if (!user) { show("signedout"); return; }

    $("#who").textContent = user.email;
    avatar.setAttribute("aria-label", `Account: ${user.email}`);
    avatar.replaceChildren();
    const initial = () => { avatar.textContent = (user.displayName || user.email || "?").trim()[0].toUpperCase(); };
    if (user.photoURL) {
      const img = Object.assign(document.createElement("img"), { src: user.photoURL, alt: "", referrerPolicy: "no-referrer" });
      img.onerror = () => { img.remove(); initial(); };
      avatar.append(img);
    } else initial();
    show("signedin"); // no element of its own: just clears loading/sign-in views

    Promise.all([import("./now.js"), import("./projects.js"), import("./addtask.js"), import("./needs.js"), import("./import-trello.js"), import("./addevent.js"), import("./store.js"), import("./deadlines.js"), import("./day.js"), import("./calendar.js"), import("./schedule.js"), import("./panel.js"), import("./push.js"), import("./briefchip.js")])
      .then(([{ mountNow }, { mountProjects }, { mountAddTask }, { mountNeeds }, { mountImport }, { mountAddEvent }, { migrateTasks, watchSettings, saveSettings, watchTasks }, { mountDeadlines }, { dayHours, minText }, { watchCalendar }, { mountSchedule }, { mountPanel }, push, { mountBriefChip }]) => {
        if (fb.currentUid() !== user.uid || mounted) return;
        const m = mounted = {};
        // Old tasks get the new fields first; then, once, which dates are real.
        const stopMigrate = migrateTasks(user.uid);
        m.migrate = { unmount: stopMigrate };
        m.deadlines = mountDeadlines($("#deadlinedlg"), user.uid);
        m.event = mountAddEvent($("#eventdlg"));
        m.importer = mountImport($("#importdlg"), user.uid);
        $("#importTrello").onclick = () => { setMenu(false); m.importer.open(); };
        const fail = (e) => console.error("[daisey] menu", e);
        // Day hours in the account menu (DAISEY_SPEC "Day hours"), saved on change.
        const start = $("#dayStart"), end = $("#dayEnd");
        // Finished tasks into the "Daisey log" calendar (now.js logFinished): on unless switched off.
        const logSwitch = $("#logDone");
        // The morning brief (push.js): this device's switch, a test button,
        // and — while it's on anywhere — the task snapshot the server counts.
        const pushSwitch = $("#pushBrief"), pushNote = $("#pushNote"), pushTest = $("#pushTest"), pushKinds = $("#pushKinds");
        let briefOn = false, briefTasks = null, hours = dayHours({}), lastSettings = {};
        const note = (t) => { pushNote.textContent = t || ""; pushNote.hidden = !t; };
        const paintPush = () => push.deviceOn().catch(() => false).then((on) => { pushSwitch.checked = on; pushTest.hidden = !on; pushKinds.hidden = !on; });
        // Which kinds: one account-wide setting (settings.notify), the server reads it from the snapshot.
        const kindBoxes = [...pushKinds.querySelectorAll("input[data-kind]")];
        kindBoxes.forEach((b) => { b.onchange = () => saveSettings(user.uid,
          { notify: Object.fromEntries(kindBoxes.map((x) => [x.dataset.kind, x.checked])) }).catch(fail); });
        if (!push.pushSupported()) { pushSwitch.disabled = true; note("This browser can't show notifications."); } else paintPush();
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
        pushTest.onclick = async () => {
          pushTest.disabled = true;
          try {
            const r = await push.sendTest();
            note(r.sent ? `Sent: "${r.body}"${r.cal === "ok" ? "" : ` (calendar not read: ${r.cal})`}` : "It didn't arrive. Switch it off and on again.");
          }
          catch (e) { note("Couldn't send it."); }
          pushTest.disabled = false;
        };
        const stopBriefTasks = watchTasks(user.uid, (ts) => { briefTasks = ts; if (briefOn) push.syncSnapshot(ts, lastSettings, hours); }, fail);
        const stopSettings = watchSettings(user.uid, (s) => {
          const hrs = dayHours(s || {});
          if (document.activeElement !== start) start.value = minText(hrs.start);
          if (document.activeElement !== end) end.value = minText(hrs.end);
          logSwitch.checked = s?.logDone !== false;
          hours = hrs;
          lastSettings = s || {};
          briefOn = !!s?.morningBrief;
          kindBoxes.forEach((b) => { b.checked = s?.notify?.[b.dataset.kind] !== false; });
          if (briefOn && briefTasks) push.syncSnapshot(briefTasks, lastSettings, hours);
        }, fail);
        logSwitch.onchange = () => saveSettings(user.uid, { logDone: logSwitch.checked }).catch(fail);
        const saveHours = () => {
          const hrs = dayHours({ dayStart: start.value, dayEnd: end.value });
          // An end before the start isn't a day: the default comes back.
          saveSettings(user.uid, { dayStart: minText(hrs.start), dayEnd: minText(hrs.end) }).catch(fail);
        };
        start.onchange = saveHours;
        end.onchange = saveHours;
        // + → Event is off while the calendar isn't connected.
        let calOk = false;
        const stopCal = watchCalendar((c) => { calOk = c.status === "ok"; });
        m.menu = { unmount(){ stopSettings(); stopCal(); stopBriefTasks(); start.onchange = end.onchange = logSwitch.onchange = pushSwitch.onchange = pushTest.onclick = null;
          kindBoxes.forEach((b) => { b.onchange = null; }); } };
        m.brief = mountBriefChip($("#briefChip"), $("#briefPop"), user.uid);

        // Full screens (a project, Needs you) sit on the history stack, so the
        // phone's Back closes them like a page.
        const screens = {
          open(kind){ if (history.state?.daisey !== kind) history.pushState({ daisey: kind }, ""); },
          back(){ if (history.state?.daisey) history.back(); else closeScreens(); },
        };
        const closeScreens = () => { m.projects?.closeProject(); m.needs?.close(); };
        const onPop = () => { if (!history.state?.daisey) closeScreens(); else if (history.state.daisey !== "needs") m.needs?.close(); };
        addEventListener("popstate", onPop);
        m.history = { unmount(){ removeEventListener("popstate", onPop); } };
        // Start from anywhere: back to home first, then focus mode.
        const startTask = (id) => { if (history.state?.daisey) history.back(); closeScreens(); m.now?.start(id); };

        m.adder = mountAddTask($("#addtask"), user.uid, { onStart: startTask });
        m.needs = mountNeeds($("#needsview"), user.uid, { onClose: () => screens.back() });
        // The home panel: Schedule and Projects, one page each.
        m.panel = mountPanel({ panel: $("#panel"), tabs: [$("#tabSched"), $("#tabProj")], track: $("#panel .ptrack") });
        m.schedule = mountSchedule($("#schedPage"), user.uid, { onEvent: (ev) => m.event.view(ev), onNew: (date, at) => m.event.open(date, at) });
        m.projects = mountProjects({ grid: $("#projPage"), view: $("#projectview"), dialog: $("#projdlg") }, user.uid, {
          onOpen: (task) => m.adder.edit(task),
          onAdd: (project) => m.adder.open(project),
          onStart: startTask,
          onScreen: (name) => (name ? screens.open("project") : screens.back()),
        });
        m.now = mountNow($("#nowcard"), user.uid, {
          name: (user.displayName || "").trim().split(/\s+/)[0], onDone: paintDone, onNeedsCount: paintNeeds,
          onCard: (id) => m.projects?.setCurrent(id),
          onOpen: (task) => m.adder.edit(task),
          onProject: (name) => m.projects.openProject(name),
          onEvent: (ev) => m.event.view(ev),
        });
        $("#needsChip").onclick = () => { m.needs.open(); screens.open("needs"); };
        // A notification's tap: "?open=wrap" on a fresh start, or a message
        // from sw.js when Daisey was already open.
        const openFrom = (what) => { if (what === "wrap" || what === "needs") { m.needs.open(what); screens.open("needs"); } };
        const asked = new URL(location.href).searchParams.get("open");
        if (asked) { history.replaceState(history.state, "", location.pathname); openFrom(asked); }
        const onSwMessage = (e) => { if (e.data?.daisey === "open") openFrom(e.data.what); };
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
          m.tell = mountTell($("#tell"), $("#tellInput"), $("#mic"), user.uid, { openAdd: (project, title) => m.adder.open(project ?? tabProject(), title) });
        }).catch((e) => console.error("[daisey] tell", e));
        for (const s of SIGNED_IN) $(s).hidden = false;
      }).catch((e) => console.error("[daisey] boot views", e));
  });
}
