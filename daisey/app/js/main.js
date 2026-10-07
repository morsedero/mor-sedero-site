// Boot: sign-in → load data → show card.
import { configured } from "./config.js";

const $ = (s) => document.querySelector(s);
const GUEST_KEY = "daisey_guest_mode";
const GUEST_UID = "guest-local";
const guestMode = () => { try { return localStorage.getItem(GUEST_KEY) === "1"; } catch { return false; } };

import { mountPlaces } from "./places.js";
import { flash } from "./ui.js";

// The header's chips (round 3, New Design/6): green "✓ N done" today, and
// amber "N need you", each only when there is something. now.js reports both.
// Words on both (2026-10-06): bare numbers beside "Today" read as "2 Today 0".
// The daisy itself is always the full five-petal logo.
function paintDone(n){
  $("#doneChip").hidden = !n;
  $("#doneN").textContent = String(n);
  $("#doneChip").ariaLabel = `${n === 1 ? "1 task" : `${n} tasks`} done today`;
}
function paintPlan(p){
  $("#planChip").hidden = !p;
  if (!p) return;
  $("#planN").textContent = `${p.done}/${p.total}`;
  $("#planChip").ariaLabel = `Today's plan: ${p.done} of ${p.total} done. Open it to change it`;
}
function paintNeeds(n){
  $("#needsChip").hidden = !n;
  $("#needsN").textContent = String(n);
  $("#needsW").textContent = ` need${n === 1 ? "s" : ""} you`;
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
let onGuest = () => {};
function show(view, text = ""){
  const box = $("#status");
  if (view === "signedin") { box.hidden = true; box.replaceChildren(); return; }
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
  const setMenu = (open) => { menu.hidden = !open; avatar.setAttribute("aria-expanded", String(open)); };
  avatar.onclick = (e) => { e.stopPropagation(); setMenu(menu.hidden); };
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
  $("#signout").onclick = () => {
    setMenu(false);
    try { localStorage.removeItem(GUEST_KEY); } catch { /* private window */ }
    fb.signOut().finally(() => location.reload());
  };
  // Where you are, by hand, and saved places (this device only).
  const places = mountPlaces($("#placedlg"));
  // Settings: the avatar menu's one door to everything else (Mor, 2026-10-06).
  // A tap on the dim backdrop closes it, like Escape and ✕.
  const settings = $("#settingsdlg");
  $("#settingsBtn").onclick = () => { setMenu(false); settings.showModal(); };
  $("#settingsX").onclick = () => settings.close();
  settings.addEventListener("click", (e) => { if (e.target === settings) settings.close(); });
  $("#placesBtn").onclick = () => { settings.close(); places.open(); };

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

    Promise.all([import("./now.js"), import("./projects.js"), import("./addtask.js"), import("./needs.js"), import("./import-trello.js"), import("./addevent.js"), import("./store.js"), import("./deadlines.js"), import("./day.js"), import("./calendar.js"), import("./schedule.js"), import("./push.js"), import("./briefchip.js"), import("./model.js"), import("./context.js")])
      .then(([{ mountNow }, { mountProjects }, { mountAddTask }, { mountNeeds }, { mountImport }, { mountAddEvent }, { migrateTasks, watchSettings, saveSettings, watchTasks, watchRun }, { mountDeadlines }, { dayHours, minText }, { watchCalendar, connectCalendar, setCalendarHint }, { mountSchedule }, push, { mountBriefChip }, { AREAS, LABELS }, { workBase }]) => {
        if ((!isGuest && fb.currentUid() !== user.uid) || mounted) return;
        const m = mounted = {};
        setCalendarHint(isGuest ? "" : user.email);
        // Old tasks get the new fields first; then, once, which dates are real.
        const stopMigrate = migrateTasks(user.uid);
        m.migrate = { unmount: stopMigrate };
        m.deadlines = mountDeadlines($("#deadlinedlg"), user.uid);
        m.event = mountAddEvent($("#eventdlg"), { localOnly: isGuest });
        m.importer = mountImport($("#importdlg"), user.uid);
        $("#importTrello").onclick = () => { $("#settingsdlg").close(); m.importer.open(); };
        const fail = (e) => console.error("[daisey] menu", e);
        // Day hours in the account menu (DAISEY_SPEC "Day hours"), saved on change.
        const start = $("#dayStart"), end = $("#dayEnd");
        // Finished tasks into the "Daisey log" calendar (now.js logFinished): on unless switched off.
        const logSwitch = $("#logDone");
        // The morning brief (push.js): this device's switch, a test button,
        // and — while it's on anywhere — the task snapshot the server counts.
        const pushSwitch = $("#pushBrief"), pushNote = $("#pushNote"), pushTest = $("#pushTest"), pushKinds = $("#pushKinds");
        let briefOn = false, briefTasks = null, hours = dayHours({}), lastSettings = {}, briefRun = null;
        // The running task goes too: what you're actually doing beats the plan (reality.js).
        const snap = () => { if (briefOn && briefTasks) push.syncSnapshot(briefTasks, lastSettings, hours, briefRun); };
        const note = (t) => { pushNote.textContent = t || ""; pushNote.hidden = !t; };
        const paintPush = () => push.deviceOn().catch(() => false).then((on) => { pushSwitch.checked = on; pushTest.hidden = !on; pushKinds.hidden = !on; });
        // Which kinds: one account-wide setting (settings.notify), the server reads it from the snapshot.
        const kindBoxes = [...pushKinds.querySelectorAll("input[data-kind]")];
        kindBoxes.forEach((b) => { b.onchange = () => saveSettings(user.uid,
          { notify: Object.fromEntries(kindBoxes.map((x) => [x.dataset.kind, x.checked])) }).catch(fail); });
        if (isGuest) {
          pushSwitch.disabled = true;
          pushTest.hidden = true;
          pushKinds.hidden = true;
          note("Notifications need Google sign-in.");
          $("#importTrello").disabled = true;
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
        // Weekly goals (Settings): a number per area, "N this week" beside it.
        // Blank = not set (Needs you will ask), 0 = no goal.
        const goalsBox = $("#goals");
        const goalInputs = Object.fromEntries(AREAS.map((a) => {
          const input = Object.assign(document.createElement("input"), { type: "number", min: 0, max: 50, inputMode: "numeric", id: `goal-${a}` });
          input.onchange = () => {
            const intents = { ...(lastSettings.intents || {}) };
            const n = parseInt(input.value, 10);
            if (input.value === "" || !Number.isFinite(n)) delete intents[a]; else intents[a] = Math.max(0, Math.min(50, n));
            saveSettings(user.uid, { intents }).catch(fail);
          };
          return [a, input];
        }));
        const goalDone = Object.fromEntries(AREAS.map((a) => [a, Object.assign(document.createElement("span"), { className: "goal-done" })]));
        goalsBox.replaceChildren(...AREAS.flatMap((a) => {
          const label = Object.assign(document.createElement("label"), { htmlFor: `goal-${a}`, textContent: LABELS.area[a] });
          label.append(goalDone[a]);
          return [label, goalInputs[a]];
        }));
        const paintGoals = () => {
          const done = workBase(briefTasks || []).areaDone;
          for (const a of AREAS) {
            const v = lastSettings.intents?.[a];
            if (document.activeElement !== goalInputs[a]) goalInputs[a].value = v == null ? "" : String(v);
            goalDone[a].textContent = v > 0 ? `${done[a] || 0} this week` : "";
          }
        };
        const stopBriefTasks = watchTasks(user.uid, (ts) => { briefTasks = ts; paintGoals(); snap(); }, fail);
        const stopBriefRun = watchRun(user.uid, (r) => { briefRun = r || null; snap(); }, fail);
        const stopSettings = watchSettings(user.uid, (s) => {
          const hrs = dayHours(s || {});
          const usual = dayHours({ ...s, dayEndToday: null }); // the field shows the usual day, not today's stretch
          if (document.activeElement !== start) start.value = minText(usual.start);
          if (document.activeElement !== end) end.value = minText(usual.end);
          logSwitch.checked = !isGuest && s?.logDone !== false;
          logSwitch.disabled = isGuest;
          hours = hrs;
          lastSettings = s || {};
          briefOn = !!s?.morningBrief;
          kindBoxes.forEach((b) => { b.checked = s?.notify?.[b.dataset.kind] !== false; });
          paintGoals();
          snap();
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
        // Settings → Integrations: Connect (or Reconnect) Google Calendar. A
        // guest has no Google account to connect, so it says so instead.
        const connectBtn = $("#connectCal"), calNote = $("#calNote");
        connectBtn.onclick = connectCalendar;
        const stopCal = watchCalendar((c) => {
          calOk = c.status === "ok";
          connectBtn.hidden = isGuest || calOk;
          connectBtn.textContent = c.status === "needs_reauth" ? "Reconnect Google Calendar" : "Connect Google Calendar";
          calNote.textContent = isGuest ? "Sign in with Google to connect your calendar. Guest events stay on this device."
            : calOk ? "Google Calendar is connected." : c.status === "needs_reauth" ? "The connection expired. Reconnect to bring your calendar back."
            : "Shows your day here, and Daisey plans around your events.";
        });
        m.menu = { unmount(){ stopSettings(); stopCal(); stopBriefTasks(); stopBriefRun(); start.onchange = end.onchange = logSwitch.onchange = pushSwitch.onchange = pushTest.onclick = null;
          kindBoxes.forEach((b) => { b.onchange = null; }); } };
        m.brief = mountBriefChip($("#briefChip"), $("#briefPop"), user.uid);

        // Full screens (a project, Needs you) sit on the history stack, so the
        // phone's Back closes them like a page.
        const screens = {
          open(kind){ if (history.state?.daisey !== kind) history.pushState({ daisey: kind }, ""); },
          back(){ if (history.state?.daisey) history.back(); else closeScreens(); },
        };
        const closeScreens = () => { m.projects?.closeProject(); m.projects?.closeAll(); m.needs?.close(); };
        // Back from a project lands on the Projects page when that's where it
        // was opened from (history state "projects" under "project").
        const onPop = () => {
          const at = history.state?.daisey;
          if (!at) closeScreens();
          else if (at === "projects") { m.projects?.closeProject(); m.needs?.close(); }
          else if (at !== "needs") m.needs?.close();
        };
        addEventListener("popstate", onPop);
        m.history = { unmount(){ removeEventListener("popstate", onPop); } };
        // Start from anywhere: back to home first, then focus mode.
        const startTask = (id) => { if (history.state?.daisey) history.back(); closeScreens(); m.now?.start(id); };

        m.adder = mountAddTask($("#addtask"), user.uid, { onStart: startTask });
        m.needs = mountNeeds($("#needsview"), user.uid, { onClose: () => screens.back() });
        // The home panel is the Schedule, always. Projects is its own page.
        m.schedule = mountSchedule($("#schedPage"), user.uid, { onEvent: (ev) => m.event.view(ev), onNew: (date, at) => m.event.open(date, at), onOpen: (task) => m.adder.edit(task) });
        m.projects = mountProjects({ grid: $("#projPage"), page: $("#projectsview"), view: $("#projectview"), dialog: $("#projdlg") }, user.uid, {
          onOpen: (task) => m.adder.edit(task),
          onAdd: (project) => m.adder.open(project),
          onStart: startTask,
          onScreen: (name) => (name ? screens.open("project") : screens.back()),
        });
        $("#projectsBtn").onclick = () => { m.projects.openAll(); screens.open("projects"); };
        $("#projectsBack").onclick = () => screens.back();
        $("#planBtn").onclick = () => m.now?.plan();
        $("#planChip").onclick = () => m.now?.plan();
        $("#planChip").onclick = () => m.now?.plan();
        m.now = mountNow($("#nowcard"), user.uid, {
          name: (user.displayName || "").trim().split(/\s+/)[0], onDone: paintDone, onNeedsCount: paintNeeds, onPlanProgress: paintPlan,
          onCard: (id) => m.projects?.setCurrent(id),
          onOpen: (task) => m.adder.edit(task),
          onProject: (name) => m.projects.openProject(name),
          onEvent: (ev) => m.event.view(ev),
          guest: isGuest,
        });
        $("#needsChip").onclick = () => { m.needs.open(); screens.open("needs"); };
        // A notification's tap: "?open=wrap" on a fresh start, or a message
        // from sw.js when Daisey was already open.
        const openFrom = (what) => { if (what === "wrap" || what === "needs") { m.needs.open(what); screens.open("needs"); } };
        const params = new URL(location.href).searchParams;
        const asked = params.get("open"), startId = params.get("start");
        // Shared into Daisey (manifest share_target, 2026-10-06): read like a Tell message → cards.
        const shared = [...new Set(["title", "text", "url"].map((k) => (params.get(k) || "").trim()).filter(Boolean))].join("\n");
        // Back from Google's consent screen (daisey-auth-google-callback).
        const cal = params.get("calendar");
        if (cal === "connected") flash("Google Calendar connected.");
        else if (cal === "failed") flash("Couldn't connect Google Calendar. Try again.");
        if (cal) history.replaceState(history.state, "", location.pathname);
        if (asked || shared || startId) history.replaceState(history.state, "", location.pathname);
        if (asked) openFrom(asked);
        // "Start task" on a notification (sw.js): straight into focus mode.
        const startFrom = (id) => { if (history.state?.daisey) history.back(); closeScreens(); m.now.startFromNotice(id); };
        if (startId) startFrom(startId);
        const onSwMessage = (e) => {
          if (e.data?.daisey === "open") openFrom(e.data.what);
          if (e.data?.daisey === "start" && e.data.id) startFrom(String(e.data.id));
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
