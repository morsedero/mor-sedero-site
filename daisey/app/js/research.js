// "Can this be done online?" (functions/daisey-now-research.js, 2026-10-06).
// A new task whose open hours are only a GUESS at "Office hours" gets one quiet
// web check. If the web says it can be done online, the guess becomes
// "Anytime", so the task isn't held back until the offices open; either way the
// one-line reason is kept on the task (task.research) and shown in its sheet.
// Silent: no question, no spinner; a failure leaves the task as it was.
const URL_ = "/.netlify/functions/daisey-now-research";

// True when this task is worth a check: office hours, and only a guess.
export const worthChecking = (t) => t?.openHours === "office" && (t.guessed || []).includes("openHours") && !t.research;

// → the patch to save on the task, or null.
export async function checkOnline(task){
  if (!worthChecking(task)) return null;
  const { idToken } = await import("./firebase.js"); // lazy: the pure part above is tested in node
  const res = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: task.title, project: task.project }) });
  if (!res.ok) return null;
  const { online, why } = await res.json();
  return { research: { online, why: why || "", at: Date.now() }, ...(online === "yes" ? { openHours: "anytime" } : {}) };
}
