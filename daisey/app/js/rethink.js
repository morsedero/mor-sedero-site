// Rethink on the day's proposed schedule (2026-10-07). Asks the server's
// Gemini (functions/daisey-now-chat.js, mode "plan") for a new order first;
// with no key, no network, a cap hit or an answer that names nothing usable,
// it reads the same words locally (proposal.parseAsk) and re-proposes from
// those. Either way the result is a list of { taskId, minutes } — the app
// lays it on the clock itself.
import { idToken } from "./firebase.js";
import { localDate } from "./model.js";
import { proposeDay, parseAsk, leftOf } from "./proposal.js";

const URL_ = "/.netlify/functions/daisey-now-chat";

// → { items, note, via: "ai" | "local" }
export async function rethink(text, { tasks, events, now = Date.now(), hours, settings, run, current = [], exclude = [], freeMinutes = 0, guest = false }){
  const open = tasks.filter((t) => t.status === "ready" && !t.onHold && !exclude.includes(t.id) && t.id !== run?.taskId);
  try {
    const headers = { "Content-Type": "application/json" };
    if (guest) headers["X-Daisey-Guest"] = "1";
    else headers.Authorization = `Bearer ${await idToken()}`;
    const res = await fetch(URL_, {
      method: "POST", headers,
      body: JSON.stringify({
        mode: "plan", text, today: localDate(now), weekday: new Date(now).toLocaleDateString("en", { weekday: "long" }),
        time: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
        ...(guest ? { guest: true } : {}), freeMinutes, current: current.map((i) => i.taskId),
        tasks: open.map((t) => ({ id: t.id, title: t.title, project: t.project, minutes: leftOf(t), type: t.type, due: t.due || undefined, dateKind: t.dateKind || undefined })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(body.order) && body.order.length) {
      const byId = new Map(open.map((t) => [t.id, t]));
      const items = body.order.filter((id) => byId.has(id)).map((id) => ({ taskId: id, minutes: leftOf(byId.get(id)) }));
      if (items.length) return { items, note: body.note || "", via: "ai" };
    }
  } catch { /* offline, or no token: read it here */ }
  const ask = parseAsk(text, tasks);
  const items = proposeDay({ tasks, events, now, hours, settings, run, ask, exclude });
  return { items, via: "local", note: ask.understood ? "" : "I didn't catch that, so here's a fresh take. Try “lighter”, “no calls”, “start with …” or “until 5”." };
}
