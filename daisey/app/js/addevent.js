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
// Four fields, because that is the whole of a meeting as Daisey needs it:
// what, which day, from, to. No guests, no description, no recurrence, no
// calendar picker — those are Google Calendar's job, and the event lands
// there to be opened if any of them are wanted. From–to rather than a length
// (Mor, 2026-10-05): To starts an hour after From, and moving From carries
// To along with it, as Google does, so a one-hour event is still one choice.
//
// Delete is one tap called Remove, undone from the toast (Mor, 2026-10-05:
// "a 1 click remove", instead of a delete and a check after).
//
// A new event opens on the day the Schedule panel is showing, with the time
// rounded up to the next quarter hour, so adding something to Thursday from
// Thursday's page needs the title and nothing else.
import { createEvent, retime, renameEvent, deleteEvent } from "./calendar.js";
import { localDate } from "./model.js";
import { h, bdi, flash } from "./ui.js";

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
  needs_reauth: "Calendar sign-in expired. Sign in to the old Daisey again.",
  no_session: "Signed out.",
  not_connected: "Calendar not connected. Sign in to the old Daisey once to link it.",
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

export function mountAddEvent(dialog){
  let busy = false;
  let editing = null; // the event being looked at or edited, or null when adding
  const f = {
    title: h("input", { dir: "auto", required: true, autocomplete: "off" }),
    date: h("input", { type: "date", required: true }),
    at: timePick("From"),
    to: timePick("To"),
  };
  const msg = h("p", { className: "msg", role: "alert" });
  const submit = h("button", { className: "btn primary", type: "submit", textContent: "Add to calendar" });
  const form = h("form", { className: "form-grid ev-grid" },
    field("Event", f.title, true),
    field("Day", f.date, true),
    field("From", f.at),
    field("To", f.to),
    submit);
  const note = h("p", { className: "muted ev-note", textContent: "Goes in your main Google calendar. Guests, repeats and the rest are a tap away in Google Calendar." });
  const heading = h("h2", { id: "evTitle", textContent: "New event" });
  const close = h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() });
  const details = h("div", { className: "ev-detail" });

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

  // Google's event details: what it is, when it is, and the two things you can
  // do to it. Read-only events (someone else's calendar) show no buttons —
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
    // a repeat rule, which Daisey never held, do not come back).
    const del = h("button", { className: "btn quiet danger", type: "button", textContent: "Remove" });
    del.onclick = async () => {
      if (busy) return;
      working(true);
      const was = { title: ev.title, calendarId: ev.calendarId, taskId: ev.taskId,
        date: localDate(start), at: hhmm(start), minutes: Math.max(5, Math.round((end - start) / MIN)) };
      try {
        await deleteEvent(ev);
        dialog.close();
        flash("Removed ", ev.title, { undo: () => createEvent(was).catch((e) => console.error("[daisey] undo remove", e)) });
      } catch (e) {
        console.error("[daisey] delete event", e);
        msg.textContent = ERROR[e.code] || "Couldn't remove it.";
      }
      working(false, "Save");
    };
    details.replaceChildren(
      h("p", { className: "ev-when", textContent: longDay(start) }),
      h("h3", { className: "ev-name", dir: "auto" }, bdi(ev.title)),
      h("p", { className: "ev-time", textContent: when }),
      mine
        ? h("div", { className: "ev-acts" },
          h("button", { className: "btn", type: "button", textContent: "Edit", onclick: () => showForm(ev) }), del)
        : h("p", { className: "muted", textContent: "This one is read-only — open it in Google Calendar to change it." }));
    details.hidden = false;
    form.hidden = true;
    note.hidden = true;
    heading.textContent = "Event";
  }

  // The same sheet as a form: new, or the event's own values filled in.
  function showForm(ev){
    details.hidden = true;
    form.hidden = false;
    note.hidden = !!ev;
    heading.textContent = ev ? "Edit event" : "New event";
    submit.textContent = ev ? "Save" : "Add to calendar";
    if (ev) {
      const start = Date.parse(ev.start), end = Date.parse(ev.end);
      f.title.value = ev.title;
      f.date.value = localDate(start);
      setTimes(hhmm(start), Math.max(5, Math.round((end - start) / MIN)));
      f.to.value = hhmm(end); // the event's own end, unclamped
      f.to.relabel(f.at.value);
    }
    setTimeout(() => f.title.focus());
  }

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const target = editing;
    msg.textContent = "";
    const mins = formLength();
    if (!mins) { msg.textContent = "It has to end after it starts."; return; }
    working(true);
    try {
      if (target) {
        // What Google's Save does: whatever changed, in one go. Title and
        // times are two different writes here, so only the ones that moved go.
        const was = { title: target.title, start: Date.parse(target.start), end: Date.parse(target.end) };
        const [y, m, d] = f.date.value.split("-").map(Number);
        const [hh, mm] = f.at.value.split(":").map(Number);
        const start = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
        const end = start + mins * MIN;
        const title = f.title.value.trim();
        if (title && title !== was.title) await renameEvent(target, title);
        if (start !== was.start || end !== was.end) await retime(target, start, end);
        dialog.close();
        flash("Saved ", title || was.title, {
          undo: async () => {
            if (title && title !== was.title) await renameEvent(target, was.title);
            if (start !== was.start || end !== was.end) await retime(target, was.start, was.end);
          },
        });
      } else {
        // Unlike a task, this one waits: the calendar is somebody else's
        // database, and "it's in" has to mean Google said so.
        await createEvent({ title: f.title.value, date: f.date.value, at: f.at.value, minutes: mins });
        dialog.close();
      }
    } catch (e) {
      console.error("[daisey] save event", e);
      msg.textContent = ERROR[e.code] || (target ? "Couldn't save it." : "Couldn't add it to the calendar.");
    }
    working(false, target ? "Save" : "Add to calendar");
  };

  dialog.replaceChildren(h("div", { className: "now-head" }, heading, close), details, form, msg, note);
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
