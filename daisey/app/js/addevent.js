// Adding a Google Calendar event without leaving Daisey (Mor, 2026-10-04:
// "so the user won't have to jump between the two").
//
// Four fields, because that is the whole of a meeting as Daisey needs it:
// what, which day, what time, how long. No guests, no description, no
// recurrence, no calendar picker — those are Google Calendar's job, and the
// event lands there to be opened if any of them are wanted. Length instead
// of an end time: "45 min" is one choice rather than two, and it is how
// Daisey says duration everywhere else (durText).
//
// It opens on the day the Schedule panel is showing, with the time rounded
// up to the next quarter hour, so adding something to Thursday from
// Thursday's page needs the title and nothing else.
import { createEvent } from "./calendar.js";
import { durText, localDate } from "./model.js";
import { h } from "./ui.js";

const LENGTHS = [15, 30, 45, 60, 90, 120, 180];
const DEFAULT_LENGTH = 60;
const pad = (n) => String(n).padStart(2, "0");

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
  bad_request: "Something in that didn't make sense to Google.",
};

let n = 0;
const field = (label, input, wide) => {
  input.id = `ev-f${++n}`;
  return h("div", { className: "field" + (wide ? " wide" : "") }, h("label", { htmlFor: input.id, textContent: label }), input);
};

export function mountAddEvent(dialog){
  let busy = false;
  const f = {
    title: h("input", { dir: "auto", required: true, autocomplete: "off" }),
    date: h("input", { type: "date", required: true }),
    at: h("input", { type: "time", required: true, step: 300 }),
    minutes: h("select", {}, ...LENGTHS.map((v) => h("option", { value: String(v), textContent: durText(v) }))),
  };
  const msg = h("p", { className: "msg", role: "alert" });
  const submit = h("button", { className: "btn primary", type: "submit", textContent: "Add to calendar" });
  const form = h("form", { className: "form-grid ev-grid" },
    field("Event", f.title, true),
    field("Day", f.date),
    field("Starts", f.at),
    field("Length", f.minutes),
    submit);
  const close = h("button", { className: "now-x", type: "button", ariaLabel: "Close", textContent: "✕", onclick: () => dialog.close() });

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    busy = true; submit.disabled = true; submit.textContent = "Adding…"; msg.textContent = "";
    try {
      // Unlike a task, this one waits: the calendar is somebody else's
      // database, and "it's in" has to mean Google said so.
      await createEvent({ title: f.title.value, date: f.date.value, at: f.at.value, minutes: Number(f.minutes.value) });
      dialog.close();
    } catch (e) {
      console.error("[daisey] create event", e);
      msg.textContent = ERROR[e.code] || "Couldn't add it to the calendar.";
    }
    busy = false; submit.disabled = false; submit.textContent = "Add to calendar";
  };

  dialog.replaceChildren(
    h("div", { className: "now-head" }, h("h2", { id: "evTitle", textContent: "New event" }), close),
    form, msg,
    h("p", { className: "muted ev-note", textContent: "Goes in your main Google calendar. Guests, repeats and the rest are a tap away in Google Calendar." }));
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  return {
    // date: the day the Schedule panel is on ("YYYY-MM-DD"); defaults to today.
    // at: "HH:MM" — the slot tapped in the grid; otherwise the next quarter hour.
    open(date, at){
      msg.textContent = "";
      form.reset();
      f.date.value = date || localDate();
      f.at.value = at || nextQuarter();
      f.minutes.value = String(DEFAULT_LENGTH);
      if (!dialog.open) dialog.showModal();
      f.title.focus();
    },
    unmount(){ if (dialog.open) dialog.close(); dialog.replaceChildren(); },
  };
}
