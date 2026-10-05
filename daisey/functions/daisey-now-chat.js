// Tell Daisey (DAISEY_SPEC "Chat"): one plain-language message in, a list of
// proposed changes out. Nothing is written here — the app shows each change
// as a card and applies only what the user confirms.
//
// POST { text, today, weekday, tasks: [{ id, title, project, due, status }],
//        projects: [name] } with "Authorization: Bearer <Firebase ID token>".
// Returns { reply, actions: [...], question?, choices? } — see SCHEMA.
//
// The model is Gemini Flash-Lite through the plain generateContent REST call
// (Mor, 2026-10-05: cheapest that handles Hebrew and English well enough to
// turn a sentence into a task). The key is GEMINI_API_KEY in Netlify's
// environment and never reaches the page; GEMINI_MODEL overrides the model.
//
// Each user gets DAILY_CAP messages a day (Netlify Blobs, chat:<uid>:<date>),
// so one runaway tab can't run up the bill.
//
// Errors: 401 no_session · 400 bad_input · 429 daily_cap · 503 not_configured
// (no key set) · 502 model.
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");
// Blobs is required where it is used, so the tests can load tidy() without it.

const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const DAILY_CAP = 60;
const MAX_TEXT = 800;
const MAX_TASKS = 120;

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });

// One flat action shape (the schema subset generateContent accepts has no
// oneOf): `kind` says which of the other fields matter.
const SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING", description: "One short, friendly line saying what you understood. Same language as the user." },
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["add", "update", "waiting", "drop", "moment"] },
          taskId: { type: "STRING", description: "For update, waiting and drop: the id of an existing task from the list. Never invent one." },
          title: { type: "STRING", description: "add: the task title, in the user's language and words. update: a new title only if they asked to rename." },
          project: { type: "STRING", description: "An existing project name when one clearly fits, else omit." },
          size: { type: "INTEGER", description: "Minutes, only if the user said how long." },
          due: { type: "STRING", description: "YYYY-MM-DD, only if the user gave a date or deadline." },
          dateKind: { type: "STRING", enum: ["deadline", "target"], description: "deadline only for a hard date with a cost if missed." },
          notBefore: { type: "STRING", description: "YYYY-MM-DD: don't show the task before this day (\"next week\", \"after Sunday\")." },
          waitingOn: { type: "STRING", description: "waiting: who or what it waits on." },
          energy: { type: "STRING", enum: ["low", "medium", "high"], description: "moment: the user's energy right now." },
          place: { type: "STRING", enum: ["home", "out", "anywhere"], description: "moment: where the user is right now." },
        },
        required: ["kind"],
      },
    },
    question: { type: "STRING", description: "Only when you can't tell what they mean (two tasks match, say): one short question." },
    choices: { type: "ARRAY", items: { type: "STRING" }, description: "2-4 short answers to the question, as buttons." },
  },
  required: ["reply", "actions"],
};

const SYSTEM = `You turn one message from the user of Daisey, a day-planning app, into proposed changes to their task list.
The user writes in Hebrew or English, often mixed. Keep task titles in the user's own language and wording; don't translate or embellish.
Actions:
- add: a new task. A message listing several things ("lesson prep, invoices, call Uri") is several add actions.
- update: change an existing task's date, start date, title, project or size ("push the mix review to next week" → update with notBefore or due).
- waiting: an existing task is blocked on someone or something ("waiting on Yuval for the cue").
- drop: the user no longer wants an existing task.
- moment: the user describes how they are right now ("I'm wrecked", "I'm out"): set energy and/or place.
Match existing tasks by meaning against the provided list and use their exact id. If two tasks could match, return no action for it and ask a question with choices instead.
Resolve relative dates ("Thursday", "next week", "tomorrow") from today's date. "Next week" with no day means notBefore = the coming Sunday.
Only fill fields the user actually said or clearly implied. Never invent sizes or dates.
If the message asks nothing actionable, return no actions and a short helpful reply.
The reply is one short line, plain, friendly, no praise.`;

