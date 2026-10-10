// Which Computer tasks work on a phone too (Mor, 2026-10-09: on a ride,
// look through every task for ones the phone can do before asking). Most
// tasks are guessed Computer (model.guessWhere), and a bus or a passenger
// seat shuts Computer out, so a ride used to offer nothing at all.
// Asked once per task title: the server's Gemini (daisey-now-chat, mode
// "phone"), remembered on this device. With no answer (offline, no key,
// cap hit) a word list stands in, and the server is tried again later.
// Firebase loads only when asking, so the planner (proposal.js) can read the
// answers without it.
import { localDate } from "./model.js";
const FIREBASE = "./firebase.js";

const URL_ = "/.netlify/functions/daisey-now-chat";
const KEY = "daisey.phoneOk.v1";
const RETRY_MS = 10 * 60 * 1000;
// What a phone does start to finish: messages, calls, booking, paying, reading.
const WORDS_EN = /\b(e-?mail|mail|reply|respond|answer|text|message|whatsapp|sms|call|phone|book|order|buy|pay|transfer|renew|register|sign up|schedule|confirm|ask|remind|check|look up|read|listen|watch|follow up)\b/i;
const WORDS_HE = ["מייל", "לענות", "הודעה", "וואטסאפ", "להתקשר", "להזמין", "לקנות", "לשלם", "להעביר", "לחדש", "להירשם", "לקבוע", "לאשר", "לשאול", "לבדוק", "לקרוא", "להזכיר"];
const looksPhone = (title = "") => WORDS_EN.test(title) || WORDS_HE.some((w) => title.includes(w));

const sig = (t) => `${t.id}|${t.title}`;
let memo = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } })();
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(memo)); } catch { /* storage blocked: this tab only */ } };
let busy = false, failedAt = 0;

export const searching = () => busy;

// The ids of Computer tasks the phone can do: the server's answer where it
// gave one, else the word list.
export function phoneOkIds(tasks = []){
  return new Set(tasks.filter((t) => t.where === "computer" && (sig(t) in memo ? memo[sig(t)] : looksPhone(t.title))).map((t) => t.id));
}

// Ask about the Computer tasks not asked about yet. → true when the answer
// changed something (render again), false when there was nothing to ask.
export async function findPhoneTasks(tasks = [], { guest = false } = {}){
  const todo = tasks.filter((t) => t.where === "computer" && t.status !== "done" && t.status !== "dropped" && !(sig(t) in memo)).slice(0, 120);
  if (!todo.length || busy || Date.now() - failedAt < RETRY_MS) return false;
  busy = true;
  try {
    const headers = { "Content-Type": "application/json" };
    if (guest) headers["X-Daisey-Guest"] = "1";
    // A name in a variable, so the server's bundler (esbuild, for notify.js via
    // brief → proposal → here) never pulls the browser-only firebase.js in; its
    // top-level await broke the push function's bundle (2026-10-10).
    else headers.Authorization = `Bearer ${await (await import(FIREBASE)).idToken()}`;
    const res = await fetch(URL_, {
      method: "POST", headers,
      body: JSON.stringify({ mode: "phone", today: localDate(),
        ...(guest ? { guest: true } : {}), tasks: todo.map((t) => ({ id: t.id, title: t.title, project: t.project, type: t.type })) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(body.ids)) throw new Error(body.error || `phone ${res.status}`);
    const ok = new Set(body.ids);
    for (const t of todo) memo[sig(t)] = ok.has(t.id);
    keep();
  } catch (e) {
    failedAt = Date.now();
    console.warn("[daisey] phone tasks", e?.message || e);
  } finally {
    busy = false;
  }
  return true;
}
