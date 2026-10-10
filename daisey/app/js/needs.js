// Needs you (Mor, 2026-10-05; daisey/New Design/10-needs-you): the small
// decisions Daisey can't make alone, one at a time on a screen of their own,
// instead of asks stacked under the Now card. The home screen only says how
// many there are ("Needs you: 3 quick decisions").
//
// Sources, in this order:
//   parked   a task in Not now (someday) whose real deadline is close or
//            passed (2026-10-06: Someday hid deadlines for good — the sweep
//            only reads open tasks and the weekly pick shows one)
//   cal      a calendar event that reads like a task (caltask.js) — it was
//            the "Make this a task?" ask under the card
//   slot     a routine's set-days slot that's over: "Did it?" (routine.js)
//   pending  a Pending task past its check date (model checkOn): "Still
//            pending?"
//   stale    a task put off STALE_SKIPS times without a start: keep, shrink
//            or let go (2026-10-06: was a line under the card that a toast
//            could crowd out and a reload forgot)
//   someday  the weekly Someday pick (Sunday morning, or fewer than 3
//            active) — it was the pick under the card
//   sweep    an old date (triage.js) — it was the "Old dates" sheet
//            (Mor, 2026-10-05: folded in here)
//
// "Ask me later" hides one for the rest of the day (settings.needsLater).
// The list is fixed when the screen opens, so answering one never reshuffles
// the dots.
import { watchTasks, watchSettings, saveSettings, restoreTask, addTask, removeTask } from "./store.js";
import { dropSeries } from "./slots.js";
import { watchCalendar, deleteEvent, retime } from "./calendar.js";
import { draftFrom } from "./caltask.js";
import { pickWeekDay, answer, answerSnapshot, effectiveDue } from "./triage.js";
import { localDate, pendingCheck, shrunk, shrinkPatch, dayAfter, notYet, pushedTo, bringBack } from "./model.js";
import { sessionPatch, skipSlotPatch, weekState } from "./routine.js";
import { dayHours, minText } from "./day.js";
import { nudgeText, waLink } from "./nudge.js";
import { daysUntil } from "./engine.js";
import { collectNeeds, somedayDue } from "./needs-list.js";
export { collectNeeds, somedayDue }; // now.js counts them for the header chip
import { h, icon, dur, flash } from "./ui.js";
import { whereAsk, setRide, setStill, saveSpot, notHomeHere, quietHere, reservedName, homeAt } from "./where.js";
import { estimate, answer as tripAnswer, noTrip } from "./trips.js";
import { areaClass } from "./look.js";

const MARK = { penalty: "There's a penalty if it's late.", money: "It costs money to leave it.", someone: "Someone's waiting on it." };
const shortDay = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const weekday = (s) => new Date(`${s}T12:00`).toLocaleDateString(undefined, { weekday: "short" });
// "10-minute", "2-hour", "1 h 30 min" — for "I'd make it a 10-minute task".
const sizeWords = (m) => (m < 60 ? `${m}-minute` : m % 60 ? dur(m) : `${m / 60}-hour`);
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// The evening wrap (2026-10-06): opened from the end-of-day notification
// (?open=wrap). Each ready task still dated today or earlier, deadlines
// first: a deadline asks "tonight, or move it?", a target "tomorrow, or not
// now?". Both can be deleted.
export function wrapList(tasks = [], now = Date.now()){
  const today = localDate(now);
  return tasks.filter((t) => t.status === "ready" && t.due && !notYet(t, now) && effectiveDue(t, now) <= today)
    .sort((a, b) => (b.dateKind === "deadline") - (a.dateKind === "deadline") || a.due.localeCompare(b.due))
    .map((t) => ({ key: `wrap:${t.id}`, kind: "wrap", id: t.id }));
}