const clean = (s, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// Only what the app can use: known kinds, ids that exist, sane values.
function tidy(out, ids){
  const actions = (Array.isArray(out.actions) ? out.actions : []).slice(0, 12).flatMap((a) => {
    const kind = a?.kind;
    if (!["add", "update", "waiting", "drop", "moment"].includes(kind)) return [];
    if (kind !== "add" && kind !== "moment" && !ids.has(a.taskId)) return [];
    if (kind === "add" && !clean(a.title)) return [];
    const x = { kind };
    if (a.taskId && kind !== "add" && kind !== "moment") x.taskId = a.taskId;
    for (const k of ["title", "project", "waitingOn"]) if (clean(a[k])) x[k] = clean(a[k]);
    if (Number.isFinite(a.size) && a.size > 0 && a.size <= 24 * 60) x.size = Math.round(a.size);
    for (const k of ["due", "notBefore"]) if (isDay(a[k])) x[k] = a[k];
    if (x.due && ["deadline", "target"].includes(a.dateKind)) x.dateKind = a.dateKind;
    if (["low", "medium", "high"].includes(a.energy)) x.energy = a.energy;
    if (["home", "out", "anywhere"].includes(a.place)) x.place = a.place;
    if (kind === "moment" && !x.energy && !x.place) return [];
    return [x];
  });
  const choices = Array.isArray(out.choices) ? out.choices.map((c) => clean(c, 80)).filter(Boolean).slice(0, 4) : [];
  return { reply: clean(out.reply, 240), actions, ...(clean(out.question) && choices.length ? { question: clean(out.question, 200), choices } : {}) };
}

// The day's count for this user; null when Blobs can't be reached (the cap
// then doesn't block — better a message too many than a dead feature).
async function bump(uid, day){
  try {
    const { openStore } = require("./_daisey-lib/blobs");
    const store = openStore("daisey-chat");
    const key = `chat:${uid}:${day}`;
    const n = Number(await store.get(key)) || 0;
    if (n >= DAILY_CAP) return false;
    await store.set(key, String(n + 1));
    return true;
  } catch (e) {
    console.warn("[daisey-now-chat] cap store", e.message);
    return true;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return fail(405, "method");
  let claims;
  try {
    const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    claims = await verifyIdToken(token);
  } catch {
    return fail(401, "no_session");
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail(503, "not_configured");

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return fail(400, "bad_input"); }
  const text = clean(body.text, MAX_TEXT);
  if (!text || !isDay(body.today)) return fail(400, "bad_input");
  if (!(await bump(claims.sub, body.today))) return fail(429, "daily_cap");

  const tasks = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, MAX_TASKS)
    .map((t) => ({ id: clean(t.id, 60), title: clean(t.title, 120), project: clean(t.project, 60), due: isDay(t.due) ? t.due : undefined, status: clean(t.status, 12) }))
    .filter((t) => t.id && t.title);
  const projects = (Array.isArray(body.projects) ? body.projects : []).map((p) => clean(p, 60)).filter(Boolean).slice(0, 60);
  const context = `Today: ${body.today} (${clean(body.weekday, 12)}).\nProjects: ${JSON.stringify(projects)}\nOpen tasks: ${JSON.stringify(tasks)}`;

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `${context}\n\nMessage: ${text}` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2, maxOutputTokens: 1200 },
      }),
    });
  } catch (e) {
    console.error("[daisey-now-chat] fetch", e.message);
    return fail(502, "model");
  }
  if (!res.ok) {
    console.error("[daisey-now-chat] gemini", res.status, (await res.text()).slice(0, 400));
    return fail(502, "model");
  }
  try {
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "{}";
    return reply(200, tidy(JSON.parse(raw), new Set(tasks.map((t) => t.id))));
  } catch (e) {
    console.error("[daisey-now-chat] parse", e.message);
    return fail(502, "model");
  }
};

exports.tidy = tidy; // for the tests
