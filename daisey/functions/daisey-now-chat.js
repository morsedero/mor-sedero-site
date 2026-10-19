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
// Each signed-in user or guest IP gets DAILY_CAP messages per UTC day
// (Netlify Blobs, chat:<id>:<date>), so request-supplied dates cannot reset it.
//
// Errors: 401 no_session · 400 bad_input · 429 daily_cap · 503 not_configured
// (no key set) · 502 model.
const { verifyIdToken } = require("./_daisey-lib/firebase-auth");
const crypto = require("crypto");
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
// Bump on any change to SYSTEM; test/phrases/run.mjs prints it with a hash of the text.
const PROMPT_VERSION = "2026-10-19 date words";

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
  dateWords: str("Whenever you fill a date: the user's own words for that day, copied as said (\"tomorrow\", \"in 3 days\", \"by Friday\", \"on the 25th\", \"סוף השבוע\"). The app works the day out from them."),
  dueDate: str("YYYY-MM-DD the task is due (\"by Thursday\", \"עד יום רביעי\"). Only if the user gave one."),
  dateKind: str("deadline only for a hard date with a cost if missed, else target.", { enum: ["deadline", "target"] }),
  startDate: str("YYYY-MM-DD before which the task shouldn't come up (\"next week\", \"after Sunday\")."),
  repeatDays: { type: "ARRAY", items: { type: "INTEGER" }, description: "add only, when the user says it repeats on set days: the weekdays, 0 = Sunday ... 6 = Saturday (\"every weekday\" → [0,1,2,3,4], the Israeli work week; \"every Monday and Thursday\" → [1,4])." },
  timesPerWeek: { type: "INTEGER", description: "add only, when it repeats with no set days: times a week (\"3 times a week\" → 3, \"every day\" → 7, \"weekly\" → 1)." },
  repeatMonthly: { type: "BOOLEAN", description: "add only: true when it repeats every month." },
  waitingFor: str("waiting only: the person or thing it waits on, never a date."),
  checkOn: str("waiting only: YYYY-MM-DD to check on it again, when the user says until when (\"till Sunday\", \"עד יום שני\")."),
  dayEnd: str("moment only: HH:MM, 24-hour, when the user says their day runs until a different time today (\"I can work until 11pm\")."),
  place: str("moment only: where the user is right now. On the move: train, bus (also a passenger in a car or taxi), car (driving).", { enum: ["home", "out", "anywhere", "train", "bus", "car"] }),
  eventDate: str("event only: YYYY-MM-DD the event happens."),
  time: str("event only: the start time, HH:MM, 24-hour."),
  location: str("event only: where it happens, when the user names a place (\"at Assuta\", \"in Haifa\", \"בתל אביב\"). Never put it in title."),
  query: str("query only: what they ask about.", { enum: ["next", "due", "waiting", "plan"] }),
  range: str("query due only: today or this week.", { enum: ["today", "week"] }),
  part: str("query plan only: which part of the day, or the whole day.", { enum: ["morning", "afternoon", "evening", "day"] }),
  planDate: str("query plan only: YYYY-MM-DD of the day they ask about (\"tomorrow\", \"מחר\", \"Thursday\"). Empty for today."),
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
- moment: where the user is right now (place; "I'm a passenger", "in a taxi", "on the bus" → bus; "driving" → car; "on the train" → train), or how long they have free right now (minutes: "I have 30 minutes", "free for an hour"), or that their day runs later or earlier today (dayEnd: "my day can go until 11 pm"). Changes no task.
- project: the user wants a new project (put its name in project). If they also name tasks for it, add those too, each with that project.
- done: the user says they finished an existing task ("paid the arnona", "sent the stems").
- event: something at a fixed time ("dentist Thursday at 15:00", "meeting with Dana tomorrow 10:30"): a calendar event, not a task. Title, eventDate, time; minutes only if said; location when a place is named ("dentist at Assuta Thursday 15:00" → title "Dentist", location "Assuta"), kept out of the title.
- query: a question about their tasks, changing nothing: "what's next?" → next; "what's due today/this week?" → due with range; "what am I waiting on?" → waiting; "plan my afternoon / my day", "what's my schedule tomorrow?" → plan with part (morning, afternoon, evening, or day) and planDate when it isn't today.

