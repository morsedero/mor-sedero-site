// The Now tab: one line of context, then the Now card — one task that fits
// this moment, and why. Daisey picks one task at a time; it never lays out
// the day (the day planner was removed, 2026-10-03).
//
// Free time comes only from the calendar — Daisey never asks for it (Mor,
// 2026-10-03). It's the time until the next busy event (calendar.js, read
// through old Daisey's Google token). With no calendar the engine's default
// 60 min only filters what fits and scores nothing.
// Not now → next pick (hidden for this page load). Something else → 2–3
// alternatives, tap one to make it the card. Start → focus mode (focus.js):
// the run lives in Firestore, so this tab, a reload and the phone all show
// the same timer.
import { watchTasks, watchRun, watchSkips, saveSkips, startRun, extendRun, endRun, startBatch, tickBatch, endBatch, skipNow, blockTask, restoreTask, watchSettings, saveSettings, watchMoment, saveMoment, watchLearn, bumpLearn } from "./store.js";
import { energyNow, placeNow, workBase } from "./context.js";
import { shouldOffer, sweepList, pickWeekDay } from "./triage.js";
import { focusView, handoffView, elapsedMinutes, batchFocusView, batchName, sinceMark } from "./focus.js";
import { watchCalendar } from "./calendar.js";
import { LATER_MINUTES, DRAIN } from "./weights.js";
import { rank, freeWindow, whySaid, timeBucket, matchProject } from "./engine.js";
import { localDate, skipSnapshot } from "./model.js";
import { h, icon, bdi, pieces, sizeText, dur, say } from "./ui.js";

// Nothing sits above the card but the warnings below: the date and time are
// in the top bar (main.js) and the day is in the Schedule panel.
const LATER_MS = LATER_MINUTES * 60000;
const UNDO_MS = 5000;
const SLIDE_MS = 140; // matches the card-out animation in app.css
const motionOK = () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const CAL_NOTE = {
  not_connected: "Calendar not connected. Sign in to the old Daisey once to link it.",
  needs_reauth: "Calendar sign-in expired. Sign in to the old Daisey again to refresh it.",
};

