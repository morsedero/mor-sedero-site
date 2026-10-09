// The event sheet: adding a Google Calendar event without leaving Daisey
// (Mor, 2026-10-04: "so the user won't have to jump between the two"), and
// since 2026-10-05 opening and editing one too ("copy from google calendar
// everything about opening and editing events").
//
// It is Google's own two steps in one dialog, because that is the flow Mor
// asked to copy: tapping an event opens its DETAILS — name, day, time, and
// nothing to fill in — and Edit turns the same sheet into the form. Editing
// in a popup rather than on the row is what let the schedule go back to being
// a plain list: nothing is dragged, so nothing has to be grabbed.
//
// Five fields, because that is the whole of a meeting as Daisey needs it:
// what, which day, from, to, and where (Mor, 2026-10-09: the place is what
// lets Daisey plan the ride there and back — trips.js reads its city, and
// the line under the field says whether it found one). No guests, no description, no recurrence, no
// calendar picker — those are Google Calendar's job, and the event lands
// there to be opened if any of them are wanted. From–to rather than a length
// (Mor, 2026-10-05): To starts an hour after From, and moving From carries
// To along with it, as Google does, so a one-hour event is still one choice.
//
// Delete is one tap called Remove, undone from the toast (Mor, 2026-10-05:
// "a 1 click remove", instead of a delete and a check after).
//
// A repeating event asks Google's question before Save or Remove goes out
// (Mor, 2026-10-09): This event / This and following events / All events,
// "This event" picked. The answer is carried out in Google Calendar itself
// (functions/_daisey-lib/gcal-series.js). Only "This event" has an Undo: a
// series change can split or end the series, and writing it back is not
// one step.
//
// A new event opens on the day the Schedule panel is showing, with the time
// rounded up to the next quarter hour, so adding something to Thursday from
// Thursday's page needs the title and nothing else.
import { createEvent, deleteEvent, editEvent } from "./calendar.js";
import { localDate } from "./model.js";
import { cityIn, isLocal } from "./trips.js";
import { homeAt } from "./where.js";
import { h, bdi, flash, icon } from "./ui.js";

const DEFAULT_LENGTH = 60;
const MIN = 60000;
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (ms) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;
const longDay = (ms) => new Date(ms).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

// The next quarter hour, so a new event never starts in the past.
function nextQuarter(){
  const d = new Date();
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ERROR = {
  read_only: "That calendar is read-only.",
  needs_reauth: "Calendar sign-in expired. Sign in again to reconnect it.",
  no_session: "Signed out.",
  not_connected: "Calendar not connected. Sign in again to link it.",
  gone: "That event is already gone.",
  bad_request: "Something in that didn't make sense to Google.",
};

let n = 0;
const field = (label, input, wide) => {
  input.id = `ev-f${++n}`;
  return h("div", { className: "field" + (wide ? " wide" : "") }, h("label", { htmlFor: input.id, textContent: label }), input);
};

// A time as ONE picker, "09:00", "09:15" … "23:45" (Mor, 2026-10-06: an hour
// box and a minute box were fiddly to edit; before that, 2026-10-05, the
// phone's own time picker listed every minute and refused most of them).
// Quarter hours keep the list short enough to flick through. It reads and
// writes "HH:MM" like a time input. An event already at an odd minute keeps
// it: that one time is added to the list, so opening it moves nothing.
// relabel(from) is for To: each later time gets its length beside it,
// "11:15 · 1h 15m", the way Google lists end times.
const STEP = 15;
const hm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const lenText = (m) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);
function timePick(label){
  const opt = (m) => h("option", { value: hm(m), textContent: hm(m) });
  const sel = h("select", { className: "timepick", ariaLabel: label }, ...Array.from({ length: 24 * 60 / STEP }, (_, i) => opt(i * STEP)));
  const base = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  Object.defineProperty(sel, "value", {
    get: () => base.get.call(sel),
    set: (v) => {
      const [hh, mm] = String(v || "").split(":").map(Number);
      const t = hm((hh || 0) * 60 + (mm || 0));
      for (const o of [...sel.options]) if (o.dataset.odd && o.value !== t) o.remove();
      if (![...sel.options].some((o) => o.value === t)) {
        const o = opt((hh || 0) * 60 + (mm || 0)); o.dataset.odd = "1";
        sel.insertBefore(o, [...sel.options].find((x) => x.value > t) || null);
      }
      base.set.call(sel, t);
    },
  });
  sel.relabel = (from) => {
    const [a, b] = from.split(":").map(Number), f = a * 60 + b;
    for (const o of sel.options) {
      const [x, y] = o.value.split(":").map(Number), d = x * 60 + y - f;
      o.textContent = d > 0 ? `${o.value} · ${lenText(d)}` : o.value;
    }
  };
  return sel;
}

