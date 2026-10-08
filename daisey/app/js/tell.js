// Tell Daisey (DAISEY_SPEC "Chat"): the bar at the bottom. Type or say one
// thing — "mix review for Reprise, 2 h, by Thursday", "waiting on Yuval for
// the cue", "I'm wrecked" — and Daisey shows what it understood as cards.
// Nothing changes until you tap Apply; ✕ drops one card, Edit opens a new
// task in the full form.
//
// The understanding happens server-side (functions/daisey-now-chat.js, Gemini
// Flash-Lite); this file only sends the message with the open task titles,
// shows the answer, and applies what was confirmed through the same store
// calls the rest of the app uses. With no key set on the server it falls back
// to what the bar did before: the Add task form with the text in it.
//
// The mic uses the browser's own speech-to-text, so a spoken message goes
// down the same path as a typed one. Where there's none, it opens the keyboard.
import { idToken } from "./firebase.js";
import { watchTasks, addTask, updateTask, saveMoment, finishTask } from "./store.js";
import { localDate, LABELS, dayAfter } from "./model.js";
import { createEvent, watchCalendar } from "./calendar.js";
import { planDay } from "./plan.js";
import { planView } from "./plan-view.js";
import { dayHours } from "./day.js";
import { watchSettings, watchRun, saveSettings } from "./store.js";
import { rank } from "./engine.js";
import { workBase } from "./context.js";
import { effectiveDue } from "./triage.js";
import { h, bdi, dur, flash } from "./ui.js";

const URL_ = "/.netlify/functions/daisey-now-chat";
const SAID = {
  daily_cap: "That's today's limit for Tell Daisey. It resets tomorrow.",
  model: "Couldn't reach Daisey's helper.",
  network: "Couldn't reach Daisey's helper.",
  bad_input: "Couldn't read that one. Try saying it another way?",
  no_session: "Signed out. Sign in again and retry.",
  guest_limit_unavailable: "Tell Daisey is temporarily unavailable. Try again shortly.",
};
const day = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const PLACE = { home: "Home", out: "Out", anywhere: "Anywhere" };

// Examples in the bar (master spec §13, 2026-10-06): while it's empty and not
// in use, the placeholder turns between "Tell Daisey…" and one thing it really
// handles, picked for the moment. Only what daisey-now-chat.js understands
// (its KINDS), never a promise it can't keep, and short enough for a phone.
// 2026-10-08: built from the person's own tasks and projects, so an example
// is something they could really say now. With nothing yet, everyday ones
// with no names in them: a made-up "Uri" reads as someone else's data.
const cut = (s, n = 22) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const START = ["Call the bank tomorrow at 10", "Groceries, laundry, pay rent", "Gym, 1 h, tomorrow", "Dentist Thursday at 9", "I have 30 minutes"];
export function hintsFor(tasks, hour = new Date().getHours()){
  const ready = tasks.filter((t) => t.status === "ready");
  if (!ready.length && !tasks.some((t) => t.status === "waiting")) return START;
  const own = [];
  if (ready[0]) own.push(`Done with ${cut(ready[0].title)}`);
  if (ready[1]) own.push(`Move ${cut(ready[1].title, 18)} to tomorrow`);
  if (tasks.some((t) => t.status === "waiting")) own.push("What am I waiting on?");
  const project = ready.find((t) => t.project)?.project;
  if (project) own.push(`${cut(project, 16)}: new task, 1 h`);
  if (ready[2]) own.push(`${cut(ready[2].title)} by Friday`);
  return [...own, "What's next?", hour < 15 ? "Plan my afternoon" : "Plan my evening", "I have 30 minutes", "What's due this week?", "I'm wrecked"];
}
const HINT_MS = 4500;

