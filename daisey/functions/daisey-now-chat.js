// Tell Daisey (DAISEY_SPEC "Chat"): one plain-language message in, a list of
// proposed changes out. Nothing is written here — the app shows each change
// as a card and applies only what the user confirms.
//
// POST { text, today, weekday, tasks: [{ id, title, project, due, status }],
//        projects: [name] } with "Authorization: Bearer <Firebase ID token>".
// Returns { reply, actions: [...], question?, choices? } — see tidy().
//
// The model is Gemini Flash-Lite through the plain generateContent REST call
// (Mor, 2026-10-05: cheapest that handles Hebrew and English). 3.5 beat 3.1
// on the same messages (faster, and fewer fields filled in the wrong place).
// The key is GEMINI_API_KEY in Netlify's environment and never reaches the
// page; GEMINI_MODEL overrides the model.
//
// Small models put values in the wrong field when the schema is one flat
// list of optional fields ("Thursday" ended up in waitingOn). Two things
// fixed most of it: worked examples in the prompt, and field names that say
// exactly what they hold. tidy() then drops whatever is still out of place,
// and one retry covers a busy model or an answer that ran away.
//
// Each user gets DAILY_CAP messages a day (Netlify Blobs, chat:<uid>:<date>),
// so one runaway tab can't run up the bill.
//
// Errors: 401 no_session · 400 bad_input · 429 daily_cap · 503 not_configured
// (no key set) · 502 model.
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");
// Blobs is required where it is used, so the tests can load tidy() without it.

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const DAILY_CAP = 60;
const MAX_TEXT = 800;
const MAX_TASKS = 120;
// project: a new project. Projects only exist through their tasks, so the app
// answers it by opening its first task, with the project already set.
// done / event / query (2026-10-06): tick a task off, put something at a
// fixed time in the calendar, or ask about the list (answered in the app).
const KINDS = ["add", "update", "waiting", "drop", "moment", "project", "done", "event", "query"];

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const fail = (statusCode, code) => reply(statusCode, { error: code });

// One flat action shape (the schema subset generateContent accepts has no
// oneOf): `kind` says which of the other fields matter.
const str = (description, extra = {}) => ({ type: "STRING", description, ...extra });
const ACTION_FIELDS = {
  kind: str("What to do.", { enum: KINDS }),
  taskId: str("update/waiting/drop/done only: the exact id of an existing task from the list."),
  title: str("add: the new task's title in the user's own words. update: only when renaming."),
  project: str("An existing project when one clearly fits, or a new project the user names. Otherwise leave empty."),
  minutes: { type: "INTEGER", description: "add/update/event: how long it takes, only if the user said (\"15 min\" → 15, \"2 hours\" → 120). moment: how many minutes the user has free right now." },
  dueDate: str("YYYY-MM-DD the task is due (\"by Thursday\", \"עד יום רביעי\"). Only if the user gave one."),
  dateKind: str("deadline only for a hard date with a cost if missed, else target.", { enum: ["deadline", "target"] }),
  startDate: str("YYYY-MM-DD before which the task shouldn't come up (\"next week\", \"after Sunday\")."),
  waitingFor: str("waiting only: the person or thing it waits on, never a date."),
  energy: str("moment only: the user's energy right now.", { enum: ["low", "medium", "high"] }),
  dayEnd: str("moment only: HH:MM, 24-hour, when the user says their day runs until a different time today (\"I can work until 11pm\")."),
  place: str("moment only: where the user is right now.", { enum: ["home", "out", "anywhere"] }),
  eventDate: str("event only: YYYY-MM-DD the event happens."),
  time: str("event only: the start time, HH:MM, 24-hour."),
  query: str("query only: what they ask about.", { enum: ["next", "due", "waiting", "plan"] }),
  range: str("query due only: today or this week.", { enum: ["today", "week"] }),
  part: str("query plan only: which part of today, or the whole day.", { enum: ["morning", "afternoon", "evening", "day"] }),
};
const SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: str("One short line in the language of the MESSAGE, saying what you suggest (it isn't done yet: \"Add 3 tasks?\", not \"Added\")."),
    question: str("Only when it's unclear which task they mean: one short question. Otherwise empty."),
    choices: { type: "ARRAY", items: { type: "STRING" }, description: "With a question: 2-4 short answers, usually the matching task titles." },
    actions: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: ACTION_FIELDS, required: ["kind"], propertyOrdering: Object.keys(ACTION_FIELDS) },
    },
  },
  required: ["reply", "actions"],
  propertyOrdering: ["reply", "question", "choices", "actions"],
};