export function mountAddEvent(dialog, { localOnly = false } = {}){
  let busy = false;
  let editing = null; // the event being looked at or edited, or null when adding
  const f = {
    title: h("input", { dir: "auto", required: true, autocomplete: "off" }),
    date: h("input", { type: "date", required: true }),
    at: timePick("From"),
    to: timePick("To"),
    place: h("input", { dir: "auto", autocomplete: "off", placeholder: "City or address" }),
  };
  // What Daisey makes of the place, under the field, as it's typed.
  const placeHint = h("p", { className: "muted ev-hint" });
  const hintPlace = () => {
    const v = f.place.value.trim(), city = cityIn(v);
    placeHint.textContent = !v ? "A city lets Daisey plan the ride there and back."
      : !city ? "Add the city too, so Daisey can plan the ride."
      : isLocal(city, homeAt()) ? `${city.name}: close to home, no ride to plan.`
      : `${city.name}: Daisey plans the ride there and back.`;
  };
  f.place.addEventListener("input", hintPlace);
  const placeField = field("Place", f.place, true);
  placeField.append(placeHint);
  const msg = h("p", { className: "msg", role: "alert" });
  const submit = h("button", { className: "btn primary", type: "submit", textContent: localOnly ? "Add event" : "Add to calendar" });
  const form = h("form", { className: "form-grid ev-grid" },
    field("Event", f.title, true),
    field("Day", f.date, true),
    field("From", f.at),
    field("To", f.to),
    placeField,
    submit);
  const note = h("p", { className: "muted ev-note", textContent: localOnly
    ? "Saved on this device only."
    : "Goes in your main Google calendar. Guests, repeats and the rest are a tap away in Google Calendar." });
  const heading = h("h2", { id: "evTitle", textContent: "New event" });
  const close = h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() });
  const details = h("div", { className: "ev-detail" });
  const scopeBox = h("div", { className: "ev-scope", hidden: true });

  const working = (on, label) => { busy = on; submit.disabled = on; submit.textContent = on ? "Saving…" : label; };

  // From and To as minutes after midnight, and the length between them. A
  // new From keeps the length; a new To sets it. Nothing runs past midnight.
  const toMin = (s) => { const [a, b] = s.split(":").map(Number); return a * 60 + b; };
  const minText = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  let length = DEFAULT_LENGTH;
  const setTimes = (at, mins) => { length = mins; f.at.value = at; f.to.value = minText(Math.min(toMin(at) + mins, 23 * 60 + 45)); f.to.relabel(f.at.value); };
  f.at.addEventListener("change", () => setTimes(f.at.value, length));
  f.to.addEventListener("change", () => { length = toMin(f.to.value) - toMin(f.at.value); });
  // The length the form says, or null when To isn't after From.
  const formLength = () => { const m = toMin(f.to.value) - toMin(f.at.value); return m > 0 ? m : null; };

  // Google's question for a repeating event, in place of whatever the sheet
  // was showing. Resolves "one" | "following" | "all", or null for Cancel
  // (the sheet goes back to what it was showing).
  function askScope(remove){
    return new Promise((done) => {
      const was = { details: details.hidden, form: form.hidden, note: note.hidden, heading: [...heading.childNodes], cls: heading.className };
      const opt = (value, label) => h("label", { className: "ev-scope-opt" },
        h("input", { type: "radio", name: "evScope", value, checked: value === "one" }), h("span", { textContent: label }));
      const back = (v) => {
        scopeBox.hidden = true;
        details.hidden = was.details; form.hidden = was.form; note.hidden = was.note;
        heading.replaceChildren(...was.heading); heading.className = was.cls;
        done(v);
      };
      scopeBox.replaceChildren(
        opt("one", "This event"), opt("following", "This and following events"), opt("all", "All events"),
        h("div", { className: "ev-acts" },
          h("button", { className: "btn quiet", type: "button", textContent: "Cancel", onclick: () => back(null) }),
          h("button", { className: "btn primary", type: "button", textContent: "OK",
            onclick: () => back(scopeBox.querySelector("input:checked").value) })));
      heading.textContent = remove ? "Delete recurring event" : "Edit recurring event";
      heading.className = "";
      details.hidden = form.hidden = note.hidden = true;
      msg.textContent = "";
      scopeBox.hidden = false;
    });
  }

  // Google's event details: what it is, when it is, and the two things you can
  // do to it. The name is the sheet's heading; under it one card of rows,
  // Google's way: when, where (a tap opens it in Maps, for the ride), and
  // Repeats only when it does (Mor, 2026-10-09).
  // DOM replaceChildren, unlike h(), writes false as text: hence the filter. Read-only events (someone else's calendar) show no buttons —
  // Google greys them out the same way.
  function showDetails(ev){
    const start = Date.parse(ev.start), end = Date.parse(ev.end || ev.start);
    const when = ev.allDay ? "All day" : `${hhmm(start)} – ${hhmm(end)}`;
    const mine = ev.editable && !ev.allDay && ev.end;
    // One tap, no "Really delete?" (Mor, 2026-10-05). The press that used to
    // arm the button now does the thing, and the Undo in the toast is what
    // makes that safe — the same bargain as Later and Pending on the card.
    // It is a real Google delete; Undo writes the event back, on the calendar
    // it came from, so what returns is the event Daisey could see (guests and
    // a repeat rule, which Daisey never held, do not come back). A repeating
    // event asks which days first.
    const del = h("button", { className: "btn quiet danger", type: "button", textContent: "Remove" });
    del.onclick = async () => {
      if (busy) return;
      const scope = ev.recurring ? await askScope(true) : "one";
      if (!scope) return;
      working(true);
      const was = { title: ev.title, calendarId: ev.calendarId, taskId: ev.taskId,
        date: localDate(start), at: hhmm(start), minutes: Math.max(5, Math.round((end - start) / MIN)), location: ev.location || "" };
      try {
        await deleteEvent(ev, scope);
        dialog.close();
        flash(scope === "one" ? "Removed " : scope === "all" ? "Removed every " : "Removed from here on: ", ev.title,
          scope === "one" ? { undo: () => createEvent(was).catch((e) => console.error("[daisey] undo remove", e)) } : {});
      } catch (e) {
        console.error("[daisey] delete event", e);
        msg.textContent = ERROR[e.code] || "Couldn't remove it.";
      }
      working(false, "Save");
    };
    const row = (tag, ico, cls, main, sub, props = {}) => h(tag, { className: `ev-row ${cls}`, ...props }, icon(ico),
      h("div", {}, h("b", {}, main), sub && h("small", { textContent: sub })));
    const mins = Math.round((end - start) / MIN);
    const info = h("div", { className: "ev-info" },
      row("div", "calendar", "ev-time", longDay(start), ev.allDay ? "All day" : `${when} · ${lenText(mins)}`),
      ev.location && row("a", "pin", "ev-place", bdi(ev.location), "Open in Maps",
        { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}`, target: "_blank", rel: "noopener" }),
      ev.recurring && row("div", "repeat", "ev-rep", "Repeats", ""));
    details.replaceChildren(...[
      info,
      mine
        ? h("div", { className: "ev-acts" },
          h("button", { className: "btn", type: "button", textContent: "Edit", onclick: () => showForm(ev) }), del)
        : h("p", { className: "muted ev-ro", textContent: "Read-only. Open it in Google Calendar to change it." }),
    ].filter(Boolean));
    details.hidden = false;
    scopeBox.hidden = true;
    form.hidden = true;
    note.hidden = true;
    heading.replaceChildren(bdi(ev.title));
    heading.className = "ev-name";
  }

  // The same sheet as a form: new, or the event's own values filled in.
  function showForm(ev){
    details.hidden = true;
    scopeBox.hidden = true;
    form.hidden = false;
    note.hidden = !!ev;
    heading.textContent = ev ? "Edit event" : "New event";
    heading.className = "";
    submit.textContent = ev ? "Save" : localOnly ? "Add event" : "Add to calendar";
    if (ev) {
      const start = Date.parse(ev.start), end = Date.parse(ev.end);
      f.title.value = ev.title;
      f.date.value = localDate(start);
      setTimes(hhmm(start), Math.max(5, Math.round((end - start) / MIN)));
      f.to.value = hhmm(end); // the event's own end, unclamped
      f.to.relabel(f.at.value);
      f.place.value = ev.location || "";
    }
    hintPlace();
  }

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const target = editing;
    msg.textContent = "";
    const mins = formLength();
    if (!mins) { msg.textContent = "It has to end after it starts."; return; }
    // What changed, worked out before anything is asked or written: Google
    // asks a repeating event's question only when there is a change to make.
    const was = target && { title: target.title, start: Date.parse(target.start), end: Date.parse(target.end), place: target.location || "" };
    const [y, m, d] = f.date.value.split("-").map(Number);
    const [hh, mm] = f.at.value.split(":").map(Number);
    const start = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
    const end = start + mins * MIN;
    const title = f.title.value.trim();
    const renamed = !!(target && title && title !== was.title);
    const moved = !!(target && (start !== was.start || end !== was.end));
    const place = f.place.value.trim().replace(/\s+/g, " ");
    const placed = !!(target && place !== was.place);
    if (target && !renamed && !moved && !placed) { dialog.close(); return; }
    const scope = target?.recurring ? await askScope(false) : "one";
    if (!scope) return;
    working(true);
    try {
      if (target && scope !== "one") {
        // A series change goes as one write, so "this and following" splits
        // the series once, not once for the title and again for the times.
        await editEvent(target, { scope, title: renamed ? title : "", start: moved ? start : null, end, location: placed ? place : undefined });
        dialog.close();
        flash(scope === "all" ? "Saved every " : "Saved from here on: ", title || was.title);
      } else if (target) {
        // What Google's Save does: whatever changed, in one write. Only what
        // moved goes, so nothing else on the event is touched.
        await editEvent(target, { title: renamed ? title : "", start: moved ? start : null, end, location: placed ? place : undefined });
        dialog.close();
        flash("Saved ", title || was.title, {
          undo: () => editEvent(target, { title: renamed ? was.title : "", start: moved ? was.start : null, end: was.end,
            location: placed ? was.place : undefined }),
        });
      } else {
        // Unlike a task, this one waits: the calendar is somebody else's
        // database, and "it's in" has to mean Google said so.
        await createEvent({ title: f.title.value, date: f.date.value, at: f.at.value, minutes: mins, location: place });
        dialog.close();
      }
    } catch (e) {
      console.error("[daisey] save event", e);
      msg.textContent = ERROR[e.code] || (target ? "Couldn't save it." : localOnly ? "Couldn't save the event on this device." : "Couldn't add it to the calendar.");
    }
    working(false, target ? "Save" : localOnly ? "Add event" : "Add to calendar");
  };

  dialog.replaceChildren(h("div", { className: "now-head" }, heading, close), details, scopeBox, form, msg, note);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  return {
    // date: the day the Schedule panel is on ("YYYY-MM-DD"); defaults to today.
    // at: "HH:MM" — a slot that was tapped; otherwise the next quarter hour.
    open(date, at){
      msg.textContent = "";
      editing = null;
      form.reset();
      f.date.value = date || localDate();
      setTimes(at || nextQuarter(), DEFAULT_LENGTH);
      showForm(null);
      if (!dialog.open) dialog.showModal();
    },
    // An event tapped in the schedule: its details first, Edit second.
    view(ev){
      msg.textContent = "";
      editing = ev;
      form.reset();
      showDetails(ev);
      if (!dialog.open) dialog.showModal();
    },
    unmount(){ if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
