// Every tunable number in the Now engine, in one place. Values are the
// spec's starting values (DAISEY_SPEC.md, "Now engine logic") unless marked
// OURS — those fill a gap the spec leaves, or replace the "hard due" field
// Mor dropped after session 2.

// Step 1 — read the moment
export const WINDOW_CAP = 180; // minutes; a longer free stretch counts as 180
export const NO_CALENDAR_WINDOW = 60; // until session 8 connects the calendar
export const AFTERNOON_FROM = 12; // hour; morning before, afternoon 12–17
export const EVENING_FROM = 17;
export const WEEKEND_DAYS = [5, 6]; // OURS: Friday + Saturday (Israel), getDay() numbers

// Step 2 — filter
export const SPLIT_MIN_WINDOW = 25; // a splittable task too big for the window still fits if the window is this long
export const STALE_SKIPS = 5; // skipped this many times without a start → stop suggesting, ask in chat

// Step 3 — score
export const URGENCY = {
  hardToday: 35, // hard due today, or overdue
  hardSoon: 25, // hard due later (spec: "within 2 days"; OURS: any tight due, see TIGHT)
  softToday: 20,
  within3: 12, // days
  within7: 6,
  none: 0,
};

// OURS. A due turns hard when the time left before it gets tight for the
// task's size. Time left = waking hours between now and the due, times the
// share of them one task can realistically get. Tight = that is less than
// MARGIN times what the task still needs. A due with no time is due at
// DAY_END. Bigger tasks go hard earlier, which is the point.
export const TIGHT = {
  dayStart: 9, // hour
  dayEnd: 22,
  share: 0.25, // ≈ 3¼ h a day for any one task
  margin: 2, // want double the room the task needs
  minLeft: 5, // minutes a task still needs, at least (spent ≥ size doesn't mean done)
};

export const ENERGY_FIT = {
  same: 25,
  easier: 18, // task needs one step less than you have
  muchEasier: 12, // OURS: low task, high energy (spec has no row)
  harder: 5, // task needs one step more (high-vs-low is filtered out)
};

export const WINDOW_FIT = {
  full: 15, // task fills 50–100% of the window
  half: 10, // 25–50%
  small: 6, // under 25%
  piece: 8, // too big, but a split piece fits
};

export const MOMENTUM = {
  lastToday: 10, // same project as the last one started or finished today
  recent: 5, // project worked on in the last RECENT_DAYS
  recentDays: 2,
};

export const NEGLECT_PER_DAY = 1; // per whole day untouched
export const NEGLECT_MAX = 10;
export const LEARNED_MIN = -10; // learned fit arrives in session 10
export const LEARNED_MAX = 10;
export const SKIP_PENALTY = 8; // per skip of this task today

// Something else
export const ALTERNATIVES = 3;
export const VARIETY_WITHIN = 15; // points; prefer another project if it scores this close

// Why line
export const WHY_PARTS = 3; // at most
export const WHY_MIN_POINTS = 5; // a factor worth less than this isn't a reason
