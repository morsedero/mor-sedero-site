// Every tunable number in the Now engine, in one place. Values are the
// spec's starting values (DAISEY_SPEC.md, "Now engine logic": three gates)
// unless marked OURS — those fill a gap the spec leaves.

// ---------- Step 1 — read the moment ----------
export const WINDOW_CAP = 180; // minutes; a longer free stretch counts as 180
export const NO_CALENDAR_WINDOW = 60;
// Breathing room before the next calendar event (Mor, 2026-10-06: 10 min):
// a 60-minute gap offers 50 minutes of task, so nothing ends exactly as a
// meeting starts.
export const EVENT_BUFFER = 10;
export const AFTERNOON_FROM = 12; // hour; morning before, afternoon 12–17
export const EVENING_FROM = 17; // also when an "Evening" task opens up
export const WEEKEND_DAYS = [5, 6]; // Friday + Saturday (Israel), getDay() numbers

// Offices: open Sun–Thu 9:00–16:00, closed Fri, Sat and Israeli holidays.
export const OFFICE = { days: [0, 1, 2, 3, 4], open: 9, close: 16 };
// Holidays offices close for, as Hebrew-calendar dates ("<month> <day>", the
// way Intl names them). holidays.js finds them in any year. Independence Day
// (Iyar 5) is listed apart because it moves off Friday, Saturday and Monday.
export const HOLIDAYS = ["Tishri 1", "Tishri 2", "Tishri 10", "Tishri 15", "Tishri 22", "Nisan 15", "Nisan 21", "Sivan 6"];
export const INDEPENDENCE_DAY = "Iyar 5";

// Place: a correction holds this long, then the guess is back. (Energy was
// dropped 2026-10-07: nobody wants to rate their own energy.)
export const CORRECTION_HOURS = 3;
// A calendar event with one of these words is the thing itself, not time set
// aside for a project (now.js blockOf). It used to also lower energy.
export const DRAIN = { words: ["teaching", "lesson", "rehearsal", "class", "שיעור", "חזרה", "הוראה"] };
// An event with a location, running or ended this recently, means Out.
export const OUT_AFTER_MINUTES = 30;

// ---------- Gate 1 — can it be done now? ----------
export const SPLIT_MIN_WINDOW = 25; // a splittable task too big for the window still fits if the window is this long
export const STALE_SKIPS = 5; // skipped this many times without a start → stop suggesting, ask in chat
// …except a real deadline this close: a task you keep dodging still comes up
// as its date nears, and Needs you asks the keep/shrink/drop question.
export const STALE_KEEP_DEADLINE_DAYS = 7;
// A task parked in Not now (someday) with a real deadline this close, or
// passed, comes back as a Needs you question — Someday can't hide a deadline.
export const SOMEDAY_DEADLINE_DAYS = 3;
// Pushed to Tomorrow / This week (or moved on by the wrap or the sweep) this
// many times without a start → Needs you asks shrink, keep or let go (Mor,
// 2026-10-06: 2). A plan made twice and kept twice is a task in trouble.
export const PUSHES_ASK = 2;
// Which task places can't happen where you are. Anywhere (as the moment)
// filters nothing. (Mor approved, 2026-10-04.) The moving ones come from
// the phone's location (where.js, 2026-10-05): walking takes calls and
// errands; a train adds the laptop; a bus, or a ride not yet named, takes
// calls and anywhere-tasks only; driving takes hands-free calls only
// (DRIVING_TYPES, Mor 2026-10-05; texting stays out), else now.js shows the
// driving card.
export const DRIVING_TYPES = ["call"];
export const PLACES = ["home", "out", "anywhere", "walk", "ride", "train", "bus", "car", "spot"];
export const PLACE_BLOCKS = {
  out: ["home", "computer"], home: [],
  spot: ["home"], // a saved place that isn't home: settled, so the laptop is fine
  walk: ["home", "computer"],
  train: ["home", "out"],
  bus: ["home", "out", "computer"], ride: ["home", "out", "computer"],
  car: ["home", "out", "computer", "phone", "anywhere"],
};

// ---------- Gate 2 — what does leaving it cost? ----------
export const DEADLINE = { today: 35, within2: 25, within7: 12 }; // past or today · ≤2 days · ≤7 days
// OURS (2026-10-06): big work starts early. A deadline scores as if it were
// one day closer for every DEADLINE_LEAD_PER_DAY minutes still to do past
// the first day's worth — 6 h left reads a deadline 2 days early. Before
// this a 6-hour job due in 10 days scored nothing until 7 days out.
export const DEADLINE_LEAD_PER_DAY = 120;
export const TARGET = { today: 8, within3: 4 }; // today or past · ≤3 days; never "overdue"
export const STAKES = { penalty: 15, money: 12, someone: 10, low: 0 };
export const AREA_BALANCE_MAX = 12;
export const NEGLECT_PER_DAY = 1; // per whole day untouched
export const NEGLECT_MAX = 8;

