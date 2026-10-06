// Waiting on people (Mor, 2026-10-06). PURE, shared by the app (Needs you,
// the task sheet, the meeting card) and the server (notify.js "people").
//
// personOf: the name in a Pending task's "Waiting on" — the first word that
// reads as a name (a capital, or a Hebrew word): "Yuval sends the stems" →
// Yuval, "יובל שולח את הסטמס" → יובל. Null when there's none ("the bank").
// nudgeText / waLink: a short friendly check-in, in the task's own language
// (Hebrew if the task or the name is), opened in WhatsApp — you pick the
// contact and press send. Daisey never sends it.
const HEB = /[֐-׿]/;
const HEB_PREFIX = /^[ובלמשהכ]{1,2}/;

export function personOf(waitingOn){
  const words = String(waitingOn || "").match(/[\p{L}'-]+/gu) || [];
  const w = words.find((x) => /^\p{Lu}/u.test(x) || HEB.test(x));
  return w && w.length >= 2 ? w : null;
}

// Does this text name that person? Whole words, any case; a Hebrew word may
// carry a prefix letter or two ("עם יובל", "ליובל").
export function names(text, name){
  if (!name) return false;
  const n = name.toLowerCase();
  return (String(text || "").toLowerCase().match(/[\p{L}'-]+/gu) || [])
    .some((w) => w === n || (HEB.test(n) && w.endsWith(n) && HEB_PREFIX.test(w.slice(0, w.length - n.length)) && w.length - n.length <= 2));
}

export function nudgeText(task){
  const who = personOf(task.waitingOn);
  const title = String(task.title || "").trim();
  return HEB.test(`${title} ${task.waitingOn || ""}`)
    ? `היי${who ? ` ${who}` : ""}, רציתי לבדוק לגבי "${title}". יש עדכון?`
    : `Hi${who ? ` ${who}` : ""}, just checking in about "${title}". Any news?`;
}

export const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

// Pending tasks waiting on someone an event's title names (a meeting with
// Yuval → what you're waiting on Yuval for).
export const waitingFor = (title, tasks = []) =>
  tasks.filter((t) => t.status === "waiting" && t.waitingOn && names(title, personOf(t.waitingOn)));