Rules:
- Each value goes only in its own field. Dates go in dueDate or startDate as YYYY-MM-DD, never in waitingFor or title.
- Work out dates from today's date given below, and copy the words you read them from into dateWords.
- A message that is only a day or a time, with no task named, is about the Now card task: "by …" or an end ("end of …") sets its dueDate, any other day its startDate. "Next week" with no day means startDate = the coming Sunday.
- Only use an existing task when the message clearly refers to it. A new thing that only shares a word with an existing task is an add.
- The Now card (given below, when there is one) is the task the user is on right now. With no task named, "it", "this" and a bare finished / cancel / move / pending message mean the Now card task. A person's name alone doesn't name a task.
- A message that only corrects what was just added (a size, a date, a name, a person or a project, with no task named) changes the newest of the last tasks (given below, newest first); "both" means the two newest. A correction is an update of only that task (those two), never an add.
- Pushing or moving a task to a later day sets startDate (when it comes up again); its dueDate stays unless the user talks about the deadline.
- "The first one", "the second one" point at the cards of your own proposal, not at tasks: return no action for them.
- If more than one existing task could be the one they mean, and neither rule above settles it, return NO action for it; ask a question and give the candidate titles as choices.
- Fill only what the user said. Never invent minutes, dates or projects.
- A task that repeats ("every weekday", "3 times a week", "כל יום שני", "every month") is one add with repeatDays, timesPerWeek or repeatMonthly, never several tasks or a dueDate. Leave the repeat words out of the title.
- The reply is in the language of the user's message, short and plain, and says what you suggest.
- Never put a plain " inside a text value. Hebrew abbreviations take ״ or ׳ (לו״ז, ת״א, ג׳ונתן).

Examples (today is Monday 2026-10-05; tasks: t1 "Mix review for Reprise", t4 "Mix review for Lunitales", t2 "ביטוח לחיות", t3 "Pre-attack cue"):
Message: lesson prep for Thursday, invoices, call Uri 15 min
{"reply":"Add 3 tasks?","actions":[{"kind":"add","title":"Lesson prep","dateWords":"for Thursday","dueDate":"2026-10-08"},{"kind":"add","title":"Invoices"},{"kind":"add","title":"Call Uri","minutes":15}]}
Message: water plants every weekday
{"reply":"Add a task every weekday?","actions":[{"kind":"add","title":"Water plants","repeatDays":[0,1,2,3,4]}]}
Message: להתקשר לביטוח לאומי עד יום רביעי
{"reply":"להוסיף משימה ליום רביעי?","actions":[{"kind":"add","title":"להתקשר לביטוח לאומי","dateWords":"עד יום רביעי","dueDate":"2026-10-07"}]}
Message: push the mix review to next week
{"reply":"Which mix review?","question":"Which mix review?","choices":["Mix review for Reprise","Mix review for Lunitales"],"actions":[]}
Message: waiting on Yuval for the pre-attack cue
{"reply":"Set it to waiting on Yuval?","actions":[{"kind":"waiting","taskId":"t3","waitingFor":"Yuval"}]}
Message: add a project called Monster Punk
{"reply":"New project Monster Punk?","actions":[{"kind":"project","project":"Monster Punk"}]}
Message: new project חתונה: book the DJ, send invites
{"reply":"פרויקט חדש חתונה, עם 2 משימות?","actions":[{"kind":"project","project":"חתונה"},{"kind":"add","title":"Book the DJ","project":"חתונה"},{"kind":"add","title":"Send invites","project":"חתונה"}]}
Message: I'm wrecked and out
{"reply":"Out. Got it?","actions":[{"kind":"moment","place":"out"}]}
Message: I am passenger
{"reply":"Passenger. Got it?","actions":[{"kind":"moment","place":"bus"}]}
Message: I have 30 minutes
{"reply":"30 minutes free. Got it?","actions":[{"kind":"moment","minutes":30}]}
Message: my day can extend to 11 pm today
{"reply":"Day ends at 23:00 today. Got it?","actions":[{"kind":"moment","dayEnd":"23:00"}]}
Message: sent the pre-attack cue
{"reply":"Mark it done?","actions":[{"kind":"done","taskId":"t3"}]}
Message: רופא שיניים ביום חמישי ב-15:00
{"reply":"להוסיף ליומן ביום חמישי ב-15:00?","actions":[{"kind":"event","title":"רופא שיניים","dateWords":"ביום חמישי","eventDate":"2026-10-08","time":"15:00"}]}
Message: what's due this week?
{"reply":"Here's what's due this week:","actions":[{"kind":"query","query":"due","range":"week"}]}
Message: plan my afternoon
{"reply":"Here's the afternoon:","actions":[{"kind":"query","query":"plan","part":"afternoon"}]}
Message: מה הלו״ז שלי מחר?
{"reply":"הנה הלו״ז למחר:","actions":[{"kind":"query","query":"plan","part":"day","dateWords":"מחר","planDate":"2026-10-06"}]}

