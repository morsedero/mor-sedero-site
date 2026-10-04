// Boot: sign-in → load data → show card.
import { configured } from "./config.js";

const $ = (s) => document.querySelector(s);

// The top line carries the local date and time, beside the name and the
// avatar. It ticks on the minute, not on a timer of its own frequency.
const stamp = (d = new Date()) =>
  `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
{
  const el = () => document.getElementById("clock");
  let shown = "";
  const tick = () => { const s = stamp(); if (s !== shown && el()) { shown = s; el().textContent = s; } };
  tick();
  setInterval(() => { if (!document.hidden) tick(); }, 1000);
  document.addEventListener("visibilitychange", tick);
}

// Registering a worker is what makes "add to home screen" offer a real app
// window; sw.js caches nothing on purpose.
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((e) => console.warn("[daisey] sw", e)));
}
const show = (id) => {
  for (const el of document.querySelectorAll("[data-view]")) el.hidden = el.dataset.view !== id;
};

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
  show("noconfig");
} else {
  boot().catch((e) => {
    console.error("[daisey] boot", e);
    $("#err").textContent = "Couldn't load: " + (e.message || e);
    show("error");
  });
}

async function boot(){
  const fb = await import("./firebase.js");
  let mounted = null; // { now, tasks, adder } while signed in
  let onCard = null; // task id on the Now card, shared with the board

  $("#signin").onclick = async () => {
    $("#signinMsg").textContent = "";
    try { await fb.signIn(); }
    catch (e) {
      if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
      $("#signinMsg").textContent = e.code === "auth/popup-blocked"
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

  const SIGNED_IN = ["#board", "#add"];

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

    Promise.all([import("./now.js"), import("./tasks.js"), import("./addtask.js"), import("./schedule.js"), import("./import-trello.js"), import("./addevent.js"), import("./store.js"), import("./deadlines.js"), import("./sweep.js")])
      .then(([{ mountNow }, { mountTasks }, { mountAddTask }, { mountSchedule }, { mountImport }, { mountAddEvent }, { migrateTasks }, { mountDeadlines }, { mountSweep }]) => {
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
        m.schedule = mountSchedule($("#schedule"), { onAdd: (date) => m.event.open(date) });
        m.importer = mountImport($("#importdlg"), user.uid);
        $("#importTrello").onclick = () => { setMenu(false); m.importer.open(); };
        m.tasks = mountTasks($("#tasksview"), user.uid,
          { onAdd: (project) => m.adder.open(project), onOpen: (task) => m.adder.edit(task), onSweep: () => m.sweep.open() });
        m.now = mountNow($("#nowcard"), user.uid, { onCard: (id) => { onCard = id; m.tasks?.setCurrent(id); }, onSweep: () => m.sweep.open() });
        m.tasks.setCurrent(onCard);
        $("#add").onclick = () => m.adder.open();
        for (const s of SIGNED_IN) $(s).hidden = false;
        setPane(paneFromHash());
      }).catch((e) => console.error("[daisey] boot views", e));
  });
}