// form/input/mic: the bar's own elements (index.html). openAdd(project, title):
// the Add task form, prefilled.
export function mountTell(form, input, mic, uid, { openAdd, openTask, guest = false }){
  let tasks = [];
  const panel = h("section", { className: "tell-panel", ariaLabel: "What Daisey understood", ariaLive: "polite", hidden: true });
  form.before(panel);
  const stop = watchTasks(uid, (ts) => { tasks = ts || []; }, (e) => console.error("[daisey] tell", e));
  let busy = false;
  let cal = { status: "loading", events: [] }, settings = {}, run = null; // for "plan my afternoon"
  const stops = [watchCalendar((c) => { cal = c; }), watchSettings(uid, (s) => { settings = s || {}; }, () => {}), watchRun(uid, (r) => { run = r; }, () => {})];
  const plain = input.placeholder;
  let turn = 0;
  const hinting = setInterval(() => {
    if (input.value || rec || document.activeElement === input || document.hidden) return;
    const list = hintsFor(tasks);
    input.placeholder = turn % 2 ? plain : `“${list[Math.floor(turn / 2) % list.length]}”`;
    turn++;
  }, HINT_MS);

  const close = () => { panel.hidden = true; panel.replaceChildren(); };
  const show = (...kids) => { panel.replaceChildren(...kids.filter(Boolean)); panel.hidden = false; };
  const byId = (id) => tasks.find((t) => t.id === id);

  async function ask(text){
    if (busy || !text) return;
    busy = true;
    // Sent: the bar empties now, not when the answer lands. Blur first, or an
    // Android keyboard still composing the last word puts it straight back.
    if (input.value.trim() === text) { input.blur(); input.value = ""; }
    show(h("p", { className: "tell-said", dir: "auto", textContent: `“${text}”` }), h("p", { className: "tell-thinking", textContent: "Reading…" }));
    const open = tasks.filter((t) => t.status !== "done" && t.status !== "dropped");
    let res, body;
    try {
      const headers = { "Content-Type": "application/json" };
      if (guest) headers["X-Daisey-Guest"] = "1";
      else headers.Authorization = `Bearer ${await idToken()}`;
      res = await fetch(URL_, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text, today: localDate(), weekday: new Date().toLocaleDateString("en", { weekday: "long" }),
          ...(guest ? { guest: true } : {}),
          tasks: open.map((t) => ({ id: t.id, title: t.title, project: t.project, due: t.due || undefined, status: t.status })),
          projects: [...new Set(open.map((t) => t.project))],
        }),
      });
      body = await res.json().catch(() => ({}));
    } catch {
      body = { error: "network" };
    }
    busy = false;
    if (body.error === "not_configured") { close(); openAdd(undefined, text); return; } // no AI yet: the old path
    if (!res?.ok || body.error) {
      const code = body.error || "model";
      show(h("p", { className: "tell-reply", textContent: SAID[code] || SAID.model }),
        h("div", { className: "tell-btns" },
          code !== "daily_cap" && h("button", { className: "btn line", type: "button", textContent: "Try again", onclick: () => ask(text) }),
          h("button", { className: "btn line", type: "button", textContent: "Add as a task", onclick: () => { close(); input.value = ""; openAdd(undefined, text); } }),
          h("button", { className: "btn quiet", type: "button", textContent: "Close", onclick: close })));
      return;
    }
    proposal(text, body);
  }

  // The answer: one line, then a card per change, then Apply.
  function proposal(text, { reply, actions = [], question, choices = [] }){
    const list = [...actions];
    const draw = () => {
      const queries = list.filter((a) => a.kind === "query");
      const cards = list.map((a, i) => a.kind === "query" ? null : card(a, () => { list.splice(i, 1); draw(); })).filter(Boolean);
      const applicable = list.filter((a) => a.kind !== "project" && a.kind !== "query"); // a project card has its own button
      show(
        h("div", { className: "tell-head" },
          h("p", { className: "tell-reply", dir: "auto", textContent: reply || (list.length ? "Here's what I got:" : "Nothing to change.") }),
          h("button", { className: "tell-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: close })),
        question && h("div", { className: "tell-ask" },
          h("p", { dir: "auto", textContent: question }),
          h("div", { className: "tell-choices" }, ...choices.map((c) => h("button", { className: "chip", type: "button", dir: "auto", textContent: c,
            onclick: () => ask(`${text}\n(${question} → ${c})`) })))),
        ...queries.map(answer),
        cards.length > 0 && h("ul", { className: "tell-cards" }, ...cards),
        applicable.length > 0 && h("div", { className: "tell-btns" },
          h("button", { className: "btn primary start", type: "button", textContent: applicable.length > 1 ? `Apply all ${applicable.length}` : "Apply",
            onclick: () => apply(applicable) }),
          h("button", { className: "btn quiet", type: "button", textContent: "Cancel", onclick: close })));
    };
    draw();
  }

  // A question about the list, answered here from the tasks the app already
  // has (2026-10-06): what's next (the engine's top 3, without the calendar's
  // window), what's due today / this week, what's pending on whom.
  function answer(q){
    if (q.query === "plan") {
      const plan = planDay({ tasks, events: cal.status === "ok" ? cal.events : [], hours: dayHours(settings), settings, run });
      const v = planView(plan, { only: q.part === "day" ? null : q.part, onOpen: (t) => { close(); openTask?.(t); } });
      return h("div", { className: "tell-answer" }, v || h("p", { className: "tell-reply", textContent: "No free time left there." }));
    }
    const open = tasks.filter((t) => t.status === "ready" || t.status === "waiting");
    let rows = [];
    if (q.query === "next") {
      rows = rank(tasks, { realWindow: false, ...workBase(tasks) }).ranked.slice(0, 3).map((s) => [s.task.title, s.why]);
    } else if (q.query === "due") {
      const until = q.range === "week" ? dayAfter(6) : localDate();
      rows = open.filter((t) => t.due && effectiveDue(t) <= until).sort((a, b) => effectiveDue(a).localeCompare(effectiveDue(b)))
        .map((t) => [t.title, `${t.dateKind === "deadline" ? "deadline" : "planned"} ${day(effectiveDue(t))}`]);
    } else {
      rows = open.filter((t) => t.status === "waiting").map((t) => [t.title, t.waitingOn ? `waiting on ${t.waitingOn}` : "pending"]);
    }
    return h("div", { className: "tell-answer" }, rows.length
      ? h("ul", { className: "tell-cards" }, ...rows.map(([title, meta]) => h("li", { className: "tell-card" },
        h("div", { className: "tell-card-main" }, h("span", { className: "tell-title", dir: "auto", textContent: title }),
          meta && h("span", { className: "tell-meta", dir: "auto", textContent: meta })))))
      : h("p", { className: "tell-reply", textContent: "Nothing there." }));
  }

  // One proposed change, in words. ✕ drops it; a new task can open in the full form.
  function card(a, drop){
    const t = a.taskId ? byId(a.taskId) : null;
    const bits = [];
    if (a.kind === "add") {
      if (a.project) bits.push(a.project);
      if (a.size) bits.push(dur(a.size));
      if (a.notBefore) bits.push(`starts ${day(a.notBefore)}`);
      if (a.due) bits.push(`${a.dateKind === "deadline" ? "deadline" : "by"} ${day(a.due)}`);
    } else if (a.kind === "update") {
      if (a.title) bits.push(`rename → ${a.title}`);
      if (a.project) bits.push(`project → ${a.project}`);
      if (a.size) bits.push(`size → ${dur(a.size)}`);
      if (a.due) bits.push(`${a.dateKind === "deadline" ? "deadline" : "due"} → ${day(a.due)}`);
      if (a.notBefore) bits.push(`not before ${day(a.notBefore)}`);
    } else if (a.kind === "waiting") {
      bits.push(a.waitingOn ? `pending: waiting on ${a.waitingOn}` : "pending");
    } else if (a.kind === "event") {
      bits.push(`${day(a.date)} ${a.time}`, dur(a.minutes));
    } else if (a.kind === "moment") {
      if (a.place) bits.push(PLACE[a.place]);
      if (a.minutes) bits.push(`${dur(a.minutes)} free`);
      if (a.dayEnd) bits.push(`day ends ${a.dayEnd} today`);
    }
    const LABEL = { add: "New task", update: "Change", waiting: "Pending", drop: "Drop", moment: "Right now", project: "New project", done: "Done", event: "New event" };
    const title = a.kind === "add" || a.kind === "event" ? a.title : a.kind === "project" ? a.project : a.kind === "moment" ? null : t?.title;
    // A project lives through its tasks, so it starts with the first one:
    // the task form, with the new project already chosen.
    if (a.kind === "project") bits.push("starts with its first task");
    return h("li", { className: `tell-card k-${a.kind}` },
      h("div", { className: "tell-card-main" },
        h("span", { className: "tell-kind", textContent: LABEL[a.kind] }),
        title && h("span", { className: "tell-title", dir: "auto", textContent: title }),
        bits.length > 0 && h("span", { className: "tell-meta" }, ...bits.flatMap((b, i) => (i ? [" · ", bdi(b)] : [bdi(b)])))),
      a.kind === "project" && h("button", { className: "btn primary small tell-first", type: "button", textContent: "Add first task",
        onclick: () => { close(); input.value = ""; openAdd(a.project, ""); } }),
      a.kind === "add" && h("button", { className: "tell-edit", type: "button", textContent: "Edit",
        ariaLabel: `Edit ${a.title} in the full form`, onclick: () => { close(); openAdd(a.project, a.title); } }),
      h("button", { className: "tell-x", type: "button", ariaLabel: "Don't do this one", textContent: "✕", onclick: drop }));
  }

  async function apply(list){
    const now = Date.now();
    const jobs = list.map((a) => {
      const t = a.taskId ? byId(a.taskId) : null;
      const pick = (keys) => Object.fromEntries(keys.filter((k) => a[k] != null).map((k) => [k, a[k]]));
      if (a.kind === "add") return addTask(uid, pick(["title", "project", "size", "due", "dateKind", "notBefore"]), tasks);
      if (a.kind === "event") return createEvent({ title: a.title, date: a.date, at: a.time, minutes: a.minutes });
      if (!t && a.kind !== "moment") return null; // gone since
      if (a.kind === "done") return finishTask(uid, t, { tasks });
      if (a.kind === "update") return updateTask(uid, t, pick(["title", "project", "size", "due", "dateKind", "notBefore"]), tasks);
      if (a.kind === "waiting") return updateTask(uid, t, { status: "waiting", waitingOn: a.waitingOn || "" }, tasks);
      if (a.kind === "drop") return updateTask(uid, t, { status: "dropped" }, tasks);
      if (a.kind === "moment") return Promise.all([a.dayEnd ? saveSettings(uid, { dayEndToday: { date: localDate(), end: a.dayEnd } }) : null, (a.place || a.minutes) ? saveMoment(uid, { ...(a.place ? { place: { value: a.place, at: now } } : {}), ...(a.minutes ? { free: { minutes: a.minutes, at: now } } : {}) }) : null]);
      return null;
    }).filter(Boolean);
    close();
    input.value = "";
    try {
      await Promise.all(jobs);
      flash(jobs.length === 1 ? "Done." : `Done: ${jobs.length} changes.`, "");
    } catch (e) {
      console.error("[daisey] tell apply", e);
      flash("Some of that didn't save.", "");
    }
  }

  // ---------- the bar ----------
  form.onsubmit = (e) => { e.preventDefault(); ask(input.value.trim()); };

  // Speaking (2026-10-08): some browsers never end on their own, so Daisey
  // keeps its own ear. After SILENCE_MS with no new words it sends; a ring on
  // the mic fills over that pause so the send never comes as a surprise, and
  // a tap sends at once. Slower than a voice assistant on purpose: a breath
  // mid-thought must not cut the message off. Silence from the start just
  // stops listening, with nothing sent.
  const SILENCE_MS = 2200, NOTHING_MS = 7000, MAX_MS = 45000;
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, quiet = 0, cap = 0;
  const idle = Speech ? "Speak to Daisey" : "Type to Daisey";
  mic.ariaLabel = idle;
  const settle = () => { mic.classList.remove("settling"); void mic.offsetWidth; mic.classList.add("settling"); };
  const ended = () => { clearTimeout(quiet); clearTimeout(cap); mic.classList.remove("listening", "settling"); mic.ariaLabel = idle; input.placeholder = plain; rec = null; };
  mic.onclick = () => {
    if (rec) { rec.stop(); return; } // listening: a tap sends what's heard
    if (input.value.trim()) { ask(input.value.trim()); return; } // text waiting: the mic sends it
    if (!Speech) { input.focus(); return; }
    rec = new Speech();
    const langs = navigator.languages || [navigator.language];
    rec.lang = langs.some((l) => /^he|^iw/.test(l)) ? "he-IL" : navigator.language || "en-US";
    rec.interimResults = true;
    rec.onresult = (e) => {
      input.value = [...e.results].map((r) => r[0].transcript).join("");
      clearTimeout(quiet);
      quiet = setTimeout(() => rec?.stop(), SILENCE_MS);
      settle();
    };
    rec.onend = () => { ended(); if (input.value.trim()) ask(input.value.trim()); };
    rec.onerror = () => { ended(); };
    mic.classList.add("listening");
    mic.ariaLabel = "Listening. Tap to send";
    input.placeholder = "Listening…";
    quiet = setTimeout(() => rec?.abort(), NOTHING_MS);
    cap = setTimeout(() => rec?.stop(), MAX_MS);
    rec.start();
  };

  // ask(text): a message from outside the bar (a share into Daisey).
  return { ask, unmount(){ stop(); stops.forEach((s) => s()); clearInterval(hinting); input.placeholder = plain; rec?.abort(); close(); panel.remove(); form.onsubmit = mic.onclick = null; } };
}