More examples, from the phrase bank's example rows (test/phrases, split "example"; only those rows go here). Same day; tasks: a1 "Invoice for the studio", a2 "Cue sheet for Yoni"; Now card: a2:
Message: buy milk
{"reply":"Add a task?","actions":[{"kind":"add","title":"Buy milk"}]}
Message: fmod session for the game, project Cave Run
{"reply":"New project Cave Run, with 1 task?","actions":[{"kind":"project","project":"Cave Run"},{"kind":"add","title":"FMOD session for the game","project":"Cave Run"}]}
Message: meeting with Dana Thursday 14:00
{"reply":"Add to the calendar Thursday 14:00?","actions":[{"kind":"event","title":"Meeting with Dana","dateWords":"Thursday","eventDate":"2026-10-08","time":"14:00"}]}
Message: call mom and pay rent, 15 min each
{"reply":"Add 2 tasks, 15 min each?","actions":[{"kind":"add","title":"Call mom","minutes":15},{"kind":"add","title":"Pay rent","minutes":15}]}
Message: call mom, pay rent, 30 min total
{"reply":"30 min each, or 30 split across both?","question":"30 min each, or 30 split across both?","choices":["30 min each","30 min total"],"actions":[]}
Message: practice guitar 45
{"reply":"Add a 45 min task?","actions":[{"kind":"add","title":"Practice guitar","minutes":45}]}
Message: report 3 hours, due Friday
{"reply":"Add a 3 h task due Friday?","actions":[{"kind":"add","title":"Report","minutes":180,"dateWords":"due Friday","dueDate":"2026-10-09"}]}
Message: send the invoice tomorrow
{"reply":"Move it to tomorrow?","actions":[{"kind":"update","taskId":"a1","dateWords":"tomorrow","dueDate":"2026-10-06"}]}
Message: call Dana tomorrow at 8
{"reply":"Add to the calendar tomorrow 08:00?","actions":[{"kind":"event","title":"Call Dana","dateWords":"tomorrow","eventDate":"2026-10-06","time":"08:00"}]}
Message: scratch that
{"reply":"OK, nothing changed.","actions":[]}
Message: no no, the other one
{"reply":"Which one do you mean?","actions":[]}
Message: לקנות חלב
{"reply":"להוסיף משימה?","actions":[{"kind":"add","title":"לקנות חלב"}]}
Message: mix לשיר 3, שעה וחצי
{"reply":"להוסיף משימה של שעה וחצי?","actions":[{"kind":"add","title":"mix לשיר 3","minutes":90}]}
Message: ביום חמישי הבא
{"reply":"איזה יום חמישי?","question":"יום חמישי הקרוב או זה שאחריו?","choices":["יום חמישי 8.10","יום חמישי 15.10"],"actions":[]}
Message: buy milk and eggs and uh no wait just milk
{"reply":"Add a task?","actions":[{"kind":"add","title":"Buy milk"}]}
Message: hmm what's next
{"reply":"Here's what's next:","actions":[{"kind":"query","query":"next"}]}
Message: finished the invoice
{"reply":"Mark it done?","actions":[{"kind":"done","taskId":"a1"}]}
Message: actually start it
{"reply":"Already on it.","actions":[]}
Message: the report is due soon
{"reply":"When is it due?","actions":[]}
Message: add 2 hours
{"reply":"Add 2 hours to which task?","actions":[]}`;

// mode "plan" (2026-10-07): Rethink on the day's proposed schedule. The app
// sends the open tasks, the free minutes left today, the current order and
// what the user wants changed; the answer is a new order of task ids. The app
// lays it on the clock itself (proposal.js timeline) and keeps a local
// reading of the same words as the fallback.
const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    order: { type: "ARRAY", items: { type: "STRING" }, description: "Task ids for today, in the order to do them. Only ids from the list." },
    note: { type: "STRING", description: "One short sentence on what changed, in the user's language." },
  },
  required: ["order"],
};
const PLAN_SYSTEM = `You re-plan the rest of today for the user of Daisey, a day-planning app.
You get the open tasks (id, title, project, minutes, type, due, dateKind), how many free minutes are left today, the current proposed order, and the user's instruction.
Return the task ids to do today, in order, following the instruction. Keep the total minutes at or under the free minutes. Keep hard deadlines due today or earlier unless the user explicitly says to drop them. Never invent ids. If the instruction is unclear, return the current order with a note asking what to change.`;

// mode "phone" (2026-10-09): on a ride (bus, passenger seat) only phone tasks
// fit, and most tasks are guessed Computer. The app sends its Computer tasks;
// the answer is the ids a phone can do start to finish.
const PHONE_SCHEMA = {
  type: "OBJECT",
  properties: { ids: { type: "ARRAY", items: { type: "STRING" }, description: "Ids of the tasks a smartphone alone can do start to finish. Only ids from the list." } },
  required: ["ids"],
};
const PHONE_SYSTEM = `You sort tasks for the user of Daisey, a day-planning app. They are on a bus or a passenger in a car, with only their smartphone.
You get tasks (id, title, project, type). Return the ids of the ones a phone alone can do start to finish: messages, emails, calls, short replies, booking, ordering, paying, renewing, signing up, reading, listening, quick lookups, simple forms.
Leave out anything that needs a computer (coding, audio or video editing, design, long writing, spreadsheets, building or testing software), a particular place, or being there in person. When unsure, leave it out. Never invent ids.`;

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
    const when = clean(a.dateWords, 60); // the user's words for the day: tell-read.js withDates works it out
    if (when && !["drop", "done", "project", "moment"].includes(kind)) x.when = when;
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
    if (kind === "add") {
      const days = [...new Set((Array.isArray(a.repeatDays) ? a.repeatDays : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      const per = Math.round(Number(a.timesPerWeek));
      if (days.length) x.routine = { per: days.length, days };
      else if (per >= 1 && per <= 7) x.routine = { per };
      else if (a.repeatMonthly === true) x.routine = { per: 1, every: "month" };
    }
    if (kind === "add" && !x.title) return [];
    if (kind === "update" && Object.keys(x).length <= 2) return []; // nothing to change
    if (kind === "waiting") {
      const on = clean(a.waitingFor ?? a.waitingOn, 80);
      if (on && !looksLikeDate(on)) x.waitingOn = on;
      if (isDay(a.checkOn)) x.checkOn = a.checkOn;
    }
    if (kind === "project") {
      const name = clean(a.project, 60);
      return name ? [{ kind, project: name }] : [];
    }
    if (kind === "event") {
      const title = clean(a.title), date = a.eventDate ?? a.startDate ?? a.dueDate, time = String(a.time || "");
      if (!title || !isDay(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return [];
      const size = a.minutes ?? a.size;
      const location = clean(a.location, 300);
      return [{ kind, title, date, time, minutes: Number.isFinite(size) && size > 0 && size <= 24 * 60 ? Math.round(size) : 60, ...(location ? { location } : {}), ...(x.when ? { when: x.when } : {}) }];
    }
    if (kind === "query") {
      if (!["next", "due", "waiting", "plan"].includes(a.query)) return [];
      return [{ kind, query: a.query, ...(a.query === "due" ? { range: a.range === "week" ? "week" : "today" } : {}),
        ...(a.query === "plan" ? { part: ["morning", "afternoon", "evening"].includes(a.part) ? a.part : "day",
          ...(isDay(a.planDate) ? { date: a.planDate } : {}), ...(x.when ? { when: x.when } : {}) } : {}) }];
    }
    if (kind === "moment") {
      if (["home", "out", "anywhere", "train", "bus", "car"].includes(a.place)) x.place = a.place;
      const free = Number.isFinite(a.minutes) ? Math.round(a.minutes) : 0;
      if (free >= 5 && free <= 240) x.minutes = free;
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(a.dayEnd || ""))) x.dayEnd = a.dayEnd;
      if (!x.place && !x.minutes && !x.dayEnd) return [];
    }
    return [x];
  });
  const choices = Array.isArray(out?.choices) ? out.choices.map((c) => clean(c, 80)).filter(Boolean).slice(0, 4) : [];
  const question = clean(out?.question, 200);
  return { reply: clean(out?.reply, 240), actions, ...(question && choices.length ? { question, choices } : {}) };
}

// The day's count for this user; true when it's allowed. If Blobs can't be
// reached the cap doesn't block — better a message too many than a dead feature.
async function bump(uid, day, failClosed = false){
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
    return failClosed ? null : true;
  }
}

// One call to Gemini; the parsed JSON, or null (busy, error, or an answer
// that isn't JSON — usually one that ran away and hit the token limit).
async function ask(key, prompt, system = SYSTEM, schema = SCHEMA){
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.1, maxOutputTokens: 1500 },
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

// Said after midnight, before the fixed 04:00 day boundary (app/js/daybound.js
// getDayKey, 2026-10-18): body.today is already the day they're still in, the
// one the cards call today, and body.afterMidnight says so. "Yesterday",
// "today" and "tomorrow" count from it, one source of truth with the app
// (daybound.js dateForWord): at 01:51 Sunday, today is Saturday.
const shiftDay = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nightWords = (today, wake) => `\nIt is after midnight, before the 04:00 day boundary, and the user hasn't slept yet: their day is still ${today}. "Today" (היום) and "tonight" (הלילה) mean ${today}; "yesterday" (אתמול) means ${shiftDay(today, -1)}; "tomorrow" (מחר) and "this morning" mean ${wake}, the morning they wake into.`;
const upLateLine = (body) => {
  if (body.afterMidnight === true && isDay(body.today)) return nightWords(body.today, shiftDay(body.today, 1));
  // An older app sends the calendar's date as today and the day they're still in as upLate.
  return isDay(body.upLate) && isDay(body.today) && body.upLate < body.today ? nightWords(body.upLate, body.today) : "";
};