const SYSTEM = `You turn one message from the user of Daisey, a day-planning app, into proposed changes to their task list. The app shows them as cards and the user confirms.
The user writes in Hebrew or English, often mixed. Keep task titles in the user's own words and language; never translate them.

Kinds:
- add: a new task. A list of several things is several add actions.
- update: change an existing task's dueDate, startDate, title, project or minutes.
- waiting: an existing task is blocked on someone or something.
- drop: the user no longer wants an existing task.
- moment: how the user is right now (energy, place), or how long they have free right now (minutes: "I have 30 minutes", "free for an hour"), or that their day runs later or earlier today (dayEnd: "my day can go until 11 pm"). Changes no task.
- project: the user wants a new project (put its name in project). If they also name tasks for it, add those too, each with that project.
- done: the user says they finished an existing task ("paid the arnona", "sent the stems").
- event: something at a fixed time ("dentist Thursday at 15:00", "meeting with Dana tomorrow 10:30"): a calendar event, not a task. Title, eventDate, time; minutes only if said.
- query: a question about their tasks, changing nothing: "what's next?" → next; "what's due today/this week?" → due with range; "what am I waiting on?" → waiting; "plan my afternoon / my day" → plan with part (morning, afternoon, evening, or day).

Rules:
- Each value goes only in its own field. Dates go in dueDate or startDate as YYYY-MM-DD, never in waitingFor or title.
- Work out dates from today's date given below. "Next week" with no day means startDate = the coming Sunday.
- Only use an existing task when the message clearly refers to it. A new thing that only shares a word with an existing task is an add.
- If more than one existing task could be the one they mean, return NO action for it; ask a question and give the candidate titles as choices.
- Fill only what the user said. Never invent minutes, dates or projects.
- The reply is in the language of the user's message, short and plain, and says what you suggest.

Examples (today is Monday 2026-10-05; tasks: t1 "Mix review for Reprise", t4 "Mix review for Lunitales", t2 "ביטוח לחיות", t3 "Pre-attack cue"):
Message: lesson prep for Thursday, invoices, call Uri 15 min
{"reply":"Add 3 tasks?","actions":[{"kind":"add","title":"Lesson prep","dueDate":"2026-10-08"},{"kind":"add","title":"Invoices"},{"kind":"add","title":"Call Uri","minutes":15}]}
Message: להתקשר לביטוח לאומי עד יום רביעי
{"reply":"להוסיף משימה ליום רביעי?","actions":[{"kind":"add","title":"להתקשר לביטוח לאומי","dueDate":"2026-10-07"}]}
Message: push the mix review to next week
{"reply":"Which mix review?","question":"Which mix review?","choices":["Mix review for Reprise","Mix review for Lunitales"],"actions":[]}
Message: waiting on Yuval for the pre-attack cue
{"reply":"Set it to waiting on Yuval?","actions":[{"kind":"waiting","taskId":"t3","waitingFor":"Yuval"}]}
Message: add a project called Monster Punk
{"reply":"New project Monster Punk?","actions":[{"kind":"project","project":"Monster Punk"}]}
Message: new project חתונה: book the DJ, send invites
{"reply":"פרויקט חדש חתונה, עם 2 משימות?","actions":[{"kind":"project","project":"חתונה"},{"kind":"add","title":"Book the DJ","project":"חתונה"},{"kind":"add","title":"Send invites","project":"חתונה"}]}
Message: I'm wrecked and out
{"reply":"Low energy, out. Got it?","actions":[{"kind":"moment","energy":"low","place":"out"}]}
Message: I have 30 minutes
{"reply":"30 minutes free. Got it?","actions":[{"kind":"moment","minutes":30}]}
Message: my day can extend to 11 pm today
{"reply":"Day ends at 23:00 today. Got it?","actions":[{"kind":"moment","dayEnd":"23:00"}]}
Message: sent the pre-attack cue
{"reply":"Mark it done?","actions":[{"kind":"done","taskId":"t3"}]}
Message: רופא שיניים ביום חמישי ב-15:00
{"reply":"להוסיף ליומן ביום חמישי ב-15:00?","actions":[{"kind":"event","title":"רופא שיניים","eventDate":"2026-10-08","time":"15:00"}]}
Message: what's due this week?
{"reply":"Here's what's due this week:","actions":[{"kind":"query","query":"due","range":"week"}]}
Message: plan my afternoon
{"reply":"Here's the afternoon:","actions":[{"kind":"query","query":"plan","part":"afternoon"}]}`;

