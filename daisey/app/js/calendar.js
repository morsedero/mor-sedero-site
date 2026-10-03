// Calendar read: the agenda from now to the end of tomorrow, via the
// daisey-now-calendar function (which reuses old Daisey's Google token — no
// separate calendar sign-in). Refetches every 10 min and when the tab comes
// back; the window itself is worked out each render (engine.freeWindow), so
// it counts down between fetches.
//
// Every event the user would see is here, so the schedule panel can show the
// day. `busy` marks the ones that should also stop Daisey picking a task —
// an all-day "ILLUSTRATION WEEK" shouldn't blank the card.
import { idToken } from "./firebase.js";

const URL_ = "/.netlify/functions/daisey-now-calendar";
const EVERY = 10 * 60000;

// cb({ status, events }) — status: loading · ok · not_connected · needs_reauth · error.
export function watchCalendar(cb){
  let alive = true, last = { status: "loading", events: [] };
  const send = (v) => { if (alive) { last = v; cb(v); } };

  async function load(){
    try {
      // From the start of today, so the panel can show what already happened.
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const end = new Date(); end.setDate(end.getDate() + 2); end.setHours(0, 0, 0, 0);
      const q = new URLSearchParams({ from: from.toISOString(), to: end.toISOString() });
      const res = await fetch(`${URL_}?${q}`, { headers: { Authorization: `Bearer ${await idToken()}` } });
      const body = await res.json().catch(() => ({}));
      if (res.ok) send({ status: "ok", events: body.events || [] });
      else send({ status: ["not_connected", "needs_reauth"].includes(body.error) ? body.error : "error", events: [] });
    } catch (e) {
      console.error("[daisey] calendar", e);
      // Offline: keep the last good events rather than forgetting the calendar.
      if (last.status !== "ok") send({ status: "error", events: [] });
    }
  }

  cb(last);
  load();
  const timer = setInterval(() => { if (!document.hidden) load(); }, EVERY);
  const onVisible = () => { if (!document.hidden) load(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
}