exports.handler = async (event) => {
  // GET: is it set up? Says only whether a key is present, never the key.
  if (event.httpMethod === "GET") return reply(200, { configured: !!process.env.GEMINI_API_KEY, model: MODEL });
  if (event.httpMethod !== "POST") return fail(405, "method");
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return fail(400, "bad_input"); }
  const headers = event.headers || {};
  const guest = body.guest === true && (headers["x-daisey-guest"] || headers["X-Daisey-Guest"]) === "1";
  let claims;
  let rateId;
  if (guest) {
    // Trust only Netlify's client-IP header, not caller-controlled forwarded
    // headers. Store a hash rather than the raw address in the rate-limit key.
    const ip = headers["x-nf-client-connection-ip"];
    if (!ip) return fail(503, "guest_limit_unavailable");
    rateId = `guest:${crypto.createHash("sha256").update(ip).digest("hex")}`;
  } else {
    try {
      const token = (headers.authorization || headers.Authorization || "").replace(/^Bearer\s+/i, "");
      claims = await verifyIdToken(token);
    } catch {
      return fail(401, "no_session");
    }
    rateId = claims.sub;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail(503, "not_configured");

  const text = clean(body.text, MAX_TEXT);
  if ((!text && body.mode !== "phone") || !isDay(body.today)) return fail(400, "bad_input");
  const rateDay = guest ? new Date().toISOString().slice(0, 10) : body.today;
  const allowed = await bump(rateId, rateDay, guest);
  if (allowed === null) return fail(503, "guest_limit_unavailable");
  if (!allowed) return fail(429, "daily_cap");

  if (body.mode === "phone") {
    const list = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, MAX_TASKS)
      .map((t) => ({ id: clean(t.id, 60), title: clean(t.title, 120), project: clean(t.project, 60), type: clean(t.type, 12) }))
      .filter((t) => t.id && t.title);
    const ids = new Set(list.map((t) => t.id));
    const prompt = `Tasks: ${JSON.stringify(list)}`;
    const out = (await ask(key, prompt, PHONE_SYSTEM, PHONE_SCHEMA)) || (await ask(key, prompt, PHONE_SYSTEM, PHONE_SCHEMA));
    if (!out) return fail(502, "model");
    return reply(200, { ids: [...new Set((Array.isArray(out.ids) ? out.ids : []).map((x) => clean(x, 60)).filter((x) => ids.has(x)))] });
  }

  if (body.mode === "plan") {
    const open = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, MAX_TASKS)
      .map((t) => ({ id: clean(t.id, 60), title: clean(t.title, 120), project: clean(t.project, 60), minutes: Math.max(5, Math.min(600, Number(t.minutes) || 30)),
        type: clean(t.type, 12), due: isDay(t.due) ? t.due : undefined, dateKind: clean(t.dateKind, 10) || undefined }))
      .filter((t) => t.id && t.title);
    const ids = new Set(open.map((t) => t.id));
    const current = (Array.isArray(body.current) ? body.current : []).map((x) => clean(x, 60)).filter((x) => ids.has(x));
    const free = Math.max(0, Math.min(24 * 60, Number(body.freeMinutes) || 0));
    const prompt = `Today: ${clean(body.weekday, 12)} ${body.today}. Now: ${clean(body.time, 5)}. Free minutes left today: ${free}.
Tasks: ${JSON.stringify(open)}
Current order: ${JSON.stringify(current)}

Instruction: ${text}`;
    const out = (await ask(key, prompt, PLAN_SYSTEM, PLAN_SCHEMA)) || (await ask(key, prompt, PLAN_SYSTEM, PLAN_SCHEMA));
    if (!out) return fail(502, "model");
    const order = [...new Set((Array.isArray(out.order) ? out.order : []).map((x) => clean(x, 60)).filter((x) => ids.has(x)))];
    return reply(200, { order, note: clean(out.note, 200) });
  }

  const out = await understand(body, key);
  if (!out) return fail(502, "model");
  return reply(200, out);
};

