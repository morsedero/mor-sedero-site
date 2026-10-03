// Boot: sign-in → load data → show card.
import { configured } from "./config.js";

const $ = (s) => document.querySelector(s);
const DEBUG = new URLSearchParams(location.search).has("debug");
const show = (id) => {
  for (const el of document.querySelectorAll("[data-view]")) el.hidden = el.dataset.view !== id;
};

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
  let debug = null;
  let onCard = null; // task id on the Now card, shared with the debug list
  let now = null;
  let checkin = null;
  let adder = null;

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

  fb.onUser((user) => {
    if (debug) { debug.unmount(); debug = null; }
    if (now) { now.unmount(); now = null; }
    $("#actions").hidden = true;
    if (checkin) { checkin.unmount(); checkin = null; }
    if (adder) { adder.unmount(); adder = null; }
    setMenu(false);
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

    // Now card on top; the check-in opens by itself on the day's first visit.
    Promise.all([import("./now.js"), import("./checkin.js"), import("./addtask.js")]).then(([{ mountNow }, { mountCheckin }, { mountAddTask }]) => {
      if (fb.currentUid() !== user.uid || now) return;
      now = mountNow($("#nowcard"), user.uid, { onCard: (id) => { onCard = id; debug?.setCurrent(id); } });
      checkin = mountCheckin($("#checkin"), user.uid, { onSaved: () => now?.refresh() });
      adder = mountAddTask($("#addtask"), user.uid);
      $("#replan").onclick = () => checkin.open();
      $("#add").onclick = () => adder.open();
      $("#actions").hidden = false;
    }).catch((e) => console.error("[daisey] now", e));

    if (DEBUG) {
      import("./debug.js").then(({ mountDebug }) => {
        if (fb.currentUid() !== user.uid || debug) return;
        debug = mountDebug($("#debug"), user.uid);
        debug.setCurrent(onCard);
      }).catch((e) => console.error("[daisey] debug", e));
    }
  });
}
