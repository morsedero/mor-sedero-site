// Boot: sign-in → load data → show card.
import { configured } from "./config.js";

const $ = (s) => document.querySelector(s);
// Focus rides inside the Now card on a phone (placeFocus), so between a
// card redraw and its re-placing it is out of the document: keep it by hand.
const focusBtn = document.getElementById("focusChip");
const GUEST_KEY = "daisey_guest_mode";
const GUEST_UID = "guest-local";
const guestMode = () => { try { return localStorage.getItem(GUEST_KEY) === "1"; } catch { return false; } };

import { flash, h, bdi, icon } from "./ui.js";
import { areaClass, greeting } from "./look.js";
// PC: "Good morning, Mor" over the card (Mor, 2026-10-13, layout B); the
// clock repaints it. app.css shows it from 1024px only.
let greetName = null;

// The header's chips (round 3, New Design/6): green "✓ N done" today, and
// amber "N need you", each only when there is something. now.js reports both.
// Words on both (2026-10-06): bare numbers beside "Today" read as "2 Today 0".
// The daisy itself is always the full five-petal logo.
// The Plan chip has two states (Mor, 2026-10-12): "Plan my day" until a plan
// is approved, then "Plan". No count: it's for planning, not a score; what's
// left shows in the day below, what's done on the home glance. While the
// morning's draft waits (now.js onPlanReady) "Plan my day" is blue and pings.
let planNow = null, planReady = false;
function paintDone(){}
function paintPlan(p){ planNow = p; paintChip(); }
// Phone: the home is the card, and Plan is the Today tile at the bottom
// (Mor, 2026-10-12). Approved, it says what's next and opens the day.
// The phone layout is every screen's up to 1023px, tablets too; from 1024px
// it's the PC layout, "B · Side rail" (Mor, 2026-10-12, canvas "Daisey PC
// Layout"): a rail on the left, the card in the middle, the day on the right.
// app.css's PHONE LAYOUT and PC LAYOUT blocks use the same width.
const phone = matchMedia("(max-width: 1023px)");
// PC: switching Today · Plan · Projects · Week morphs instead of snapping
// (Mor, 2026-10-13): the card, the panel, the glance and Tell Daisey glide
// to their new places and sizes (a view transition, app.css pc-* names).
// Phones keep their own page animation (swapAnim), which skips while this runs.
let morphing = false;
const morph = (fn) => {
  if (phone.matches || !document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return fn();
  morphing = true;
  document.startViewTransition(() => { try { fn(); } finally { morphing = false; } }).finished.catch(() => {});
};
let planNext = null;
const hm = (ms) => new Date(ms).toTimeString().slice(0, 5);
function paintNext(nx){ planNext = nx; paintChip(); }
function paintReady(on){ planReady = !!on; paintChip(); }
function paintChip(){
  const p = planNow, c = $("#planChip");
  c.hidden = false;
  c.classList.toggle("empty", !p);
  c.classList.toggle("ready", planReady && !p);
  const day = !!p && phone.matches;
  document.body.classList.toggle("has-plan", !!p);
  // Phone: the strip under the card says "Next" over the next task, "Today"
  // once the day (or a page) is open, where it shuts it (Mor, 2026-10-12).
  const dayOpen = phone.matches && document.body.classList.contains("day-open");
  const page = phone.matches && !!document.querySelector("#panel > .ppage:not([hidden]):not(#schedPage):not(.pg-ghost)");
  $("#planW").textContent = dayOpen ? "Today" : day ? (planNext && !page ? "Next" : "Today") : p ? "Plan" : "Plan my day";
  c.ariaLabel = day ? `Today${planNext ? `: next ${planNext.task.title} at ${hm(planNext.start)}` : ""}` : p ? "Today's plan. Open it to change it" : planReady ? "Plan my day: a plan is ready to look at" : "Plan my day";
  const box = $("#planNext");
  box.hidden = !day || !planNext;
  box.replaceChildren(...(day && planNext ? [
    h("span", { className: "tn-at", textContent: hm(planNext.start) }),
    h("span", { className: "tn-row" }, h("span", { className: "tn-dot" + areaClass(planNext.task) }), h("bdi", { className: "tn-name", dir: "auto", textContent: planNext.task.title })),
    h("span", { className: "tn-more", textContent: planNext.more ? `+${planNext.more} more` : "" })] : []));
}
// Approving a plan makes the chip celebrate (Mor, 2026-10-12): a pop, a ring
// out from it and the ✓ drawing itself in, once (app.css .approved).
function cheerPlan(){
  const c = $("#planChip");
  c.classList.remove("approved");
  requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add("approved")));
  clearTimeout(cheerPlan.t); cheerPlan.t = setTimeout(() => c.classList.remove("approved"), 1800);
}
// The schedule's Now button flashes the card's edge once: this is now
// (Mor, 2026-10-12; app.css .now-flash).
function flashNow(){
  const c = $(".now-card.main");
  if (!c) return;
  c.classList.remove("now-flash");
  requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add("now-flash")));
  clearTimeout(flashNow.t); flashNow.t = setTimeout(() => c.classList.remove("now-flash"), 1200);
}
function paintNeeds(n){
  $("#needsChip").hidden = !n;
  $("#needsN").textContent = String(n);
  $("#needsW").textContent = ` need${n === 1 ? "s" : ""} you`;
  $("#needsChip").ariaLabel = `Needs you: ${n} decision${n === 1 ? "" : "s"}`;
}


