// Boot: sign-in → load data → show card.
// Session 1: sign-in plus a throwaway synced note that proves Firestore works
// end to end. The note (users/{uid}/state/note) goes away in a later session.
import { configured } from "./config.js";

const $ = (s) => document.querySelector(s);
// Identifies this page load as the writer, so its own echoes can be ignored.
const TAB = crypto.randomUUID();
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
  let unsub = null;

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
    if (unsub) { unsub(); unsub = null; }
    const note = $("#note");
    note.value = "";
    if (!user) { show("signedout"); return; }

    $("#who").textContent = user.email;
    show("signedin");

    const ref = fb.doc(fb.db, "users", user.uid, "state", "note");
    let timer = null;
    const status = $("#noteStatus");

    note.oninput = () => {
      status.textContent = "Saving…";
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fb.setDoc(ref, { text: note.value, by: TAB, updatedAt: fb.serverTimestamp() })
          .catch((e) => { console.error("[daisey] note save", e); status.textContent = "Not saved: " + e.code; });
      }, 400);
    };

    unsub = fb.onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
      const pending = snap.metadata.hasPendingWrites;
      // Only take text another tab/device wrote. Our own writes echo back
      // (local, then server-confirmed), and an echo of an older save can land
      // after newer typing — applying it erased what had just been typed.
      const data = snap.exists() ? snap.data() : null;
      if (data?.by !== TAB && timer === null) {
        const text = data?.text || "";
        if (note.value !== text) note.value = text;
      }
      status.textContent = pending || timer ? "Saving…" : snap.metadata.fromCache ? "Offline copy" : "Synced";
    }, (e) => {
      console.error("[daisey] note listen", e);
      status.textContent = "Can't read: " + e.code;
    });
  });
}