// ---------- Gate 3 — does it fit this gap? ----------
export const WINDOW_FIT = {
  full: 12, // task fills 50–100% of the window
  half: 8, // 25–50%
  small: 5, // under 25%
  piece: 6, // too big, but a split piece fits
};
export const MOMENTUM = {
  lastToday: 8, // same project as the last one started or finished today
  recent: 4, // project worked on in the last RECENT_DAYS
  recentDays: 2,
};
// The why line calls a task a "quick win" only up to this many minutes.
export const QUICK_WIN_MAX = 15;
// A task naming the saved place you're at (engine spot()).
export const SPOT_POINTS = 10;
export const BATCH = { bonus: 10, types: ["call", "admin", "errand"], min: 2, max: 5 };
export const LEARNED_MIN = -10;
export const LEARNED_MAX = 10;
// OURS: learned fit = MAX × (starts − skips) / (starts + skips + DAMP), per
// task type and time of day. DAMP keeps a single start from saying much.
export const LEARNED_DAMP = 3;
export const SKIP_PENALTY = 8; // per skip of this task today

// Later: how long a skipped task stays off the card. Long enough that
// "not now" means something, short enough that it comes back the same day.
export const LATER_MINUTES = 120;

// Cancel in focus mode: under this many minutes it was a mis-tap and nothing
// is saved; from here on the minutes were real work and are kept (never
// counted as a stop either way). Mor, 2026-10-05.
export const CANCEL_KEEP_MINUTES = 2;

// A forgotten timer (focus.js runCap): past FACTOR × the planned time, and at
// least EXTRA minutes over it, focus mode asks "Still on it?", and Done or
// Stop book no more than that cap unless the answer was yes. Without it, a
// Start left running overnight booked 14 h to the task, the calendar log and
// every later size guess for similar tasks.
export const RUN_ASK = { factor: 2, extra: 30 };
// A paused run still counts as your focus for this long (reality.js
// runState): no competing suggestions while you stepped away. Past it, it's a
// forgotten pause, not a signal.
export const RUN_PAUSE_STALE = 180;

// Something else
export const ALTERNATIVES = 3;
export const VARIETY_WITHIN = 15; // points; prefer another area if it scores this close

// Why line
export const WHY_PARTS = 3; // at most
export const WHY_MIN_POINTS = 5; // a factor worth less than this isn't a reason
// OURS: "offices close at 16:00" isn't a score, but it's worth saying when an
// office-hours task is up and closing is this close. It ranks in the why
// line as if it scored WHY_OFFICE_POINTS.
export const OFFICE_SOON_MINUTES = 180;
export const WHY_OFFICE_POINTS = 9;
// OURS: a task already this far along is worth saying so ("half done, finish
// it"). Not a score; it ranks in the why line as if it scored WHY_PROGRESS_POINTS.
export const PROGRESS_SAY_MIN = 25;
export const WHY_PROGRESS_POINTS = 7;

// Overdue triage (DAISEY_SPEC "Overdue triage"). The sweep is offered when
// MORE than this many deadlines, or targets, have passed — once a day.
export const SWEEP = { deadlines: 3, targets: 5 };
// "This week" in the sweep: the day with the most room, counted over the
// day hours, from tomorrow to the end of the week (Saturday, getDay 6).
export const WEEK_END_DAY = 6;
// Day hours, minutes after midnight (DAISEY_SPEC "Day hours"): free time
// counts only inside them, and outside them the card is in night mode. The
// user can change them in the account menu (state/settings dayStart/dayEnd).
export const DAY_HOURS = { start: 8 * 60, end: 22 * 60 };
// Breaks in the proposed plan (Mor, 2026-10-08). Work counts tasks and
// events; a gap of idle RESET minutes or more starts the count over. All
// minutes except lunch's window, which is minutes after midnight.
export const BREAKS = {
  after: 90, short: 10, // a short break after this much work
  longEvery: 180, long: 30, // a long break after this much work with no long one
  reset: 15, // idle this long counts as a break
  lunch: { from: 12 * 60, to: 14 * 60, minutes: 45 },
  lunchAfter: 30, // lunch waits until this much work, unless the window is closing
};