// Top-bar clock and date (Mor, 2026-10-08): 24h like the rest of the app,
// repainted every second, and straight away when the tab comes back.
// Full day name over the time, small seconds after it (Mor, 2026-10-12).
function paintClock(){
  const d = new Date();
  $("#hdrDay").textContent = d.toLocaleDateString("en-GB", { weekday: "long" });
  $("#hdrDate").textContent = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  $("#hdrTime").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  $("#hdrSec").textContent = ":" + String(d.getSeconds()).padStart(2, "0");
  const g = $("#pcGreet");
  g.hidden = greetName == null;
  if (greetName != null) g.textContent = greeting(greetName, d.getTime());
}
paintClock();
setInterval(() => { if (!document.hidden) paintClock(); }, 1000);
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
  const setMenu = (open) => { menu.hidden = !open; avatar.setAttribute("aria-expanded", String(open)); };
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
  // PC: two columns, the sections listed on the left (Mor, 2026-10-13,
  // layout B); a tap scrolls to one, the one in view is marked. app.css
  // shows the list from 1024px only.
  const secs = [...settings.querySelectorAll(":scope > .menu-sec")];
  const setNav = h("nav", { className: "set-nav", ariaLabel: "Settings sections" }, ...secs.map((s) =>
    h("button", { type: "button", textContent: s.querySelector(".menu-h").textContent, onclick: () => s.scrollIntoView({ block: "start", behavior: "smooth" }) })));
  settings.querySelector(".now-head").after(setNav);
  const markNav = () => {
    const top = settings.getBoundingClientRect().top;
    let at = 0; secs.forEach((s, i) => { if (s.getBoundingClientRect().top - top < 140) at = i; });
    if (settings.scrollTop + settings.clientHeight >= settings.scrollHeight - 2) at = secs.length - 1;
    [...setNav.children].forEach((b, i) => b.setAttribute("aria-current", String(i === at)));
  };
  settings.addEventListener("scroll", markNav, { passive: true });
  $("#settingsBtn").onclick = () => { setMenu(false); settings.showModal(); markNav(); };
  $("#refreshBtn").onclick = () => location.reload();
  $("#projectsChip").onclick = () => morph(() => window.__toggleProjects?.());
  $("#weekChip").onclick = () => morph(() => window.__toggleWeek?.());
  $("#todayChip").onclick = () => morph(() => window.__goToday?.());
  // Focus from the mini card (Today or the plan open on a phone) goes home
  // first, so Focus mode gets the full card (Mor, 2026-10-12).
  focusBtn.onclick = () => {
    if (document.body.classList.contains("card-mini") && !document.body.classList.contains("focus-mode")) window.__homeForFocus?.();
    mounted?.now?.focus();
  };
  // On a phone, Plan · Projects move up into the header as icons, so
  // the Now card gets the whole width (Mor, 2026-10-12: the card was crowded).
  // Wider, they go back to their column beside the card.
  // On a phone, Plan · Projects are the tiles at the bottom, over Tell
  // Daisey, and the Schedule waits behind Today (Mor, 2026-10-12: the home is
  // the card). Wider, they go back to their column beside the card.
  // Focus goes with them on a phone, a square at the row's end (Mor,
  // 2026-10-12); wider, back to the header's start.
  // The phone's bottom (Mor, 2026-10-12, home B): one row over Tell Daisey
  // on every screen, Next (the plan chip), Week, Projects and +; Focus is a
  // button on the card itself (placeFocus). #side stays empty there.
  // PC: #side is the rail's nav, under the daisy and the clock: Today, Plan,
  // Projects, Week (Mor, 2026-10-12, layout B).
  const placeSide = () => {
    if (phone.matches) { $(".nowrow").append($("#side")); $("#dockStack").append($("#planChip"), $("#weekChip"), $("#projectsChip")); $("#tell").prepend($(".plus-wrap")); }
    else { $(".brandrow").after($("#side")); $("#side").append($("#todayChip"), $("#planChip"), $("#projectsChip"), $("#weekChip")); $("#tell").prepend($(".plus-wrap")); }
    placeFocus();
    paintChip();
  };
  // Phone: Focus sits at the end of the card's top row (or its corner, on a
  // card with no top row). now.js redraws the card often, so this runs on
  // every redraw; the move itself is a no-op once it's there. Wider, it
  // goes back to the header.
  const placeFocus = () => {
    const b = focusBtn;
    if (!phone.matches) { if (b.parentElement !== $(".hdr-end")) $(".hdr-end").prepend(b); return; }
    const card = document.querySelector("#nowcard .deck > .now-card.main:not(.proposal)");
    const spot = card && (card.querySelector(":scope > .hero-top") || card);
    if (!spot) { if (b.parentElement !== $("#side")) $("#side").append(b); return; }
    if (b.parentElement !== spot) spot.append(b);
    b.classList.toggle("fc-float", spot === card);
  };
  new MutationObserver(placeFocus).observe($("#nowcard"), { childList: true, subtree: true });
  phone.addEventListener("change", placeSide); placeSide();
  // Phone, once: a hint for the swipe, gone for good after the first use
  // of it or of Next (or a tap on it).
  const HINT_KEY = "daisey_home_hint";
  let hintSeen = false;
  try { hintSeen = localStorage.getItem(HINT_KEY) === "1"; } catch { /* private window */ }
  const seenHint = () => {
    if (hintSeen) return;
    hintSeen = true; $("#homeHint").hidden = true;
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* private window */ }
  };
  $("#homeHint").onclick = seenHint;
  // Swipe up on the card or Next: Today opens; down: it shuts. Not on a
  // card that scrolls, where the swipe is the scroll.
  let swipe = null;
  document.addEventListener("touchstart", (e) => {
    const t = e.touches[0], box = e.target.closest("#nowcard");
    swipe = phone.matches && e.touches.length === 1 && !document.body.classList.contains("focus-mode")
      && e.target.closest(".nowrow, #homeHint, #planChip") && !(box && box.scrollHeight > box.clientHeight + 2) ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!swipe) return;
    const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dy) < 50 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
    const open = document.body.classList.contains("day-open");
    if (dy < 0 ? open || !document.body.classList.contains("home-float") : !open) return;
    seenHint(); window.__toggleDay?.();
  }, { passive: true });
  // Phone: Week shows done today + routines in a pop-over over the row,
  // shut by a tap anywhere else (Mor, 2026-10-12: they live in a button).
  let weekPop = false;
  const popAt = () => $("#glance").style.setProperty("--pop-b", `${Math.round(innerHeight - $("#dockStack").getBoundingClientRect().top + 10)}px`);
  addEventListener("resize", () => { if (weekPop) popAt(); });
  document.addEventListener("click", (e) => {
    if (!weekPop) return;
    const path = e.composedPath();
    if (path.includes($("#glance")) || path.includes($("#weekChip"))) return;
    weekPop = false; window.__syncPanel?.();
  });
  $("#settingsX").onclick = () => settings.close();
  settings.addEventListener("click", (e) => { if (e.target === settings) settings.close(); });

  const SIGNED_IN = ["#board", "#dock"];

  const mountUser = (user) => {
    const isGuest = user?.uid === GUEST_UID;
    setMenu(false);
    if (mounted) { for (const m of Object.values(mounted)) m?.unmount(); mounted = null; }
    for (const s of SIGNED_IN) $(s).hidden = true;
    paintNeeds(0);
    planReady = false;
    paintPlan(null);
    paintDone(0);
    avatar.hidden = !user;
    $("#planChip").hidden = !user;
    $("#projectsChip").hidden = !user;
    $("#weekChip").hidden = !user;
    $("#todayChip").hidden = !user;
    focusBtn.hidden = !user;
    greetName = user ? (isGuest ? "" : (user.displayName || "").trim().split(/\s+/)[0]) : null;
    paintClock();
    if (!user) { show("signedout"); return; }

    const displayName = user.displayName || user.email || "Guest";
    $("#who").textContent = isGuest ? "Guest · this device" : displayName;
    $("#acctName").textContent = isGuest ? "Guest" : displayName.trim().split(/\s+/)[0];
    $("#acctName").onclick = (e) => { e.stopPropagation(); avatar.click(); }; // its own click would shut the menu it just opened
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

    Promise.all([import("./now.js"), import("./projects.js"), import("./addtask.js"), import("./needs.js"), import("./import-trello.js"), import("./addevent.js"), import("./store.js"), import("./deadlines.js"), import("./day.js"), import("./calendar.js"), import("./schedule.js"), import("./push.js"), import("./sample.js")])
      .then(([{ mountNow }, { mountProjects }, { mountAddTask }, { mountNeeds }, { mountImport, connectTrello, finishTrelloConnect, trelloConnected }, { mountAddEvent }, { migrateTasks, watchSettings, saveSettings, watchTasks, watchRun, watchDayPlan, resetAll, guestFresh, seedGuest, seedAccountOnce }, { mountDeadlines }, { dayHours, minText, mealPrefs, usualHours }, { watchCalendar, connectCalendar, setCalendarHint, listCalendars, saveCalendars }, { mountSchedule }, push, { sampleDay }]) => {
        if ((!isGuest && fb.currentUid() !== user.uid) || mounted) return;
        const m = mounted = {};
        // A new guest opens to a sample day, not an empty card (sample.js).
        if (isGuest && guestFresh()) seedGuest(sampleDay({ hours: dayHours({}) }));
        // …and so does a brand-new Google account, once (store.seedAccountOnce).
        if (!isGuest) seedAccountOnce(user.uid, () => sampleDay({ hours: dayHours({}) })).catch((e) => console.warn("[daisey] sample", e.message || e));
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
        // Reset sample: a guest's way back to the sample day, laid for now.
        const sampleBtn = $("#sampleBtn");
        sampleBtn.hidden = !isGuest;
        sampleBtn.onclick = () => {
          try { seedGuest(sampleDay({ hours: dayHours({}) })); location.replace(location.pathname); }
          catch (e) { console.error("[daisey] sample", e); resetMsg.textContent = "Couldn't lay the sample day. Try again."; }
        };
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
        // Laid out like Google's row (Mor, 2026-10-10): status on the right,
        // what you can do with it (Import cards…) under the name.
        const trelloBtn = $("#connectTrello"), trelloNote = $("#trelloNote"), importBtn = $("#importTrello");
        trelloBtn.onclick = connectTrello;
        importBtn.onclick = () => { $("#settingsdlg").close(); m.importer.open(); };
        const paintTrello = (on) => {
          trelloBtn.hidden = isGuest || on;
          importBtn.hidden = isGuest || !on;
          connNote(trelloNote, isGuest ? "Sign in first" : on ? "Connected" : "Not connected");
        };
        const checkTrello = () => { if (!isGuest) trelloConnected().then(paintTrello); else paintTrello(false); };
        $("#settingsBtn").addEventListener("click", checkTrello);
        checkTrello();
        const fail = (e) => console.error("[daisey] menu", e);
        // Status is a dot (Mor, 2026-10-10): green connected, amber expired,
        // grey not connected; the words are its label, and the button beside it acts.
        function connNote(el, text){
          el.className = "conn-dot " + ({ Connected: "on", Expired: "expired" }[text] || "off");
          el.setAttribute("role", "img"); el.setAttribute("aria-label", text); el.title = text;
        }
        // Day hours in the account menu (DAISEY_SPEC "Day hours"), saved on change.
        const start = $("#dayStart"), end = $("#dayEnd");
        // Finished tasks into the "Daisey log" calendar (now.js logFinished): on unless switched off.
        const logSwitch = $("#logDone");
        const focusPick = $("#focusMax");
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
        // The folded drop list says how many are on; the reminder greys out with Meetings off.
        const paintKinds = () => {
          $("#kindCount").textContent = `${kindBoxes.filter((b) => b.checked).length} of ${kindBoxes.length}`;
          leadPick.disabled = !meetingBox.checked;
        };
        kindBoxes.forEach((b) => { b.onchange = () => { paintKinds(); saveSettings(user.uid,
          { notify: Object.fromEntries(kindBoxes.map((x) => [x.dataset.kind, x.checked])) }).catch(fail); }; });
        // How early the meeting reminder goes (notify.js "meeting").
        const leadPick = $("#meetingLead"), meetingBox = kindBoxes.find((b) => b.dataset.kind === "meeting");
        paintKinds();
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
        // Send the brief now, from the avatar menu (Mor, 2026-10-10): the menu
        // closes straight away; the notification itself is the answer, and a
        // toast says if it failed.
        pushTest.onclick = async () => {
          setMenu(false);
          try {
            const r = await push.sendTest();
            if (!r.sent) flash("The brief didn't arrive. Switch notifications off and on again.");
            else if (r.cal !== "ok") flash("Sent, but the calendar couldn't be read.");
          } catch (e) { flash("Couldn't send the brief."); }
        };
        const stopBriefTasks = watchTasks(user.uid, (ts) => { briefTasks = ts; snap(); }, fail);
        const stopBriefRun = watchRun(user.uid, (r) => { briefRun = r || null; snap(); }, fail);
        const stopBriefPlan = watchDayPlan(user.uid, (d) => { briefPlan = d || null; snap(); }, fail);
        logSwitch.onchange = () => saveSettings(user.uid, { logDone: logSwitch.checked }).catch(fail);
        // Focus's size, back in Settings (Mor, 2026-10-11; projects.js shows it as dots).
        focusPick.onchange = () => saveSettings(user.uid, { focusMax: Number(focusPick.value) }).catch(fail);
        // Meal breaks (Mor, 2026-10-08): Breakfast, Lunch, Dinner, each on or
        // off, with one time (the plan puts it in the hour from there) and a
        // length. Each reads as one line, "13:00 · 60 min"; tap it to change
        // (Mor, 2026-10-10). The time is a − 13:00 + stepper (Mor, 2026-10-08:
        // not the browser's clock picker): 15 min a tap, held it repeats; it
        // saves once the stepping stops, and nothing repaints under a held finger.
        const mealList = $("#mealList"), MEAL_LENS = [15, 20, 30, 45, 60, 90];
        let meals = mealPrefs({}), mealOpen = null;
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
          drawMeals();
        }
        function drawMeals(){
          mealList.replaceChildren(...meals.map((m) => h("div", { className: "meal-row" + (m.on ? "" : " off") + (mealOpen === m.name ? " open" : "") },
            h("label", { className: "menu-check" },
              h("input", { type: "checkbox", checked: m.on, onchange: (e) => { m.on = e.target.checked; if (!m.on && mealOpen === m.name) mealOpen = null; saveMeals(); drawMeals(); } }), m.name),
            m.on && (mealOpen === m.name
              ? h("span", { className: "meal-when" },
                  stepper(m),
                  h("select", { className: "menu-select", ariaLabel: `${m.name} length`, onchange: (e) => { m.minutes = +e.target.value; saveMeals(); } },
                    ...[...new Set([...MEAL_LENS, m.minutes])].sort((a, b) => a - b).map((n) => h("option", { value: n, selected: n === m.minutes, textContent: `${n} min` }))),
                  // Done: folds back to its line (Mor, 2026-10-10: an edit needs an end).
                  h("button", { type: "button", className: "meal-ok", ariaLabel: `Done with ${m.name}`, title: "Done",
                    onclick: () => { mealOpen = null; drawMeals(); } }, icon("check")))
              : h("button", { type: "button", className: "meal-sum", textContent: `${minText(m.at)} · ${m.minutes} min`, ariaLabel: `${m.name} at ${minText(m.at)}, ${m.minutes} minutes. Change`,
                  onclick: () => { mealOpen = m.name; drawMeals(); } })))));
        }
        // A tap anywhere else in Settings, or closing it, folds the open meal back to its line.
        const settingsDlg = $("#settingsdlg");
        const foldMeal = (e) => { if (mealOpen && !e.composedPath().includes(mealList)) { mealOpen = null; drawMeals(); } };
        const shutMeal = () => { if (mealOpen) { mealOpen = null; drawMeals(); } };
        settingsDlg.addEventListener("click", foldMeal);
        settingsDlg.addEventListener("close", shutMeal);
        // My day as one 24h bar with two handles: drag an end (or tap the bar to
        // pull the nearer end there), arrows nudge 15 min (Shift: 1 h). Saves once,
        // on release, not on every pixel.
        // The bar runs 04:00 to 04:00 (Mor 2026-10-11), so a
        // night owl's day can end past midnight: 02:00 is 26:00 here.
        const SNAP = 15, MIN_SPAN = 60, BAR0 = 240, track = $("#dayTrack"), fill = track.querySelector(".db-fill");
        let dayS = 480, dayE = 1320, dayDrag = null;
        function paintDay(s, e){
          dayS = s = Math.max(BAR0, s); dayE = e;
          const pct = (m) => ((m - BAR0) / 1440 * 100) + "%";
          start.style.left = pct(s); end.style.left = pct(e);
          fill.style.left = pct(s); fill.style.width = ((e - s) / 1440 * 100) + "%";
          start.dataset.t = minText(s); end.dataset.t = minText(e); // midnight reads 00:00 (Mor, 2026-10-11)
          start.setAttribute("aria-valuenow", s); start.setAttribute("aria-valuetext", minText(s));
          end.setAttribute("aria-valuenow", e); end.setAttribute("aria-valuetext", minText(e));
        }
        // Moving the end here wins over today's stretch from Tell Daisey ("until
        // 23:00 today"), which would otherwise keep today's end where it was.
        const saveHours = () => saveSettings(user.uid, { dayStart: minText(dayS), dayEnd: minText(Math.min(dayE, BAR0 + 1439)),
          ...(String(dayE) !== track.dataset.end ? { dayEndToday: null } : {}) }).catch(fail);
        // Move one end, keeping at least an hour between them.
        const setEnd = (which, m) => {
          m = Math.round(m / SNAP) * SNAP;
          if (which === start) paintDay(Math.max(BAR0, Math.min(m, dayE - MIN_SPAN)), dayE);
          else paintDay(dayS, m >= BAR0 + 1440 - SNAP ? BAR0 + 1439 : Math.max(m, dayS + MIN_SPAN)); // top of the bar = 03:59
        };
        const atX = (x) => { const r = track.getBoundingClientRect(); return BAR0 + Math.max(0, Math.min(1, (x - r.left) / r.width)) * 1440; };
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
        // Watched only now: a guest store answers at once, and the callback reads
        // dayDrag, paintMeals and the meal state declared above.
        const stopSettings = watchSettings(user.uid, (s) => {
          const hrs = dayHours(s || {});
          const usual = usualHours(s || {}); // the field shows the usual day, not today's stretch
          if (!dayDrag) paintDay(usual.start, usual.end);
          $("#dayTrack").dataset.end = usual.end; // saveHours: did the end move?
          paintMeals(s || {});
          logSwitch.checked = !isGuest && s?.logDone !== false;
          logSwitch.disabled = isGuest;
          focusPick.value = String(s?.focusMax ?? 3);
          // After midnight a late day reads { start: 0 }; the server gets the usual one.
          hours = hrs.late ? usual : hrs;
          lastSettings = s || {};
          briefOn = !!s?.morningBrief;
          seen();
          kindBoxes.forEach((b) => { b.checked = s?.notify?.[b.dataset.kind] !== false; });
          leadPick.value = String(s?.meetingLead ?? 10);
          paintKinds();
          snap();
        }, fail);
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
          connNote(calNote, isGuest ? "Sign in first" : calOk ? "Connected" : c.status === "needs_reauth" ? "Expired" : "Not connected");
        });
        m.menu = { unmount(){ stopSettings(); stopCal(); stopBriefTasks(); stopBriefRun(); stopBriefPlan(); clearInterval(seenTick); document.removeEventListener("visibilitychange", seen); settingsDlg.removeEventListener("click", foldMeal); settingsDlg.removeEventListener("close", shutMeal); start.onchange = end.onchange = logSwitch.onchange = pushSwitch.onchange = pushTest.onclick = null;
          kindBoxes.forEach((b) => { b.onchange = null; }); } };

        const closeScreens = () => { $("#weekPage").hidden = true; m.now?.closePlan(); m.projects?.closeProject(); m.needs?.close(); syncPanel(); };
        // The phone's Back never leaves the app (Mor, 2026-10-15). History
        // holds [base, home]; Back pops home, we close the topmost open
        // window and push home again. Nothing open: Back leaves.
        const topLayer = () => {
          const dlg = [...document.querySelectorAll("dialog[open]")].pop();
          if (dlg) return () => { if (dlg.dispatchEvent(new Event("cancel", { cancelable: true }))) dlg.close(); };
          if (!$("#acctMenu").hidden || !$("#plusMenu").hidden) return () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
          if (!$("#needsview").hidden) return () => m.needs.close();
          if (!$("#projectview").hidden) return () => m.projects.closeProject();
          if (!$("#projPage").hidden) return () => m.projects.closeAll();
          if (!$("#planPage").hidden) return () => m.now?.closePlan();
          if (!$("#weekPage").hidden) return () => { $("#weekPage").hidden = true; };
          if (weekPop) return () => { weekPop = false; };
          if (document.body.classList.contains("day-open")) return () => document.body.classList.remove("day-open");
          return null;
        };
        const guard = () => history.pushState({ daisey: "home" }, "");
        const onPop = () => {
          if (history.state?.daisey !== "base") return; // forward onto home
          const close = topLayer();
          if (close) { guard(); close(); syncPanel(); return; }
          window.__backArmed = false; history.back(); // nothing open: leave
        };
        // Chrome skips history entries made before the first tap, so the guard
        // goes in on the first one. Touch screens only: a computer's Back stays a Back.
        const armGuard = () => {
          if (window.__backArmed) return;
          window.__backArmed = true; history.replaceState({ daisey: "base" }, ""); guard();
        };
        if (matchMedia("(pointer: coarse)").matches && !window.__backArmed) {
          // A touch counts as a tap on its release (pointerup), not on pointerdown.
          for (const t of ["pointerup", "click", "keydown"]) addEventListener(t, armGuard, { capture: true });
        }
        // The home panel: the Schedule, or Projects (the grid or one project)
        // in its place. The Projects button toggles between them (Mor, 2026-10-08).
        let schedShown = false;
        const syncPanel = () => {
          const on = !$("#projPage").hidden || !$("#projectview").hidden, plan = !$("#planPage").hidden;
          // PC: Week is its own page, the week grid (Mor, 2026-10-13); the plan
          // or Projects opening shuts it.
          if (on || plan || phone.matches) $("#weekPage").hidden = true;
          const week = !$("#weekPage").hidden;
          $("#schedPage").hidden = on || plan || week;
          if (on || plan) document.body.classList.remove("day-open");
          const day = document.body.classList.contains("day-open");
          // Phone, nothing open: the card floats mid-screen, as Focus mode did (app.css).
          document.body.classList.toggle("home-float", phone.matches && !day && !(on || plan));
          // Phone, Today open (the day or the plan): the card goes mini, so the
          // day gets the room (Mor, 2026-10-12; app.css).
          // PC: with Projects or Week open the card is a bar over the page,
          // Done at its end (Mor, 2026-10-13, layout B).
          document.body.classList.toggle("card-mini", phone.matches ? day || plan : on || week);
          // The glance (done today, routines): on a phone it's Week's
          // pop-over, over whatever is open (Mor, 2026-10-12: they live in a
          // button). PC: under the card, and over the week grid (layout B).
          const glance = phone.matches ? weekPop : !on;
          $("#homeHint").hidden = hintSeen || glance || !(phone.matches && !day && !(on || plan));
          $("#glance").classList.toggle("pop", phone.matches);
          if (phone.matches && glance) popAt();
          $("#glance").hidden = !glance;
          $("#weekChip").setAttribute("aria-pressed", String(phone.matches ? glance : week));
          $("#projectsChip").setAttribute("aria-pressed", String(on));
          $("#todayChip").setAttribute("aria-pressed", String(!(on || plan || week)));
          $("#planChip").setAttribute("aria-pressed", String(plan || day));
          $("#panel").setAttribute("aria-label", plan ? "Plan" : on ? "Projects" : week ? "Week" : "Schedule");
          // Today coming into view lands on its now row, on top (Mor, 2026-10-12).
          const sched = $("#schedPage").getClientRects().length > 0;
          if (sched && !schedShown) m.schedule?.landNow();
          schedShown = sched;
          paintChip();
          swapAnim();
        };
        // Page swaps animate (Mor, 2026-10-12): the one leaving stays a moment
        // as an inert copy over the new one (ids kept so its page styles hold;
        // it sits after the real ones, so $ never finds it) and fades out; then
        // the page coming in rises and fades in (app.css). Back to the
        // Schedule drops in from above.
        let shownPage = null, fmTimer = 0;
        const swapAnim = () => {
          const now = [...$("#panel").children].find((p) => p.classList.contains("ppage") && !p.hidden && !p.classList.contains("pg-ghost"));
          const was = shownPage; shownPage = now;
          // A hidden panel (the phone's home) never runs the animation, so its
          // ghost would never go: no swap animation there.
          if (morphing || !was || !now || was === now || !$("#panel").offsetParent || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
          const back = now.id === "schedPage";
          $("#panel .pg-ghost")?.remove();
          const g = was.cloneNode(true);
          g.hidden = false; g.inert = true; g.setAttribute("aria-hidden", "true");
          g.classList.add("pg-ghost", back ? "out-down" : "out-up");
          Object.assign(g.style, { top: now.offsetTop + "px", left: now.offsetLeft + "px", width: now.offsetWidth + "px", height: now.offsetHeight + "px" });
          $("#panel").append(g);
          g.scrollTop = g.dataset.st || 0;
          g.classList.remove("pg-in", "pg-back");
          g.addEventListener("animationend", (e) => { if (e.target === g) g.remove(); });
          setTimeout(() => g.remove(), 400); // a backgrounded tab never ends it
          now.classList.remove("pg-in", "pg-back"); void now.offsetWidth;
          now.classList.add(back ? "pg-back" : "pg-in");
          const done = (e) => { if (e.target !== now) return; now.classList.remove("pg-in", "pg-back"); now.removeEventListener("animationend", done); };
          now.addEventListener("animationend", done);
        };
        phone.addEventListener("change", syncPanel);
        $("#panel").addEventListener("scroll", (e) => { if (e.target.classList?.contains("ppage")) e.target.dataset.st = e.target.scrollTop; }, true);
        // Phone: the Today tile opens the day under the card, and shuts it.
        window.__toggleDay = () => {
          const open = !document.body.classList.contains("day-open");
          if (open) { m.now?.closePlan(); m.projects.closeProject(); m.projects.closeAll(); }
          document.body.classList.toggle("day-open", open); syncPanel();
        };
        // Week: done today + routines under the card, on or off (Mor,
        // 2026-10-12). From a page it closes the page and turns them on.
        window.__syncPanel = syncPanel;
        window.__homeForFocus = () => { if (!$("#planPage").hidden) m.now?.closePlan(); document.body.classList.remove("day-open"); syncPanel(); };
        // PC: Week opens the week grid as its own page (schedule.js mode
        // "week", mounted the first time), over the middle and the right;
        // a weekday's heading opens that day back in Today.
        window.__toggleWeek = () => {
          if (phone.matches) { weekPop = !weekPop; syncPanel(); return; }
          const open = $("#weekPage").hidden;
          if (!$("#planPage").hidden) m.now?.closePlan();
          m.projects.closeProject(); m.projects.closeAll();

          $("#weekPage").hidden = !open;
          if (open) m.week ??= mountSchedule($("#weekPage"), user.uid, { mode: "week", onEvent: (ev) => m.event.view(ev), onNew: (date, at) => m.event.open(date, at), onOpen: (task) => m.adder.edit(task),
            onDay: (ymd) => { $("#weekPage").hidden = true; syncPanel(); m.schedule?.go(ymd); } });
          syncPanel();
        };
        // PC: the rail's Today, back to the day in the right column.
        window.__goToday = () => {
          $("#weekPage").hidden = true;
          if (!$("#planPage").hidden) m.now?.closePlan();
          m.projects.closeProject(); m.projects.closeAll(); syncPanel();

        };
        window.__toggleProjects = () => {
          if (!$("#planPage").hidden) m.now?.closePlan();
          const fromWeek = !$("#weekPage").hidden;
          $("#weekPage").hidden = true;
          if (!$("#schedPage").hidden || fromWeek) { m.projects.openAll(); syncPanel(); return; }
          m.projects.closeProject(); m.projects.closeAll(); syncPanel();

        };
        addEventListener("popstate", onPop);
        m.history = { unmount(){ removeEventListener("popstate", onPop); } };
        // The task sheet's Focus: back to home, that task on the card, Focus
        // mode on (Mor, 2026-10-10; no clock, no Deep Focus).
        const startTask = (id) => { closeScreens(); m.now?.start(id); };

        m.adder = mountAddTask($("#addtask"), user.uid, { onStart: startTask });
        m.needs = mountNeeds($("#needsview"), user.uid, {
          // then: what to open once Needs you is shut.
          onClose: (then) => { m.needs.close(); syncPanel(); then?.(); },
          onStart: startTask,
          extra: () => m.now?.needsAsks() || [],
          // Back after days away: the catch-up opens by itself (needs.js
          // awayCheck), unless a link or another screen got there first.
          onAway: () => {
            const q = new URL(location.href).searchParams;
            if (q.has("open") || q.has("start") || !$("#needsview").hidden || !$("#projectview").hidden) return;
            m.needs.open();
          } });
        m.schedule = mountSchedule($("#schedPage"), user.uid, { onEvent: (ev) => m.event.view(ev), onNew: (date, at) => m.event.open(date, at), onOpen: (task) => m.adder.edit(task), onMissed: (id, start) => m.now?.missed(id, start), onNow: flashNow, onPlan: () => m.now?.plan() });
        m.projects = mountProjects({ grid: $("#projPage"), page: $("#projPage"), glance: $("#glance"), view: $("#projectview"), dialog: $("#projdlg") }, user.uid, {
          onOpen: (task) => m.adder.edit(task),
          onAdd: (project) => m.adder.open(project),
          onStart: startTask,
          onScreen: () => syncPanel(),
        });
        syncPanel();
        $("#planChip").onclick = () => { seenHint(); if (phone.matches && (planNow || document.body.classList.contains("day-open"))) window.__toggleDay(); else morph(() => m.now?.plan()); };
        m.now = mountNow($("#nowcard"), user.uid, {
          name: isGuest ? "" : (user.displayName || "").trim().split(/\s+/)[0], onDone: paintDone, onNeedsCount: paintNeeds, onPlanProgress: paintPlan, onPlanNext: paintNext,
          onPlanReady: paintReady, onPlanApproved: cheerPlan,
          onFocusMode: (on) => {
            const b = focusBtn, was = b.getAttribute("aria-pressed") === "true";
            b.setAttribute("aria-pressed", String(on)); b.ariaLabel = on ? "Focus mode on: tap to show everything" : "Focus mode: only the Now card";
            // fm-in / fm-out run the CSS on and off motions, once, on a real change.
            if (on === was) return;
            document.body.classList.remove("fm-in", "fm-out"); void document.body.offsetWidth;
            document.body.classList.add(on ? "fm-in" : "fm-out");
            clearTimeout(fmTimer); fmTimer = setTimeout(() => document.body.classList.remove("fm-in", "fm-out"), 1900);
            // Once the card lands, a teal ring goes out from it. Run here, on
            // the card there is then, beside its idle bob rather than in place of it.
            if (on && !matchMedia("(prefers-reduced-motion: reduce)").matches) setTimeout(() => {
              const c = document.querySelector("body.focus-mode .deck > .now-card.main"); if (!c) return;
              const ink = getComputedStyle(c).getPropertyValue("--p-teal-ink").trim() || "teal";
              c.animate([{ boxShadow: `0 0 0 0 color-mix(in srgb, ${ink} 45%, transparent)` }, { boxShadow: "0 0 0 16px transparent" }], { duration: 1100, easing: "ease-out" });
            }, 600);
            // Slow slide (Mor, 2026-10-12): the Now card and the Focus chip glide
            // from where they were to where the mode puts them. Measured now, and
            // again once now.js has toggled body.focus-mode (after this returns).
            // #nowcard is a scroll box and would clip the card mid-slide, so it
            // lets it out until the slide ends.
            if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            const T = { duration: 650, easing: "cubic-bezier(.4, 0, .2, 1)" };
            // On a phone the chip rides inside the card, so it moves with it.
            const pick = () => [document.querySelector(".deck > .now-card.main"), b.closest(".now-card") ? null : b];
            // The card grows into its new size by really growing: its width and
            // every value the focus-mode CSS changes (padding, type sizes, button
            // sizes) run from the old value to the new, so the text grows with
            // it. A scale of the whole card, or a width/height-only grow, left the
            // text at its new size from the first frame.
            const PARTS = [
              ["", ["width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderRadius"]],
              [".now-title", ["marginTop", "fontSize", "lineHeight", "letterSpacing"]],
              [".now-why", ["fontSize", "lineHeight"]],
              [".now-row", ["paddingTop", "columnGap"]],
              [".now-row .iconbtn", ["width", "minWidth", "height", "minHeight", "borderRadius", "fontSize", "lineHeight", "rowGap", "columnGap", "flexBasis"]],
              [".now-row .iconbtn svg", ["width", "height"]],
              [".now-row .btn.start", ["height", "minHeight", "borderRadius"]],
            ];
            const parts = (card) => PARTS.map(([sel]) => (sel ? [...card.querySelectorAll(sel)] : [card]));
            const grab = (card) => parts(card).map((es, i) => es.map((e) => {
              const cs = getComputedStyle(e);
              // Keywords don't animate (they flip halfway); swap in their px.
              // flexBasis: the buttons are "flex: 0 1 46px", so their basis, not their
              // width, sets the size; animate it as the size they really have.
              const v = (p) => p === "flexBasis" ? e.getBoundingClientRect().width + "px" : (cs[p] === "normal" && p === "letterSpacing") || (cs[p] === "auto" && p.startsWith("min")) ? "0px" : cs[p];
              return Object.fromEntries(PARTS[i][1].map((p) => [p, v(p)]));
            }));
            const first = pick().map((el) => el?.getBoundingClientRect());
            const old = pick()[0] && grab(pick()[0]);
            // The card's idle bob rests while it slides (app.css .fm-slide) and
            // starts again from rest where the slide ends. Run together, Chrome
            // painted a frame with the slide's offset wrong, a snap on the click
            // and on each rebuild mid-slide (Mor, 2026-10-12). Measured above
            // with the bob on, so the slide starts exactly where the card was.
            document.body.classList.add("fm-slide");
            const rest = () => { if (!document.body.classList.contains("fm-slide")) return; m.now?.breatheFromRest(); document.body.classList.remove("fm-slide"); };
            setTimeout(rest, T.duration);
            queueMicrotask(() => pick().forEach((el, i) => {
              const a = first[i]; if (!el || !a) { if (!i) rest(); return; }
              const z = el.getBoundingClientRect(), dx = a.left - z.left, dy = a.top - z.top;
              if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(a.width - z.width) < 1 && Math.abs(a.height - z.height) < 1) { if (!i) rest(); return; }
              if (i) { el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], T); return; }
              // From/to per part (matched by index; a part whose count changed
              // just takes its new size). The start offset is measured with the
              // old values on, since in Focus the card's spot depends on its size.
              const now = grab(el), K = [];
              now.forEach((es, p) => es.forEach((to, j) => {
                const from = old?.[p]?.[j]; if (!from) return;
                const f = {}, t = {};
                for (const k in to) if (from[k] !== to[k]) { f[k] = from[k]; t[k] = to[k]; }
                if (Object.keys(f).length) K.push([p, j, f, t]);
              }));
              const set = (card, which) => K.forEach(([p, j, f]) => { const e = parts(card)[p][j]; if (e) for (const k in f) e.style[k] = which ? f[k] : ""; });
              set(el, 1); const s = el.getBoundingClientRect(); set(el, 0);
              const move = [{ transform: `translate(${a.left - s.left}px, ${a.top - s.top}px)` }, { transform: "none" }];
              let anims = [];
              const run = (card, t) => {
                const ps = parts(card);
                anims = [card.animate(move, T), ...K.filter(([p, j]) => ps[p][j]).map(([p, j, f, to]) => ps[p][j].animate([f, to], T))];
                // Started now, not on the next frame (a pending start held the
                // new card a frame without its slide offset).
                const now = document.timeline.currentTime;
                anims.forEach((x) => { x.startTime = now - t; });
                anims.card = card;
              };
              run(el, 0);
              // now.js re-renders #nowcard twice in the next ~50ms, swapping in a
              // new card each time, so the slide ran on a detached card and the
              // real one just jumped. Hand the running animations to each new card.
              const box = $("#nowcard");
              box.style.overflow = "visible"; box.style.position = "relative"; box.style.zIndex = "3";
              const mo = new MutationObserver(() => {
                const c = pick()[0]; if (!c || c === anims.card) return;
                const t = anims[0].currentTime; anims.forEach((x) => x.cancel()); run(c, t);
              });
              mo.observe(box, { childList: true, subtree: true });
              // Turning on, the box stays open for the teal ring too (600ms in,
              // 1.1s long), or the scroll box cut it off square.
              setTimeout(() => { mo.disconnect(); box.style.overflow = box.style.position = box.style.zIndex = ""; }, on ? 1750 : T.duration);
            }));
          },
          planRoot: $("#planPage"),
          // Two frames so the panel and chips settle under the daisy first.
          onReady: () => requestAnimationFrame(() => requestAnimationFrame(splashOff)),
          onPlanScreen: (open) => {
            if (open) { m.projects?.closeProject(); m.projects?.closeAll(); }
            $("#planPage").hidden = !open; if (open) $("#planPage").scrollTop = 0; syncPanel();
          },
          onCard: (id) => m.projects?.setCurrent(id),
          onOpen: (task) => m.adder.edit(task),
          onProject: (name) => m.projects.openProject(name),
          onEvent: (ev) => m.event.view(ev),
          onWrap: () => { m.needs.open("wrap"); },
          missDialog: $("#missdlg"),
          guest: isGuest,
        });
        $("#needsChip").onclick = () => { m.needs.open(); };
        // A notification's tap: "?open=wrap" on a fresh start, or a message
        // from sw.js when Daisey was already open.
        // "?open=lighter": the silence check's Lighter plan (notify.js "miss").
        const openFrom = (what) => {
          if (what === "wrap" || what === "needs") { m.needs.open(what); }
          if (what === "lighter") { closeScreens(); m.now.lighter(); }
        };
        const params = new URL(location.href).searchParams;
        const asked = params.get("open"), startId = params.get("start");
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
        if (asked || shared || startId) history.replaceState(history.state, "", location.pathname);
        if (asked) openFrom(asked);
        // "Start task" on a notification (sw.js): straight into focus mode.
        const startFrom = (id) => { closeScreens(); m.now.startFromNotice(id); };
        if (startId) startFrom(startId);
        const onSwMessage = (e) => {
          if (e.data?.daisey === "open") openFrom(e.data.what);
          if (e.data?.daisey === "start" && e.data.id) startFrom(String(e.data.id));
          if (e.data?.daisey === "quiet") m.now.quiet();
        };
        navigator.serviceWorker?.addEventListener("message", onSwMessage);
        m.swMessages = { unmount(){ navigator.serviceWorker?.removeEventListener("message", onSwMessage); } };
        // + in the Tell Daisey pill: a task (in the project on screen, if
        // any), a calendar event or a new project.
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
        $("#plusProject").onclick = () => { setPlus(false); m.projects.newProject(); };
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