// One message, no session or cap: the prompt, the model, tidy(). The handler's
// last step, and what test/phrases/run.mjs drives with its own clock and tasks.
// → tidy()'s answer, or null when the model failed twice.
async function understand(body, key){
  const text = clean(body.text, MAX_TEXT);
  const tasks = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, MAX_TASKS)
    .map((t) => ({ id: clean(t.id, 60), title: clean(t.title, 120), project: clean(t.project, 60), due: isDay(t.due) ? t.due : undefined, status: clean(t.status, 12) }))
    .filter((t) => t.id && t.title);
  const projects = (Array.isArray(body.projects) ? body.projects : []).map((p) => clean(p, 60)).filter(Boolean).slice(0, 60);
  const late = upLateLine(body);
  // The Now card and the last tasks added or edited (tell-read.js requestBody): what "done" and "make it 30" point at.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const card = byId.get(clean(body.now, 60));
  const recent = (Array.isArray(body.recent) ? body.recent : []).map((x) => clean(x, 60)).filter((x) => byId.has(x)).slice(0, 3);
  const context = `${card ? `\nNow card: ${card.id} ${JSON.stringify(card.title)}` : ""}${recent.length ? `\nLast tasks added or edited, newest first: ${recent.map((id) => `${id} ${JSON.stringify(byId.get(id).title)}`).join(", ")}` : ""}`;
  const prompt = `Today: ${clean(body.weekday, 12)} ${body.today}.${late}\nProjects: ${JSON.stringify(projects)}\nTasks: ${JSON.stringify(tasks)}${context}\n\nMessage: ${text}`;

  const out = (await ask(key, prompt)) || (await ask(key, prompt)); // one retry
  return out ? tidy(out, new Set(tasks.map((t) => t.id))) : null;
}

exports.tidy = tidy; // for the tests
exports.upLateLine = upLateLine;
exports.understand = understand; // for test/phrases/run.mjs
exports.MODEL = MODEL;
exports.SYSTEM = SYSTEM;
exports.PROMPT_VERSION = PROMPT_VERSION;
