// "Can this be done online?" (Mor, 2026-10-06: a task like "buy two codes and
// hand them to the students" may need a call in office hours, or may not).
// POST { title, project? } with "Authorization: Bearer <Firebase ID token>".
// Gemini with Google Search looks the thing up and answers
//   { online: "yes" | "no" | "unsure", why: "one short line, in the task's language" }
// The app uses it to turn a guessed "Office hours" into "Anytime" when the web
// says it can be done online, and keeps the reason on the task. Only the title
// and project name go out (as with Tell Daisey); no other task data. 40 a day.
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const DAILY_CAP = 40;
const reply = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
const fail = (statusCode, code) => reply(statusCode, { error: code });
const clean = (s, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

const SYSTEM = `You help a busy person decide WHEN a small task can be done.
Given a task title, search the web and decide whether it can be done entirely online or by e-mail/app, at any hour, or whether it needs a phone call or a visit during office hours (a school, a government office, a shop, a clinic).
Answer with ONE line of JSON and nothing else: {"online":"yes"|"no"|"unsure","why":"<=100 characters, same language as the task, saying how or why>"}.
"yes" only when you found that an online way exists for this specific thing. "no" when it clearly needs a call or visit. "unsure" when you could not tell. Never invent a website.`;

// Whatever the model said → { online, why } or null. It may wrap the JSON in
// prose or code fences; the first {...} wins.
function tidy(text){
  const m = /\{[\s\S]*?\}/.exec(String(text || ""));
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const online = ["yes", "no", "unsure"].includes(o.online) ? o.online : null;
    return online ? { online, why: clean(o.why, 140) } : null;
  } catch { return null; }
}

async function bump(uid){
  try {
    const { openStore } = require("./_daisey-lib/blobs");
    const store = openStore("daisey-research");
    const key = `r:${uid}:${new Date().toISOString().slice(0, 10)}`;
    const n = Number(await store.get(key)) || 0;
    if (n >= DAILY_CAP) return false;
    await store.set(key, String(n + 1));
    return true;
  } catch (e) {
    console.warn("[daisey-now-research] cap store", e.message);
    return true;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return fail(405, "method");
  let claims;
  try { claims = await verifyIdToken((event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "")); } catch { return fail(401, "no_session"); }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail(503, "not_configured");
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return fail(400, "bad_input"); }
  const title = clean(body.title, 200), project = clean(body.project, 60);
  if (!title) return fail(400, "bad_input");
  if (!(await bump(claims.sub))) return fail(429, "daily_cap");
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `Task: ${title}${project ? `\nProject: ${project}` : ""}` }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
      }),
    });
  } catch (e) { console.error("[daisey-now-research] fetch", e.message); return fail(502, "model"); }
  if (!res.ok) { console.error("[daisey-now-research] gemini", res.status, (await res.text()).slice(0, 300)); return fail(502, "model"); }
  const data = await res.json().catch(() => null);
  const out = tidy(data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join(""));
  return out ? reply(200, out) : fail(502, "model");
};

exports.tidy = tidy;
