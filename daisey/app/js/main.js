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
  let unmountDebug = null;
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
  $("#signout").onclick = () => fb.signOut();

  fb.onUser((user) => {
    if (unmountDebug) { unmountDebug(); unmountDebug = null; }
    if (now) { now.unmount(); now = null; }
    $("#actions").hidden = true;
    if (checkin) { checkin.unmount(); checkin = null; }
    if (adder) { adder.unmount(); adder = null; }
    if (!user) { show("signedout"); return; }

    $("#who").textContent = user.email;
    show("signedin");

    // Now card on top; the check-in opens by itself on the day's first visit.
    Promise.all([import("./now.js"), import("./checkin.js"), import("./addtask.js")]).then(([{ mountNow }, { mountCheckin }, { mountAddTask }]) => {
      if (fb.currentUid() !== user.uid || now) return;
      now = mountNow($("#nowcard"), user.uid);
      checkin = mountCheckin($("#checkin"), user.uid, { onSaved: () => now?.refresh() });
      adder = mountAddTask($("#addtask"), user.uid);
      $("#replan").onclick = () => checkin.open();
      $("#add").onclick = () => adder.open();
      $("#actions").hidden = false;
    }).catch((e) => console.error("[daisey] now", e));

    if (DEBUG) {
      import("./debug.js").then(({ mountDebug }) => {
        if (fb.currentUid() === user.uid && !unmountDebug) unmountDebug = mountDebug($("#debug"), user.uid);
      }).catch((e) => console.error("[daisey] debug", e));
    }
  });
}
