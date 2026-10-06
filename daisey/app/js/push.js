// The morning brief on this device (2026-10-06, Mor: "as a morning
// message", app notification, Android). The account menu's switch signs this
// device up for Web Push; the server (daisey-now-morning) sends one message
// at the start of the day hours: free time, how many dated tasks are open
// and how many fit, today's deadlines, the first event.
//
// The server can't read Firestore, so while the brief is on (settings
// morningBrief, on any device) the app sends it a snapshot of the dated,
// ready tasks whenever they change — titles, dates and sizes only.
import { idToken } from "./firebase.js";

const URL_ = "/.netlify/functions/daisey-now-push";
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function post(body){
  const res = await fetch(URL_, { method: "POST",
    headers: { Authorization: `Bearer ${await idToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || `push ${res.status}`), { code: out.error || "failed" });
  return out;
}

const keyBytes = (b64u) => {
  const s = atob(b64u.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64u.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

// This device's subscription, if it has one and notifications are allowed.
export async function deviceOn(){
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  return !!(await reg.pushManager.getSubscription());
}

// hours: { start, end } in minutes (day.js dayHours). Throws with .code:
// denied (notifications blocked) · not_configured (server keys missing).
export async function enablePush(hours){
  if (!pushSupported()) throw Object.assign(new Error("unsupported"), { code: "unsupported" });
  const info = await (await fetch(URL_)).json();
  if (!info.configured) throw Object.assign(new Error("not_configured"), { code: "not_configured" });
  if (await Notification.requestPermission() !== "granted") throw Object.assign(new Error("denied"), { code: "denied" });
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes(info.publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Signed up with another key (the server's keys changed): start over.
  const same = sub?.options?.applicationServerKey
    && new Uint8Array(sub.options.applicationServerKey).every((b, i) => b === key[i]);
  if (sub && !same) { await sub.unsubscribe(); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await post({ action: "subscribe", subscription: sub.toJSON(), tz: tz(), dayStart: hours.start, dayEnd: hours.end });
}

export async function disablePush(){
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await post({ action: "unsubscribe", endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

// Today's brief, now, to every device signed up. Returns { sent, body }.
export const sendTest = () => post({ action: "test" });

// The snapshot, at most every few seconds and only when it changed.
let timer = null, lastSent = "";
export function syncSnapshot(tasks, hours){
  const list = (tasks || []).filter((t) => t.status === "ready" && t.due)
    .map((t) => ({ title: t.title, status: t.status, due: t.due, dateKind: t.dateKind, notBefore: t.notBefore || null,
      size: t.size, spentMinutes: t.spentMinutes || 0 }));
  const body = { action: "snapshot", tasks: list, tz: tz(), dayStart: hours.start, dayEnd: hours.end };
  const mark = JSON.stringify(body);
  if (mark === lastSent) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    post(body).then(() => { lastSent = mark; }).catch((e) => console.warn("[daisey] brief snapshot", e.code || e));
  }, 4000);
}
