// Boot: sign-in → load data → show card.
import { configured } from "./config.js";

const $ = (s) => document.querySelector(s);
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

    Promise.all([import("./now.js"), import("./tasks.js"), import("./addtask.js")])
      .then(([{ mountNow }, { mountTasks }, { mountAddTask }]) => {
        if (fb.currentUid() !== user.uid || mounted) return;
        const m = mounted = {};
        m.adder = mountAddTask($("#addtask"), user.uid);
        // The Now card rides in the same scroller as the columns, first in line.
         m.tasks = mountTasks($("#board"), user.uid, { lead: $("#nowcard"), onAdd: (project) => m.adder.open(project) });
        m.now = mountNow($("#nowcard"), user.uid, { onCard: (id) => { onCard = id; m.tasks?.setCurrent(id); } });
        m.tasks.setCurrent(onCard);
        $("#add").onclick = () => m.adder.open();
        for (const s of SIGNED_IN) $(s).hidden = false;
      }).catch((e) => console.error("[daisey] boot views", e));
  });
}