// onClose(): back to home.
// extra(): questions only another screen can work out (now.js needsAsks:
// the plan slipped), asked first. Each is { key, kind: "ext", ask({ next,
// close }) } and ask returns a question, or null once it no longer applies.
export function mountNeeds(root, uid, { onClose, extra } = {}){
  let tasks = [], settings = {}, cal = { status: "loading", events: [] };
  let list = [], i = 0, follow = null, mode = "needs", loaded = false, waiting = null; // follow: the "keep the event?" step after making one a task
  const fail = (e) => console.error("[daisey] needs", e);
  const find = (id) => tasks.find((t) => t.id === id);

  const next = () => { follow = null; i++; paint(); };
  const later = (key) => {
    const today = localDate();
    const keys = settings.needsLater?.date === today ? [...(settings.needsLater.keys || [])] : [];
    const needsLater = { date: today, keys: [...new Set([...keys, key])] };
    settings = { ...settings, needsLater };
    saveSettings(uid, { needsLater }).catch(fail);
    next();
  };
  const markOffered = (ev) => {
    const calOffered = [...(settings.calOffered || []), ev.id].slice(-200);
    settings = { ...settings, calOffered };
    saveSettings(uid, { calOffered }).catch(fail);
  };
  const somedayDone = () => {
    settings = { ...settings, somedayAsked: localDate() };
    saveSettings(uid, { somedayAsked: localDate() }).catch(fail);
  };
  // Delete (Mor, 2026-10-10): "Let it go" read as unclear, so it says what it
  // does and does what the task sheet's Delete does — the task is gone, its
  // weekly event in the Daisey calendar with it.
  // Asks twice (Mor, 2026-10-10), as the sheet does: the third entry is
  // what the button says once armed (answer() below).
  const del = (t) => ["Delete task", () => { dropSeries(t); removeTask(uid, t.id).catch(fail); flash("Deleted ", t.title); next(); }, "Really delete?"];
  const sweep = (t, kind) => {
    const now = Date.now();
    const week = kind === "week" ? pickWeekDay(t, { events: cal.events || [], tasks, now, hours: dayHours({ ...settings, dayEndToday: null }) }) : null;
    restoreTask(uid, t.id, { ...answerSnapshot(t), ...answer(kind, t, { now, week }) }).catch(fail);
    next();
  };

  // One question: what each source asks and what each answer does.
  // tone: the card's tint (an area class), ico: its icon.
  function question(item){
    if (item.kind === "ext") return item.ask({ next, close: (then) => onClose?.(then) });
    if (item.kind === "cal") {
      const ev = item.ev, d = draftFrom(ev, tasks);
      const start = Date.parse(ev.start), end = Date.parse(ev.end);
      const when = ev.allDay ? shortDay(String(ev.start).slice(0, 10))
        : `${new Date(start).toLocaleDateString(undefined, { weekday: "long" })}, ${clock(start)}–${clock(end)}`;
      const due = d.input.due ? `, due ${new Date(`${d.input.due}T12:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "";
      return { tone: "area-admin", ico: "calendar", q: "Is this a task?", sub: `It's in your calendar on ${when}.`,
        item: ev.title, say: `I'd make it a ${sizeWords(d.guess.size)} task${due}.`,
        yes: ["Yes, make it a task", () => { markOffered(ev); addTask(uid, d.input, tasks).catch(fail); follow = ev; paint(); }],
        no: ["No, it's an event", () => { markOffered(ev); next(); }] };
    }
    // Device questions (where.js): about where you are, not about a task.
    if (item.kind === "ride") return { tone: "area-home", ico: "later", q: "How are you travelling?", sub: "You're moving fast.",
      item: "", say: "I can't tell a train from a bus or a car.", noLater: true,
      yes: ["Train", () => { setRide("train"); next(); }], no: ["Bus", () => { setRide("bus"); next(); }],
      more: [["Driving", () => { setRide("car"); next(); }], ["Not moving", () => { setStill(); next(); }]] };
    if (item.kind === "home") {
      const failed = () => flash("Couldn't get your location. Allow it for this site and try again.");
      return { tone: "area-home", ico: "someday", q: "Are you home right now?", sub: "I don't have a Home saved yet.",
        item: "", say: "Then I'll know when tasks that need home fit.", noLater: true,
        yes: ["Yes, I'm home", async () => { if (await saveSpot("Home")) next(); else failed(); }],
        no: ["No", () => { notHomeHere(); next(); }] };
    }
    if (item.kind === "place") return { tone: "area-home", ico: "someday", q: "You're here a lot", sub: "Name this place?",
      item: "", say: "Tasks that mention it come first here.", noLater: true,
      field: { id: "placeHere", placeholder: "Work, Studio, Gym…" },
      yes: ["Save", async (name) => {
        const n = String(name || "").trim();
        if (!n) return;
        if (reservedName(n)) { flash(`"${n}" is taken. Pick another name.`); return; }
        if (await saveSpot(n)) { flash(`Saved. I'll know when you're at ${n}.`); next(); } else flash("Couldn't get your location. Allow it for this site and try again.");
      }],
      no: ["Not now", () => { quietHere(); next(); }] };
    // An event in another city (trips.js): how you get there, once per series.
    // The field takes minutes each way; empty = the estimate from Home.
    if (item.kind === "trip") {
      const home = homeAt(), est = estimate(item.city, home), ev = item.ev;
      const save = (a) => {
        const trips = { ...(settings.trips || {}), [item.key]: a };
        settings = { ...settings, trips };
        saveSettings(uid, { trips }).catch(fail);
        next();
      };
      const go = (mode) => (typed) => {
        const a = tripAnswer(item.city, mode, { home, minutes: typed });
        if (!a) { flash("How many minutes each way?"); return; }
        save(a);
      };
      const start = Date.parse(ev.start);
      return { tone: "area-home", ico: "later", q: `Do you travel to ${item.city.name}?`,
        sub: `${new Date(start).toLocaleDateString(undefined, { weekday: "long" })}, ${clock(start)}–${clock(Date.parse(ev.end))}${ev.recurring ? ", every week" : ""}.`,
        item: ev.title,
        say: est ? `From Home: about ${dur(est.car)} driving, ${dur(est.train)} by train. I'll keep the way there and back free.`
          : "I'll keep the way there and back free. How long is it each way?",
        field: { id: "tripMin", placeholder: est ? "Minutes each way (optional)" : "Minutes each way", inputmode: "numeric" },
        yes: ["Train", go("train")], no: ["Driving", go("car")],
        more: [["Bus", go("bus")], ["It's not a trip", () => save(noTrip(item.city))]] };
    }
    // A meal the calendar leaves no room for (meals.js): today only.
    if (item.kind === "meal") {
      const m = item.meal, low = m.name.toLowerCase();
      const setMeal = (v) => {
        const today = localDate();
        const mealToday = { ...(settings.mealToday?.date === today ? settings.mealToday : {}), date: today, [m.name]: v };
        settings = { ...settings, mealToday };
        saveSettings(uid, { mealToday }).catch(fail);
        next();
      };
      const there = ["I'll eat there", () => setMeal("there")];
      return { tone: "area-home", ico: "calendar", q: `${m.name} at ${m.at}?`,
        sub: m.by.slice(0, 2).map((e) => `${e.title} ${clock(Date.parse(e.start))}–${clock(Date.parse(e.end))}`).join(", ") + ".",
        item: "", say: m.move != null ? `No free time to eat then. Eating there, or ${low} at ${minText(m.move)}?` : "No free time to eat then, or near it.",
        ...(m.move != null ? { yes: [`Move ${low} to ${minText(m.move)}`, () => setMeal(minText(m.move))], no: there }
          : { yes: there, no: [`Skip ${low} today`, () => setMeal("there")] }) };
    }
    const t = find(item.id);
    if (!t) return null; // deleted since: skip it
    if (item.kind === "clash") {
      const c = item.clash, mv = c.move;
      return { tone: "area-job", ico: "calendar", q: `${c.over.title} is running into this`,
        sub: `It's booked ${clock(Date.parse(c.slot.start))}–${clock(Date.parse(c.slot.end))}. Deadline ${shortDay(t.due)}.`, item: t.title,
        say: `I can move it to ${clock(mv.start)}.`,
        yes: [`Move it to ${clock(mv.start)}`, () => { retime(c.slot, mv.start, mv.end).catch(fail); next(); }],
        no: ["Keep current plan", () => later(item.key)], noLater: true };
    }
    if (item.kind === "slot") {
      // Did it → one session (with the slot's time). Skipped → the week is
      // one short again, and Daisey offers it in the next free time.
      const e = item.slot, s = weekState(t);
      return { tone: areaClass(t).trim() || "area-personal", ico: "check", q: "Did it?",
        sub: `${clock(e.start)}–${clock(e.end)}${e.day === localDate() ? " today" : `, ${weekday(e.day)}`}.`, item: t.title,
        say: s.done ? `${s.done} of ${s.per} this week so far.` : `Your ${s.per}× a week.`,
        yes: ["Did it", () => { restoreTask(uid, t.id, sessionPatch(t, { ev: e })).catch(fail); next(); }],
        no: ["Skipped it", () => { restoreTask(uid, t.id, skipSlotPatch(t, e.id)).catch(fail); next(); }] };
    }
    if (item.kind === "wrap") {
      const tomorrow = () => { restoreTask(uid, t.id, pushedTo(t, { due: dayAfter(1) })).catch(fail); next(); };
      const drop = del(t);
      if (t.dateKind === "deadline") {
        const past = t.due < localDate();
        return { tone: "area-job", ico: "later", q: past ? "Deadline passed" : "Deadline today",
          sub: past ? `It was ${shortDay(t.due)}.` : "It's still open.", item: t.title, say: "Tonight, or does the date move?",
          yes: ["I'll do it tonight", () => next()], no: ["Move it to tomorrow", tomorrow], more: [drop], noLater: true };
      }
      return { tone: areaClass(t).trim() || "area-home", ico: "later", q: "Still for today?",
        sub: t.due < localDate() ? `It was planned for ${shortDay(t.due)}.` : "It was planned for today.", item: t.title,
        say: "I'd move it to tomorrow.", yes: ["Move to tomorrow", tomorrow],
        no: ["On hold", () => { restoreTask(uid, t.id, { status: "someday", touchedAt: Date.now() }).catch(fail); next(); }], more: [drop], noLater: true };
    }
    if (item.kind === "parked") {
      const days = daysUntil(t.due, Date.now());
      return { tone: "area-job", ico: "someday", q: "Deadline coming up",
        sub: `It's on hold. ${days < 0 ? "The deadline was" : "The deadline is"} ${days === 0 ? "today" : days === 1 ? "tomorrow" : shortDay(t.due)}.`,
        item: t.title, say: days < 0 ? "Bring it back, or delete it?" : "I'd bring it back before it's too late.",
        yes: ["Bring it back", () => { restoreTask(uid, t.id, { status: "ready", notBefore: null, touchedAt: Date.now() }).catch(fail); next(); }],
        no: del(t) };
    }
    if (item.kind === "stale") {
      const small = shrunk(t.size);
      const keep = ["Keep it", () => { restoreTask(uid, t.id, { skipsSinceStart: 0, touchedAt: Date.now() }).catch(fail); next(); }];
      const drop = del(t);
      const canShrink = small < (t.size || 0);
      return { tone: areaClass(t).trim() || "area-work", ico: "later", q: "Still want this?",
        sub: `Put off ${t.skipsSinceStart} times without starting.`,
        item: t.title, say: canShrink ? `I'd make it a ${sizeWords(small)} task: a first piece is easier to start.` : "Keep it, or delete it?",
        ...(canShrink
          ? { yes: [`Shrink to ${dur(small)}`, () => { restoreTask(uid, t.id, shrinkPatch(t)).catch(fail); next(); }], no: keep, more: [drop] }
          : { yes: keep, no: drop }) };
    }
    if (item.kind === "pushed") {
      const small = shrunk(t.size);
      const canShrink = small < (t.size || 0);
      const keep = ["Keep it", () => { restoreTask(uid, t.id, { pushes: 0, touchedAt: Date.now() }).catch(fail); next(); }];
      const drop = del(t);
      const park = ["On hold", () => { restoreTask(uid, t.id, { status: "someday", pushes: 0, touchedAt: Date.now() }).catch(fail); next(); }];
      return { tone: areaClass(t).trim() || "area-work", ico: "later", q: "Keeps sliding",
        sub: `Pushed to a later day ${t.pushes} times.`, item: t.title,
        say: canShrink ? `I'd make it a ${sizeWords(small)} first piece, so it's easy to start.` : "Keep it, park it, or delete it?",
        ...(canShrink
          ? { yes: [`Shrink to ${dur(small)}`, () => { restoreTask(uid, t.id, { ...shrinkPatch(t), pushes: 0 }).catch(fail); next(); }], no: keep, more: [park, drop] }
          : { yes: keep, no: park, more: [drop] }) };
    }
    if (item.kind === "pending") {
      const since = t.touchedAt ? ` since ${new Date(t.touchedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "";
      return { tone: areaClass(t).trim() || "area-social", ico: "pending", q: "Still pending?",
        sub: t.waitingOn ? `Waiting on ${t.waitingOn}${since}.` : `Pending${since}.`,
        item: t.title, say: `If it's still stuck, I'll ask again ${weekday(pendingCheck(t))}.`,
        yes: ["Yes, still pending", () => { restoreTask(uid, t.id, { checkOn: pendingCheck(t), touchedAt: Date.now() }).catch(fail); next(); }],
        no: ["No, it's ready", () => { restoreTask(uid, t.id, { status: "ready", waitingOn: null, checkOn: null, touchedAt: Date.now() }).catch(fail); next(); }],
        // Nudge: WhatsApp with a short check-in typed in; asked again later, as for "still pending".
        more: [["Nudge on WhatsApp", () => { window.open(waLink(nudgeText(t)), "_blank", "noopener");
          restoreTask(uid, t.id, { checkOn: pendingCheck(t), touchedAt: Date.now() }).catch(fail); next(); }]] };
    }
    if (item.kind === "someday") {
      return { tone: "area-home", ico: "someday", q: "Bring one back?", sub: "From On hold, for this week.",
        item: t.title, say: MARK[t.stakes] || `It's ${dur(t.size)}, and the week has room.`,
        yes: ["Bring it back", () => { somedayDone(); restoreTask(uid, t.id, bringBack(t)).catch(fail); next(); }],
        no: ["Leave it there", () => { somedayDone(); next(); }] };
    }
    // sweep
    const week = pickWeekDay(t, { events: cal.events || [], tasks, hours: dayHours({ ...settings, dayEndToday: null }) });
    return { tone: "area-job", ico: "later", q: "Still doing this?",
      sub: `${t.dateKind === "deadline" ? "The deadline was" : "It was planned for"} ${shortDay(t.due)}.`,
      item: t.title, say: `I'd move it to ${weekday(week)}, the roomiest day this week.`,
      yes: ["Do it today", () => sweep(t, "today")],
      no: [`Move to ${weekday(week)}`, () => sweep(t, "week")],
      more: [["On hold", () => sweep(t, "someday")], del(t)] };
  }

  const big = (text, cls, onclick) => h("button", { className: `btn ${cls}`, type: "button", textContent: text, onclick });

  function paint(){
    // Skip anything that went away while the screen was open.
    while (i < list.length && !follow && !question(list[i])) i++;
    const top = h("div", { className: "ny-top" },
      h("button", { className: "ny-x", type: "button", ariaLabel: "Close", onclick: () => onClose?.() }, icon("close")),
      list.length > 1 && i < list.length && h("div", { className: "ny-dots", role: "img", ariaLabel: `Question ${i + 1} of ${list.length}` },
        ...list.map((_, k) => h("span", { className: k === i ? "on" : k < i ? "past" : "" }))),
      h("span", { className: "ny-pad", ariaHidden: "true" }));
    if (i >= list.length) {
      root.replaceChildren(top, h("div", { className: "ny-end" },
        h("h2", { textContent: mode === "wrap" ? "That's the day." : "That's everything." }),
        h("p", { textContent: mode === "wrap" ? "Tomorrow's sorted. Sleep well." : "Nothing else needs you." }),
        big("Back to now", "line big", () => onClose?.())));
      return;
    }
    let q, field = null;
    if (follow) {
      const ev = follow;
      q = { tone: "area-admin", ico: "calendar", q: "Keep the event?", sub: "Added as a task.", item: ev.title,
        say: "The task is in your list either way.",
        yes: ["Keep it in the calendar", () => next()],
        no: ev.editable !== false && ["Delete the event", () => { deleteEvent(ev).catch(fail); next(); }], noLater: true };
    } else q = question(list[i]);
    const left = list.length - i - 1;
    const card = h("section", { className: `ny-card ${q.tone}`, ariaLabel: "Question" },
      h("span", { className: "ny-ico" }, icon(q.ico)),
      h("h2", { className: "ny-q", textContent: q.q }),
      h("p", { className: "ny-sub", textContent: q.sub }),
      q.item && h("div", { className: "ny-item", dir: "auto", textContent: q.item }),
      h("p", { className: "ny-say", textContent: q.say }),
      q.field && (field = h("input", { id: q.field.id, className: "ny-field", dir: "auto", autocomplete: "off", enterkeyhint: "done", placeholder: q.field.placeholder, ariaLabel: q.field.placeholder || q.sub,
        ...(q.field.inputmode ? { inputMode: q.field.inputmode } : {}) })));
    if (field) field.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); q.yes[1](field.value); } });
    // [text, go, again]: with `again`, the first tap only arms the button
    // ("Really delete?") and the second one answers.
    const answer = ([text, go, again], cls) => {
      let armed = false;
      const b = big(text, cls, () => {
        if (again && !armed) { armed = true; b.textContent = again; b.classList.add("arm"); return; }
        go(field?.value);
      });
      return b;
    };
    root.replaceChildren(top,
      h("div", { className: "ny-stack" + (left > 1 ? " two" : left ? " one" : "") }, card),
      h("div", { className: "ny-spacer" }),
      h("div", { className: "ny-btns" },
        big(q.yes[0], "primary big", () => q.yes[1](field?.value)),
        q.no && answer(q.no, "line big"),
        q.more && h("div", { className: "ny-more" }, ...q.more.map((a) => answer(a, "quiet"))),
        !q.noLater && big("Ask me later", "quiet", () => later(list[i].key))));
  }

  const unsubs = [
    // Opened from a notification before the tasks loaded: open once they do.
    watchTasks(uid, (ts) => { tasks = ts; loaded = true; if (waiting) { const w = waiting; waiting = null; api.open(w); } }, fail),
    watchSettings(uid, (s) => { settings = s || {}; }, fail),
    watchCalendar((c) => { cal = c; }),
  ];

  const api = {
    open(which = "needs"){
      if (!loaded) { waiting = which; return; }
      mode = which;
      const dev = which === "wrap" ? null : whereAsk();
      list = which === "wrap" ? wrapList(tasks) : [...(extra?.() || []), ...(dev ? [{ key: `where:${dev}`, kind: dev === "name" ? "place" : dev }] : []), ...collectNeeds({ tasks, events: cal.events || [], calOk: cal.status === "ok", settings, home: homeAt() })];
      i = 0; follow = null;
      paint();
      root.hidden = false;
      root.querySelector(".btn.primary, .btn")?.focus({ preventScroll: true });
    },
    close(){ root.hidden = true; root.replaceChildren(); },
    unmount(){ unsubs.forEach((u) => u()); root.replaceChildren(); root.hidden = true; },
  };
  return api;
}