const clean = (s, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
// Something that reads as a date, not a person ("Thursday", "2026-10-08", "יום רביעי").
const looksLikeDate = (s) => /^\d{4}-\d{2}-\d{2}$|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|tomorrow|today|next week|יום|מחר|שבוע/i.test(String(s || ""));

// Only what the app can use: known kinds, ids that exist, values in the
// fields they belong to. Returns the app's own field names (size, due,
// notBefore, waitingOn) whatever the model's schema calls them.
function tidy(out, ids){
  const actions = (Array.isArray(out?.actions) ? out.actions : []).slice(0, 12).flatMap((a) => {
    const kind = a?.kind;
    if (!KINDS.includes(kind)) return [];
    const onTask = kind === "update" || kind === "waiting" || kind === "drop" || kind === "done";
    if (onTask && !ids.has(a.taskId)) return [];
    const x = { kind };
    if (onTask) x.taskId = a.taskId;
    if (kind === "add" || kind === "update") {
      if (clean(a.title)) x.title = clean(a.title);
      if (clean(a.project)) x.project = clean(a.project, 60);
      const size = a.minutes ?? a.size;
      if (Number.isFinite(size) && size > 0 && size <= 24 * 60) x.size = Math.round(size);
      const due = a.dueDate ?? a.due, start = a.startDate ?? a.notBefore;
      if (isDay(due)) x.due = due;
      if (isDay(start)) x.notBefore = start;
      if (x.due && ["deadline", "target"].includes(a.dateKind)) x.dateKind = a.dateKind;
    }
    if (kind === "add" && !x.title) return [];
    if (kind === "update" && Object.keys(x).length <= 2) return []; // nothing to change
    if (kind === "waiting") {
      const on = clean(a.waitingFor ?? a.waitingOn, 80);
      if (on && !looksLikeDate(on)) x.waitingOn = on;
    }
    if (kind === "project") {
      const name = clean(a.project, 60);
      return name ? [{ kind, project: name }] : [];
    }
    if (kind === "event") {
      const title = clean(a.title), date = a.eventDate ?? a.startDate ?? a.dueDate, time = String(a.time || "");
      if (!title || !isDay(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return [];
      const size = a.minutes ?? a.size;
      return [{ kind, title, date, time, minutes: Number.isFinite(size) && size > 0 && size <= 24 * 60 ? Math.round(size) : 60 }];
    }
    if (kind === "query") {
      if (!["next", "due", "waiting", "plan"].includes(a.query)) return [];
      return [{ kind, query: a.query, ...(a.query === "due" ? { range: a.range === "week" ? "week" : "today" } : {}),
        ...(a.query === "plan" ? { part: ["morning", "afternoon", "evening"].includes(a.part) ? a.part : "day" } : {}) }];
    }
    if (kind === "moment") {
      if (["low", "medium", "high"].includes(a.energy)) x.energy = a.energy;
      if (["home", "out", "anywhere"].includes(a.place)) x.place = a.place;
      const free = Number.isFinite(a.minutes) ? Math.round(a.minutes) : 0;
      if (free >= 5 && free <= 240) x.minutes = free;
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(a.dayEnd || ""))) x.dayEnd = a.dayEnd;
      if (!x.energy && !x.place && !x.minutes && !x.dayEnd) return [];
    }
    return [x];
  });
  const choices = Array.isArray(out?.choices) ? out.choices.map((c) => clean(c, 80)).filter(Boolean).slice(0, 4) : [];
  const question = clean(out?.question, 200);
  return { reply: clean(out?.reply, 240), actions, ...(question && choices.length ? { question, choices } : {}) };
}

// The day's count for this user; true when it's allowed. If Blobs can't be
// reached the cap doesn't block — better a message too many than a dead feature.
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

// One call to Gemini; the parsed JSON, or null (busy, error, or an answer
// that isn't JSON — usually one that ran away and hit the token limit).
async function ask(key, prompt){
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.1, maxOutputTokens: 1500 },
      }),
    });
  } catch (e) {
    console.error("[daisey-now-chat] fetch", e.message);
    return null;
  }
  if (!res.ok) {
    console.error("[daisey-now-chat] gemini", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  try {
    const data = await res.json();
    return JSON.parse(data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "{}");
  } catch (e) {
    console.error("[daisey-now-chat] parse", e.message);
    return null;
  }
}

exports.handler = async (event) => {
  // GET: is it set up? Says only whether a key is present, never the key.
  if (event.httpMethod === "GET") return reply(200, { configured: !!process.env.GEMINI_API_KEY, model: MODEL });
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
  const prompt = `Today: ${clean(body.weekday, 12)} ${body.today}.\nProjects: ${JSON.stringify(projects)}\nTasks: ${JSON.stringify(tasks)}\n\nMessage: ${text}`;

  const out = (await ask(key, prompt)) || (await ask(key, prompt)); // one retry
  if (!out) return fail(502, "model");
  return reply(200, tidy(out, new Set(tasks.map((t) => t.id))));
};

exports.tidy = tidy; // for the tests