// onCard(id | null) fires whenever the task on the card changes, so the task
// list can set it aside while it's "physically" on the card.
// onSweep() opens the old-dates sweep (sweep.js). onProject(name) shows that
// project's tab in Tasks.
export function mountNow(root, uid, { onCard, onSweep, onProject } = {}){
  let tasks = null; // null until the first snapshot
  let settings = {}; // state/settings: when the sweep was last offered
  let momentDoc = {}; // state/moment: energy and place corrections
  let learnStats = {}; // state/learn: starts and skips per type and time of day
  let ctxOpen = null; // "energy" | "place": the chip whose choices are showing
  let cal = { status: "loading", events: [] };
  let lastWindow, lastClock;
  let run = null; // the state/now doc while a task is running
  let handoff = null; // { title, next } after Done, until the next choice
  // The event you said you're free from, as its start time in ms (what
  // engine.freeWindow reports). Cleared on its own once that event is no
  // longer the one running.
  let freeFrom = null;
  let toast = null; // { text, task, before } for 5 s after Later or Pending
  let slideIn = false; // one slide per step-aside, not one per snapshot
  let toastTimer = null;
  // laterAsk: Later was tapped and the card is asking "when?"
  // pendAsk: Pending was tapped and the card asks what it's waiting on.
  const state = { chosen: null, showAlts: false, asking: false, laterAsk: false, pendAsk: false };
  // { date, items: { id: { count, until } } } — today's Laters, from Firestore.
  let skipDoc = null;
  const skipItems = () => (skipDoc?.date === localDate() ? skipDoc.items || {} : {});
  const hidden = (now = Date.now()) => Object.entries(skipItems()).filter(([, v]) => v.until > now).map(([id]) => id);
  const skipCounts = () => Object.fromEntries(Object.entries(skipItems()).map(([id, v]) => [id, v.count]));
  const skips = {
    add(id){
      const items = { ...skipItems() };
      items[id] = { count: (items[id]?.count || 0) + 1, until: Date.now() + LATER_MS };
      skipDoc = { date: localDate(), items };
      saveSkips(uid, skipDoc).catch(fail);
    },
    delete(id){
      const items = { ...skipItems() };
      delete items[id];
      skipDoc = { date: localDate(), items };
      saveSkips(uid, skipDoc).catch(fail);
    },
    clear(){
      skipDoc = { date: localDate(), items: {} };
      saveSkips(uid, skipDoc).catch(fail);
    },
    get size(){ return hidden().length; },
  };
  const reset = () => { state.chosen = null; state.showAlts = false; state.asking = false; state.laterAsk = false; state.pendAsk = false; state.pendText = ""; state.single = false; };
  let shown;
  const showing = (id) => { if (id !== shown) { shown = id; onCard?.(id); } };

  // The card Daisey is proposing says its reasons in the first person; the
  // alternatives keep the plain why line, so only one voice is speaking.
  // Names in the why line (projects, people, events) are their own <bdi>.
  function taskCard(s, main, ...extra){
    const why = main ? whySaid(s) : sentence(s.whyParts);
    return h("div", { className: "now-card" + (main ? " main" : "") },
      main && contextLine(),
      h("div", { className: "now-meta" }, ...(main && s.task.project !== "Inbox"
        // On the card the project name leads to its tab in Tasks.
        ? [h("button", { type: "button", className: "now-proj", title: `Show ${s.task.project} in Tasks`,
            onclick: () => onProject?.(s.task.project) }, bdi(s.task.project)), document.createTextNode(" · "), bdi(sizeText(s.task.size))]
        : pieces(s.task.project, sizeText(s.task.size)))),
      h("div", { className: "now-title", dir: "auto", textContent: s.task.title }),
      s.task.nextStep && h("p", { className: "now-next" }, "Next: ", bdi(s.task.nextStep)),
      why && h("p", { className: "now-why" }, ...say(why)),
      ...extra);
  }

  // The engine's pieces as a plain sentence: capital first, full stop last.
  function sentence(parts){
    if (!parts?.length) return null;
    const [first, ...rest] = parts;
    return [typeof first === "string" ? first[0].toUpperCase() + first.slice(1) : first, ...rest, "."];
  }

  // Energy and place right now: the user's correction for 3 hours, else
  // Daisey's guess from the time of day and the calendar (context.js).
  function feel(){
    const events = cal.status === "ok" ? cal.events : [];
    return {
      energy: energyNow({ correction: momentDoc.energy, history: momentDoc.history || [], events }),
      place: placeNow({ correction: momentDoc.place, events }),
    };
  }

  const PLACES = [["home", "Home"], ["out", "Out"], ["anywhere", "Anywhere"]];
  const ENERGIES = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];

  // The card's context line: "45 min free · Home · energy medium (guess)".
  // Place and energy are chips; tapping one shows its three choices, and a
  // choice is a correction that holds for 3 hours on every device.
  function contextLine(){
    const f = feel(), fw = calendarNow(), block = blockOf(fw);
    const chip = (k, text, guessed) => h("button", { type: "button", className: "ctx-chip" + (guessed ? " guess" : ""),
      ariaExpanded: String(ctxOpen === k), ariaLabel: `${k === "place" ? "Where you are" : "Your energy"}: ${text}${guessed ? ", Daisey's guess" : ""}. Change`,
      onclick: () => { ctxOpen = ctxOpen === k ? null : k; render(); } }, text);
    const choose = (k, value) => {
      const at = Date.now();
      const patch = k === "place" ? { place: { value, at } } : {
        energy: { value, at },
        // Every correction teaches the pattern for this time of day.
        history: [...(momentDoc.history || []).slice(-49), { ...timeBucket(at), value }],
      };
      momentDoc = { ...momentDoc, ...patch };
      ctxOpen = null;
      render();
      saveMoment(uid, patch).catch(fail);
    };
    const opts = ctxOpen && h("div", { className: "ctx-opts", role: "radiogroup", ariaLabel: ctxOpen === "place" ? "Where you are" : "Your energy" },
      ...(ctxOpen === "place" ? PLACES : ENERGIES).map(([v, text]) => h("button", { type: "button", className: "chip", role: "radio",
        ariaChecked: String(f[ctxOpen].value === v), textContent: text, onclick: () => choose(ctxOpen, v) })));
    return h("div", { className: "ctx" },
      h("div", { className: "ctx-line" },
        fw && !fw.current && h("span", { textContent: `${dur(Math.min(fw.window, 180))}${fw.window >= 180 ? "+" : ""} free` }),
        block && (block.taskId
          ? h("span", { className: "ctx-block", textContent: `Planned until ${clock(block.end)}` })
          : h("span", { className: "ctx-block" }, "Working on ", bdi(block.project), ` until ${clock(block.end)}`)),
        chip("place", PLACES.find(([v]) => v === f.place.value)[1], f.place.guessed),
        chip("energy", `energy ${f.energy.value}${f.energy.guessed ? " (guess)" : ""}`, f.energy.guessed)),
      opts);
  }

  // The calendar's answer to "what now": the event that's running, when it
  // ends and what's left of it. Same card as a task's, so the top of the
  // screen always reads the same way — one thing, in big type, with its
  // reason under it.
  // freeWindow hands back start/end already parsed to epoch ms, not the ISO
  // strings the calendar fetch holds.
  function meetingCard(ev){
    const end = ev.end;
    const left = Math.max(0, Math.round((end - Date.now()) / 60000));
    return h("div", { className: "now-card main meeting" },
      h("div", { className: "now-meta", textContent: `Now · until ${clock(end)}` }),
      h("div", { className: "now-title", dir: "auto", textContent: ev.title }),
      h("p", { className: "now-why", textContent: left
        ? `${dur(left)} left. Daisey picks a task again when it ends.`
        : "Just about done." }),
      h("button", { className: "btn quiet", type: "button", textContent: "I'm free now",
        ariaLabel: `I'm free now: ignore ${ev.title} and pick a task anyway`,
        onclick: () => { freeFrom = ev.start; render(); } }));
  }

  // Focus mode and the handoff own the whole screen (body.focus hides the
  // tabs, the greeting and the + button).
  // A batch: a checklist in focus mode. The last tick ends it and hands off
  // like Done; Stop leaves the unticked ones open with their share of the time.
  function renderBatch(){
    const byId = new Map((tasks || []).map((t) => [t.id, t]));
    const list = run.batch.map((id) => byId.get(id)).filter(Boolean);
    const type = list[0]?.type;
    showing(run.taskId);
    return batchFocusView(run, list, type, {
      onTick: (t) => {
        const prev = run, minutes = sinceMark(run);
        const done = [...(run.done || []), t.id];
        const last = list.every((x) => done.includes(x.id));
        if (last) {
          handoff = { title: batchName(type, list.length), skip: prev.taskId };
          tickBatch(uid, prev, t, minutes).then(() => endBatch(uid, [], 0)).catch(fail);
          run = null;
        } else {
          run = { ...run, done, mark: Date.now() };
          tickBatch(uid, prev, t, minutes).catch(fail);
        }
        render();
      },
      onStop: () => {
        const left = list.filter((x) => !(run.done || []).includes(x.id));
        endBatch(uid, left, sinceMark(run)).catch(fail);
        run = null; render();
      },
    });
  }

  function renderFocus(){
    if (run.batch) return renderBatch();
    const task = tasks?.find((t) => t.id === run.taskId) || null;
    showing(run.taskId);
    return focusView(run, task, {
      onDone: (finished) => {
        if (finished === undefined) { state.asking = true; render(); return; }
        const minutes = elapsedMinutes(run);
        state.asking = false;
        handoff = { title: task ? task.title : "", skip: run.taskId };
        endRun(uid, task, minutes, { finished }).catch(fail);
        run = null; render();
      },
      // Stop keeps the task yours; Stuck also sets it Pending (Waiting).
      onStop: ({ pending } = {}) => {
        const minutes = elapsedMinutes(run);
        state.asking = false;
        endRun(uid, task, minutes, { finished: false })
          .then(() => (pending && task ? blockTask(uid, task) : null)).catch(fail);
        run = null; render();
      },
      onExtend: (m) => { const prev = run; run = { ...run, extra: (run.extra || 0) + m }; render(); extendRun(uid, prev, m).catch(fail); },
    }, state);
  }

  const begin = (task) => { bumpLearn(uid, task.type, timeBucket().part, "starts").catch(fail); handoff = null; reset(); run = { taskId: task.id, startedAt: Date.now(), extra: 0 }; render(); startRun(uid, task).catch(fail); };

  const beginBatch = (list) => {
    bumpLearn(uid, list[0].type, timeBucket().part, "starts").catch(fail);
    handoff = null; reset();
    const now = Date.now();
    run = { taskId: list[0].id, batch: list.map((t) => t.id), done: [], mark: now, startedAt: now, extra: 0 };
    render();
    startBatch(uid, list).catch(fail);
  };

  // The batch offer (DAISEY_SPEC "Batches"): when the pick earned the batch
  // bonus, the card offers the whole batch — "Offices are open: 3 calls,
  // ~20 min. Together?" — with the list. Start all runs it as a checklist;
  // Just one falls back to the single task, with its usual actions.
  function batchCard(r, b){
    const list = r.ranked.filter((s) => b.ids.includes(s.task.id)).map((s) => s.task);
    const name = batchName(b.type, list.length);
    const office = r.moment.officeOpen && list.some((t) => t.openHours === "office");
    return h("div", { className: "now-card main batch" },
      contextLine(),
      h("div", { className: "now-meta", textContent: `Batch · ~${dur(b.minutes)}` }),
      h("div", { className: "now-title", textContent: name }),
      h("p", { className: "now-why", textContent: `${office ? "Offices are open: " : ""}${name}, ~${dur(b.minutes)}. Together?` }),
      h("ul", { className: "batch-preview" }, ...list.map((t) => h("li", {}, bdi(t.title), h("span", { className: "muted", textContent: ` · ${dur(t.size)}` })))),
      h("button", { className: "btn primary start", type: "button", textContent: "Start all",
        ariaLabel: `Start all ${list.length} as one checklist`, onclick: () => beginBatch(list) }),
      h("div", { className: "now-actions" },
        h("button", { className: "btn quiet", type: "button", textContent: "Just one",
          ariaLabel: `Just one: show only ${list[0].title}`, onclick: () => { state.single = true; render(); } })));
  }

  // Later and Pending both move the card on: it slides out, the next slides
  // in, and for 5 seconds a toast offers Undo. Nothing waits on the write.
  function stepAside(task, { label, write }){
    const before = skipSnapshot(task);
    const go = () => {
      skips.add(task.id);
      reset();
      slideIn = true;
      setToast({ task, before, label });
      write().catch(fail);
      render();
    };
    const el = root.querySelector(".now-card.main");
    if (el && motionOK()) { el.classList.add("out"); setTimeout(go, SLIDE_MS); } else go();
  }

  // Later asks when (Mor, 2026-10-04). Every answer is a "not now" to
  // learn from; only "later today" counts toward the stale rule, since the
  // other two are a plan, not a refusal.
  //   today    off the card for LATER_MINUTES, back the same day
  //   week     not before the roomiest day this week (triage.pickWeekDay)
  //   someday  parked until moved back
  const declined = (task) => bumpLearn(uid, task.type, timeBucket().part, "skips");
  function later(task, when){
    if (when === "today") {
      stepAside(task, { label: `Later (${dur(LATER_MINUTES)}): `, write: () => Promise.all([skipNow(uid, task), declined(task)]) });
    } else if (when === "week") {
      let day = pickWeekDay(task, { events: cal.status === "ok" ? cal.events : [], tasks: tasks || [] });
      if (task.dateKind === "deadline" && task.due && task.due < day) day = task.due; // never hide it past its deadline
      const label = new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      stepAside(task, { label: `This week (${label}): `, write: () => Promise.all([restoreTask(uid, task.id, { notBefore: day, touchedAt: Date.now() }), declined(task)]) });
    } else if (when === "someday") {
      stepAside(task, { label: "Someday: ", write: () => Promise.all([restoreTask(uid, task.id, { status: "someday", touchedAt: Date.now() }), declined(task)]) });
    }
  }
  // Pending asks what it's waiting on (Mor, 2026-10-04); the reason is
  // optional and lands in the task's "Waiting on".
  const pending = (task, why = "") => stepAside(task, { label: "Pending: ", write: () => blockTask(uid, task, why) });

  function pendingAsk(task){
    // The card redraws on every snapshot and each minute; what's typed lives
    // in state so a redraw doesn't wipe it.
    const input = h("input", { id: "pendWhy", dir: "auto", autocomplete: "off", value: state.pendText || "",
      oninput: (e) => { state.pendText = e.target.value; } });
    const go = () => { const why = input.value; state.pendText = ""; pending(task, why); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    const box = h("div", { className: "pend-ask" },
      h("label", { htmlFor: "pendWhy", textContent: "Waiting on what? (optional)" }),
      h("div", { className: "pend-row" }, input,
        h("button", { className: "btn primary small", type: "button", textContent: "Set pending", onclick: go })));
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
    return box;
  }

  function setToast(t){
    clearTimeout(toastTimer);
    toast = t;
    if (t) toastTimer = setTimeout(() => { toast = null; render(); }, UNDO_MS);
  }

  function undo(){
    const { task, before } = toast;
    skips.delete(task.id);
    state.chosen = task.id;
    setToast(null);
    restoreTask(uid, task.id, before).catch(fail);
    render();
  }

  function toastView(){
    const { task } = toast;
    return h("div", { className: "toast", role: "status" },
      h("span", { className: "toast-text" }, toast.label, bdi(task.title)),
      h("button", { className: "toast-undo", type: "button", textContent: "Undo",
        ariaLabel: `Undo: put ${task.title} back on the card`, onclick: undo }));
  }

  // The three quiet actions under Start. Icon plus a small word, with the
  // whole phrase as the tooltip and the screen-reader name.
  const action = (name, label, hint, props) => h("button", {
    className: "iconbtn", type: "button", title: `${label} — ${hint}`, ariaLabel: `${label}: ${hint}`, ...props,
  }, icon(name), h("span", { className: "iconbtn-text", textContent: label }));

  // What the engine knows about this moment: the calendar's window if it
  // answered, today's Laters, and which projects are already warm — momentum
  // and the skip penalty were both scoring zero until this was passed in.
  // The calendar as Daisey should read it now: an event you've overridden
  // doesn't count as busy.
  function calendarNow(){
    if (cal.status !== "ok") return null;
    const busy = cal.events.filter((e) => e.busy !== false && !e.allDay);
    const events = freeFrom ? busy.filter((e) => Date.parse(e.start) !== freeFrom) : busy;
    const fw = freeWindow(events);
    // The override only ever applies to the event that was running; once it
    // ends, or another starts, the calendar speaks for itself again.
    if (freeFrom && !cal.events.some((e) => Date.parse(e.start) === freeFrom && Date.parse(e.end) > Date.now())) freeFrom = null;
    return fw;
  }

  // A project block: the event running now is titled after a project
  // ("daisey", "Monster Punk audio"). Then the card isn't hidden behind the
  // event — it shows that project's best task, with the time until the
  // block ends as the window (DAISEY_SPEC "Current block"). Any other event
  // keeps the meeting card.
  function blockOf(fw){
    if (!fw?.current) return null;
    // A block accepted from the pencil schedule names its task: that task is
    // the card while it runs (DAISEY_SPEC "Pencil schedule").
    const planned = fw.current.taskId && (tasks || []).find((t) => t.id === fw.current.taskId && t.status !== "done" && t.status !== "dropped");
    if (planned) return { project: planned.project, taskId: planned.id, title: planned.title, start: fw.current.start, end: fw.current.end };
    // A lesson or rehearsal is the thing itself, not time set aside for a
    // project — even when a project shares its name ("Teaching").
    const title = String(fw.current.title || "").toLowerCase();
    if (DRAIN.words.some((w) => title.includes(w))) return null;
    const open = (tasks || []).filter((t) => t.status !== "done" && t.status !== "dropped").map((t) => t.project);
    const project = matchProject(fw.current.title, open);
    return project ? { project, start: fw.current.start, end: fw.current.end } : null;
  }

  // What a re-render is worth watching for: normally the free window, but
  // inside a meeting the window stays 0 while the minutes left tick down, and
  // the card now states those minutes.
  const windowMark = (fw) => (fw?.current
    ? `m${Math.ceil((fw.current.end - Date.now()) / 60000)}`
    : fw?.window);

  function momentInput(fw = calendarNow()){
    const now = Date.now();
    const f = feel();
    const block = blockOf(fw);
    return {
      ...(!fw ? { realWindow: false }
        : block ? { window: Math.floor((block.end - now) / 60000), blockProject: block.project }
        : { window: fw.window, nextEvent: fw.next?.title ?? null }),
      ...workBase(tasks || [], now),
      sessionSkips: hidden(now),
      skipsToday: skipCounts(),
      energy: f.energy.value,
      place: f.place.value,
      learnStats,
      intents: settings.intents || {},
    };
  }

  function render(){
    document.body.classList.toggle("focus", !!run || !!handoff);
    if (run) { fill(renderFocus()); return; }
    if (handoff) {
      // The task just worked on isn't offered straight back.
      const m = momentInput();
      const r = rank(tasks || [], { ...m, sessionSkips: [...m.sessionSkips, handoff.skip] });
      fill(handoffView(handoff.title, r.pick, {
        onStart: begin,
        onSkip: (task) => { if (task) skips.add(task.id); handoff = null; showing(null); render(); },
      }));
      return;
    }
    const busy = cal.status === "ok" // the event being ignored, before any override
      ? freeWindow(cal.events.filter((e) => e.busy !== false && !e.allDay)).current : null;
    const fw = calendarNow();
    lastWindow = windowMark(fw);
    const greet = h("div", { className: "now-greet" },
      // Said you're free during an event that is still on the calendar.
      freeFrom && busy && h("p", { className: "muted" }, "Ignoring ", bdi(busy.title), " ",
        h("button", { className: "linkish", type: "button", textContent: "put it back",
          ariaLabel: `Stop ignoring ${busy.title}`, onclick: () => { freeFrom = null; render(); } })),
      CAL_NOTE[cal.status] && h("p", { className: "muted" }, CAL_NOTE[cal.status] + " ", h("a", { href: "/daisey/", textContent: "Open old Daisey" })),
      // Too many passed dates: one quiet line, at most once a day.
      tasks && shouldOffer(tasks, Date.now(), settings) && h("p", { className: "muted offer" },
        `${sweepList(tasks).length} old dates are piling up.`,
        h("button", { className: "linkish", type: "button", textContent: "Sort them (2 min)", onclick: () => onSweep?.() }),
        h("button", { className: "linkish", type: "button", textContent: "Not today",
          onclick: () => { settings = { ...settings, sweepAnswered: localDate() }; render(); saveSettings(uid, { sweepAnswered: localDate() }).catch(fail); } })));

    if (tasks == null) { fill(greet, h("p", { className: "muted", textContent: "Loading tasks…" })); return; }

    const r = rank(tasks, momentInput(fw));
    const planned = blockOf(fw)?.taskId;
    const card = (state.chosen && r.ranked.find((s) => s.task.id === state.chosen))
      || (planned && r.ranked.find((s) => s.task.id === planned)) || r.pick;
    showing(card?.task.id ?? null);
    const tip = toast && toastView();
    // In a meeting, the meeting IS what's happening now, so the card says
    // which one and how much of it is left (Mor, 2026-10-04) instead of
    // "nothing to pick until it ends", which named nothing and read as if
    // Daisey had simply given up. "I'm free now" still overrides it.
    const block = blockOf(fw);
    if (!card && block) {
      fill(greet, h("div", { className: "now-card main empty" }, contextLine(),
        h("p", { className: "now-empty" }, "Nothing in ", bdi(block.project), " fits right now."),
        h("button", { className: "btn quiet", type: "button", textContent: "I'm free now",
          ariaLabel: `I'm free now: ignore the ${block.project} block and pick any task`,
          onclick: () => { freeFrom = block.start; render(); } })), tip);
      return;
    }
    if (!card && fw?.current) { fill(greet, meetingCard(fw.current), tip); return; }
    if (!card) {
      fill(greet, h("div", { className: "now-card main empty" },
        r.empty === "nofit" && contextLine(), // nothing fits: maybe you're not where Daisey thinks
        h("p", { className: "now-empty", textContent: r.empty === "none"
          ? "No tasks yet. Add a few and Daisey will pick."
          : `Nothing fits the next ${dur(r.moment.window)}. Take the break.` }),
        skips.size > 0 && h("button", { className: "btn quiet", type: "button", textContent: `Show the ${skips.size} you put off`, ariaLabel: `Show the ${skips.size} tasks you put off today`, onclick: () => { skips.clear(); setToast(null); render(); } })), tip);
      return;
    }

    if (card === r.pick && r.pick.batch && !state.chosen && !state.single) { fill(greet, batchCard(r, r.pick.batch), tip); return; }
    const alts = r.ranked.length > 1 ? [r.pick, ...r.alternatives].filter((s) => s !== card).slice(0, 3) : [];
    // Start is the one loud thing on the tab; the other two stay quiet under it.
    fill(greet, taskCard(card, true,
      h("button", { className: "btn primary start", type: "button", textContent: "Start",
        ariaLabel: `Start: ${card.task.title}`, onclick: () => begin(card.task) }),
      h("div", { className: "now-actions" },
        action("later", "Later", `not now — choose when to see ${card.task.title} again`,
          { ariaExpanded: String(state.laterAsk), onclick: () => { state.laterAsk = !state.laterAsk; state.pendAsk = false; state.showAlts = false; render(); } }),
        action("switch", "Switch", state.showAlts ? "hide the other tasks" : `something else — ${alts.length} other tasks`,
          { disabled: !alts.length, ariaExpanded: String(state.showAlts),
            onclick: () => { state.showAlts = !state.showAlts; state.laterAsk = false; state.pendAsk = false; render(); } }),
        action("pending", "Pending", `${card.task.title} is blocked — set it to Waiting`,
          { ariaExpanded: String(state.pendAsk), onclick: () => { state.pendAsk = !state.pendAsk; state.laterAsk = false; state.showAlts = false; render(); } })),
      state.pendAsk && pendingAsk(card.task),
      state.laterAsk && h("div", { className: "later-ask", role: "group", ariaLabel: "When instead?" },
        h("span", { className: "muted", textContent: "When?" }),
        ...[["today", "Later today"], ["week", "This week"], ["someday", "Someday"]].map(([w, text]) =>
          h("button", { className: "chip", type: "button", textContent: text, onclick: () => later(card.task, w) })))),
      state.showAlts && h("div", { className: "now-alts", role: "group", ariaLabel: "Other tasks" }, ...alts.map((s) => h("button", {
        type: "button", className: "now-alt", ariaLabel: `Put ${s.task.title} on the card instead${s.why ? ". " + s.why : ""}`,
        onclick: () => { state.chosen = s.task.id; state.showAlts = false; render(); },
      }, taskCard(s, false)))), tip);
    // One slide-in per step-aside: later snapshots must not replay it.
    if (slideIn) { slideIn = false; if (motionOK()) root.querySelector(".now-card.main")?.classList.add("in"); }
  }

  const fill = (...kids) => root.replaceChildren(...kids.filter(Boolean));
  const fail = (e) => console.error("[daisey] now", e);
  const unsubs = [
    watchTasks(uid, (ts) => { tasks = ts; render(); }, fail),
    watchCalendar((c) => { cal = c; render(); }),
    watchRun(uid, (r) => { run = r; if (r) handoff = null; render(); }, fail),
    watchSkips(uid, (s) => { skipDoc = s; render(); }, fail),
    watchSettings(uid, (s) => { settings = s || {}; render(); }, fail),
    watchMoment(uid, (d) => { momentDoc = d || {}; render(); }, fail),
    watchLearn(uid, (d) => { learnStats = d || {}; render(); }, fail),
  ];
  // The timer ticks every second while running; otherwise this only
  // re-renders when the free window's minute changes.
  const tick = setInterval(() => {
    if (document.hidden) return;
    if (run) { const c = Math.floor(elapsedMinutes(run) * 60); if (c !== lastClock) { lastClock = c; render(); } return; }
    if (cal.status === "ok" && windowMark(calendarNow()) !== lastWindow) render();
  }, 1000);
  const onVisible = () => { if (!document.hidden) render(); };
  document.addEventListener("visibilitychange", onVisible);
  root.hidden = false;
  render();

  return {
    refresh: render,
    // "Do this now" from the task sheet: the same thing Switch does, driven
    // from the list. A task put off today is un-put-off, or the card would
    // ignore the choice.
    put(id){
      handoff = null;
      skips.delete(id);
      state.chosen = id;
      state.showAlts = false;
      render();
    },
    unmount(){ showing(null); clearTimeout(toastTimer); document.body.classList.remove("focus"); unsubs.forEach((u) => u()); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); root.replaceChildren(); root.hidden = true; },
  };
}
