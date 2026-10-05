// Boot: sign-in → load data → show card.
import { configured } from "./config.js";

const $ = (s) => document.querySelector(s);

import { daisy } from "./look.js";
import { mountPlaces } from "./places.js";

// The header's daisy, with today's count as a small badge on it (it was a
// "N done today" pill; the badge keeps the header to one short row).
// now.js reports the count.
function paintDone(n){
  const logo = $("#logo");
  logo.replaceChildren(daisy(n, { size: 26 }));
  const badge = $("#doneBadge");
  badge.hidden = !n;
  badge.textContent = String(n);
  logo.parentElement.title = n ? `${n} done today` : "";
  badge.ariaLabel = `${n} done today`;
}
paintDone(0);


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

  const SIGNED_IN = ["#board", "#tell"];

  // One pane under the card, two tabs. The hash remembers which (#tasks), so
  // a reload or the back button lands where you were.
  const setPane = (pane) => {
    for (const [tab, view] of [["tabSchedule", "schedule"], ["tabTasks", "tasksview"]]) {
      const on = (pane === "tasks") === (tab === "tabTasks");
      $("#" + tab).setAttribute("aria-selected", String(on));
      $("#" + view).hidden = !on;
    }
  };
  const paneFromHash = () => (location.hash === "#tasks" ? "tasks" : "schedule");
  $("#tabSchedule").onclick = () => { history.replaceState(null, "", location.pathname + location.search); setPane("schedule"); };
  $("#tabTasks").onclick = () => { location.hash = "tasks"; };
  window.addEventListener("hashchange", () => { if (mounted) setPane(paneFromHash()); });

  fb.onUser((user) => {
    setMenu(false);
    if (mounted) { for (const m of Object.values(mounted)) m?.unmount(); mounted = null; }
    for (const s of SIGNED_IN) $(s).hidden = true;
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

    Promise.all([import("./now.js"), import("./tasks.js"), import("./addtask.js"), import("./schedule.js"), import("./import-trello.js"), import("./addevent.js"), import("./store.js"), import("./deadlines.js"), import("./sweep.js"), import("./day.js")])
      .then(([{ mountNow }, { mountTasks }, { mountAddTask }, { mountSchedule }, { mountImport }, { mountAddEvent }, { migrateTasks, watchSettings, saveSettings }, { mountDeadlines }, { mountSweep }, { dayHours, minText }]) => {
        if (fb.currentUid() !== user.uid || mounted) return;
        const m = mounted = {};
        // Old tasks get the new fields first; then, once, which dates are real.
        const stopMigrate = migrateTasks(user.uid);
        m.migrate = { unmount: stopMigrate };
        m.deadlines = mountDeadlines($("#deadlinedlg"), user.uid);
        m.sweep = mountSweep($("#sweepdlg"), user.uid);
        m.adder = mountAddTask($("#addtask"), user.uid, { onNow: (id) => m.now?.put(id) });
        // The Now card rides in the same scroller as the columns, first in line.
        m.event = mountAddEvent($("#eventdlg"));
        m.schedule = mountSchedule($("#schedule"), { onOpen: (ev) => m.event.view(ev), uid: user.uid, onSweep: (ids) => m.sweep.open(ids) });
        m.importer = mountImport($("#importdlg"), user.uid);
        $("#importTrello").onclick = () => { setMenu(false); m.importer.open(); };
        // Always offered: a re-import only brings cards not already here.
        const fail = (e) => console.error("[daisey] menu", e);
        // Day hours in the account menu (DAISEY_SPEC "Day hours"), saved on change.
        const start = $("#dayStart"), end = $("#dayEnd");
        // Finished tasks into the "Daisey log" calendar (now.js logFinished): on unless switched off.
        const logSwitch = $("#logDone");
        const stopSettings = watchSettings(user.uid, (s) => {
          const hrs = dayHours(s || {});
          if (document.activeElement !== start) start.value = minText(hrs.start);
          if (document.activeElement !== end) end.value = minText(hrs.end);
          logSwitch.checked = s?.logDone !== false;
        }, fail);
        logSwitch.onchange = () => saveSettings(user.uid, { logDone: logSwitch.checked }).catch(fail);
        const saveHours = () => {
          const hrs = dayHours({ dayStart: start.value, dayEnd: end.value });
          // An end before the start isn't a day: the default comes back.
          saveSettings(user.uid, { dayStart: minText(hrs.start), dayEnd: minText(hrs.end) }).catch(fail);
        };
        start.onchange = saveHours;
        end.onchange = saveHours;
        m.menu = { unmount(){ stopSettings(); start.onchange = end.onchange = logSwitch.onchange = null; } };
        m.tasks = mountTasks($("#tasksview"), user.uid,
          { onOpen: (task) => m.adder.edit(task), onSweep: () => m.sweep.open(),
          onProject: (name) => { location.hash = "tasks"; setPane("tasks"); m.tasks.showProject(name); $("#tasksview").scrollIntoView?.({ behavior: "smooth", block: "nearest" }); } });
        m.now = mountNow($("#nowcard"), user.uid, { name: (user.displayName || "").trim().split(/\s+/)[0], onDone: paintDone, ctxSlot: $("#ctxSlot"), onCard: (id) => { onCard = id; m.tasks?.setCurrent(id); }, onSweep: () => m.sweep.open(),
          onProject: (name) => { location.hash = "tasks"; setPane("tasks"); m.tasks.showProject(name); $("#tasksview").scrollIntoView?.({ behavior: "smooth", block: "nearest" }); } });
        m.tasks.setCurrent(onCard);
        // + beside Tell Daisey: the one place to add by hand. Task opens the
        // task form; Event opens the event form on the day the Today panel is
        // showing, and is off while the calendar isn't connected.
        const plusMenu = $("#plusMenu"), plus = $("#plus");
        const setPlus = (open) => {
          plusMenu.hidden = !open;
          plus.setAttribute("aria-expanded", String(open));
          if (open) {
            const ev = $("#plusEvent"), ok = m.schedule.canAdd();
            ev.disabled = !ok;
            ev.title = ok ? "" : "Connect the calendar first";
          }
        };
        plus.onclick = (e) => { e.stopPropagation(); setPlus(plusMenu.hidden); };
        // On a project's tab in Tasks, a new task starts in that project.
        const tabProject = () => (paneFromHash() === "tasks" && m.tasks.shownProject()) || undefined;
        $("#plusTask").onclick = () => { setPlus(false); m.adder.open(tabProject()); };
        $("#plusEvent").onclick = () => { setPlus(false); m.event.open(m.schedule.day()); };
        document.addEventListener("click", (e) => { if (!plusMenu.hidden && !plusMenu.contains(e.target)) setPlus(false); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") setPlus(false); });
        // Tell Daisey: plain language in, confirm cards out (tell.js).
        import("./tell.js").then(({ mountTell }) => {
          if (mounted !== m) return; // signed out while it loaded
          m.tell = mountTell($("#tell"), $("#tellInput"), $("#mic"), user.uid, { openAdd: (project, title) => m.adder.open(project ?? tabProject(), title) });
        }).catch((e) => console.error("[daisey] tell", e));
        for (const s of SIGNED_IN) $(s).hidden = false;
        setPane(paneFromHash());
      }).catch((e) => console.error("[daisey] boot views", e));
  });
}
