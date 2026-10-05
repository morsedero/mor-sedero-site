// Every tunable number in the Now engine, in one place. Values are the
// spec's starting values (DAISEY_SPEC.md, "Now engine logic": three gates)
// unless marked OURS — those fill a gap the spec leaves.

// ---------- Step 1 — read the moment ----------
export const WINDOW_CAP = 180; // minutes; a longer free stretch counts as 180
export const NO_CALENDAR_WINDOW = 60;
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

// Energy and place: a correction holds this long, then the guess is back.
export const CORRECTION_HOURS = 3;
export const ENERGY_LEVELS = ["low", "medium", "high"];
export const ENERGY_PATTERN_MIN = 5; // corrections in a time bucket before its average counts
// A calendar event that ended this recently lowers energy one step if it
// was long or draining.
export const DRAIN = { withinMinutes: 60, longMinutes: 120, words: ["teaching", "lesson", "rehearsal", "class", "שיעור", "חזרה", "הוראה"] };
// An event with a location, running or ended this recently, means Out.
export const OUT_AFTER_MINUTES = 30;

// ---------- Gate 1 — can it be done now? ----------
export const SPLIT_MIN_WINDOW = 25; // a splittable task too big for the window still fits if the window is this long
export const STALE_SKIPS = 5; // skipped this many times without a start → stop suggesting, ask in chat
// Which task places can't happen where you are. Anywhere (as the moment)
// filters nothing. (Mor approved, 2026-10-04.)
export const PLACE_BLOCKS = { out: ["home", "computer"], home: [] };

// ---------- Gate 2 — what does leaving it cost? ----------
export const DEADLINE = { today: 35, within2: 25, within7: 12 }; // past or today · ≤2 days · ≤7 days
export const TARGET = { today: 8, within3: 4 }; // today or past · ≤3 days; never "overdue"
export const STAKES = { penalty: 15, money: 12, someone: 10, low: 0 };
export const AREA_BALANCE_MAX = 12;
export const NEGLECT_PER_DAY = 1; // per whole day untouched
export const NEGLECT_MAX = 8;

// ---------- Gate 3 — does it fit this gap? ----------
// Steps = task's energy minus yours: 0 exact, −1 one step less, +1 one more.
// OURS: two steps less (a low task on a high day) still fits, at 5.
export const ENERGY_FIT = { exact: 15, less: 10, twoLess: 5, more: 3 };
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
