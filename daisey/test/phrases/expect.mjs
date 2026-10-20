// What each phrases.csv row should come out as, in the parser's own terms
// (tell-read.js understood(): add / update / waiting / drop / done / project /
// event / moment / query, plus a question). daisey_should in the CSV is the
// words; this is the same thing made checkable. run.mjs scores meaning and
// state change, never wording: titles are regexes, fields not named are
// free, a field set to null must stay empty.
//
// A spec: { expect: [matcher…] } every matcher takes one distinct action;
//   any other action that changes something is a false mutation.
//   expect: [] (the `none` spec) = change nothing; a question is fine.
// { alt: [spec…] } any one passes. { ask: true } a question is required.
// { dates: [ymd…], needDate } every date said must be one of these (needDate:
//   at least one), for a bare date phrase ("Thursday") whatever it lands on.
// { extra: [kind…] } kinds tolerated beyond the matchers. { time } an event's.
// { tasks } this row's task list instead of STATE.tasks. { preview } the cards on screen, not applied yet (a correction of them comes back as the corrected card).
// { flag } a row whose CSV wording disagrees with the app: the app's logic wins (Mor, 2026-10-19).
// Matcher { kind, …fields }: kind "change" = add or update; `task` tests the
// title (an update's: the existing task's); `not` a title that must not match.
// A kind the parser doesn't have (endDay) can't match: the row fails as "no such action", which is the finding.

// Default clock: Monday 2026-10-19 10:00, Asia/Jerusalem. "Tue 14:00" etc.
// are that week (Sun 10-18 … Sat 10-24); "Oct 26" is Monday 10-26 10:00.
const OLD = new Date(2026, 9, 12, 9).getTime(), T = (h, m) => new Date(2026, 9, 18, h, m).getTime();
export const STATE = {
  now: "t2",            // what the Now card shows
  recent: ["t6", "t7"], // the last tasks added, newest first ("make it 30"): from createdAt, as the app reads it
  tasks: [
    { id: "t1", title: "Invoice", status: "ready", createdAt: OLD },
    { id: "t2", title: "Report for Yoni", status: "ready", due: "2026-10-23", size: 120, createdAt: OLD },
    { id: "t3", title: "Master track 2", status: "ready", project: "Album mixing", createdAt: OLD },
    { id: "t4", title: "Send stems to Dana", status: "waiting", waitingOn: "Dana", createdAt: OLD },
    { id: "t5", title: "Coffee with Dan", status: "ready", createdAt: OLD },
    { id: "t6", title: "Email Dana the quote", status: "ready", due: "2026-10-22", size: 20, createdAt: T(9, 30) },
    { id: "t7", title: "Book studio", status: "ready", size: 60, createdAt: T(9, 0) },
  ],
};

const none = { expect: [] };
const add = (o) => ({ kind: "add", ...o });
const change = (task, o = {}) => ({ kind: "change", task, ...o });
const upd = (taskId, o) => ({ kind: "update", taskId, ...o });
const one = (...ms) => ({ expect: ms });
const either = (...specs) => ({ alt: specs });
const bare = (...dates) => ({ dates, needDate: true });
const blank = { size: null, due: null, notBefore: null };
// a routine on one of these sets of weekdays (0 = Sunday)
const onDays = (...sets) => (r) => !!r?.days && sets.some((s) => s.length === r.days.length && s.every((d) => r.days.includes(d)));
const has = (...res) => (t) => typeof t === "string" && res.every((re) => re.test(t));

export const EXPECT = {
  // Capture
  1: one(add({ title: /milk/i, ...blank, project: null })),
  2: one(add({ title: /dentist/i, due: null })),
  3: one(add({ title: /invoice/i, ...blank }), add({ title: /report/i, ...blank }), add({ title: /passport/i, ...blank })),
  4: either(one({ kind: "project", project: /^album mixing$/i }), none), // it exists already
  5: one(add({ title: /master track 3/i, project: /^album mixing$/i })),
  6: { expect: [add({ title: /fmod/i, project: /cave run/i })], extra: ["project"] },
  7: { ...one(add({ title: /inbox/i, routine: onDays([0, 1, 2, 3, 4]), due: null })),
    flag: "CSV says Mon-Fri; scored by app logic: weekday = Sun-Thu." },
  8: one(add({ title: /stretch/i, size: null, due: null })),
  9: one(add({ title: /batter/i, ...blank }), add({ title: /stamp/i, ...blank }), add({ title: /charger/i, ...blank })),
  10: one(add({ title: /portuguese/i, size: 15 })),
  11: one({ kind: "event", title: /dana|meeting/i, date: "2026-10-22", time: "14:00" }),
  12: none,
  // Durations
  13: one(change(/invoice/i, { size: 20 })),
  14: one(change(/report/i, { size: 120 }), add({ title: /email/i, size: 10 })),
  15: one(add({ title: /mom/i, size: 15 }), add({ title: /rent/i, size: 15 })),
  16: none,
  17: one(add({ title: /mix/i, size: 90 })),
  18: one(add({ title: /email/i, size: 30 })),
  19: one(add({ title: /dana/i, size: null })),
  20: one(add({ title: /guitar/i, size: 45 })),
  21: one(add({ title: /video/i, size: 120 })),
  22: one(add({ title: /deck/i, size: 90 })),
  23: one(change(/report/i, { size: 180, due: "2026-10-23" })),
  24: either(none, one(upd("t2", { size: 40 }))), // never a Done
  25: none,
  26: one(add({ title: /slides/i, size: 60 }), add({ title: /notes/i, size: 20 })),
  // Dates and day words
  27: one(change(/invoice/i, { due: "2026-10-21" })),
  28: { ...one(change(/invoice/i, { due: "2026-10-20" })),
    flag: "CSV says Wednesday; scored by app logic: at Tue 01:30 the day is still Monday, so tomorrow is Tuesday 10-20." },
  29: either(none, bare("2026-10-19")),
  30: { expect: [change(/rent/i)], dates: ["2026-10-22"],
    flag: "CSV says yesterday = Friday; scored by app logic: at Sat 01:51 today is Friday, so yesterday is Thursday 10-22." },
  31: one({ kind: "event", title: /dana/i, date: "2026-10-20", time: "08:00" }),
  32: { expect: [], ask: true }, // do-not-regress: ask, never pick Tue or Wed
  33: bare("2026-10-25"),
  34: bare("2026-10-22"),
  35: { ...bare("2026-10-24"), flag: "Scored by app logic: the week ends Saturday (weights.js)." },
  36: bare("2026-10-22"),
  37: bare("2026-11-25"),
  38: bare("2026-10-23"),
  39: none,
  40: bare("2026-10-20"),
  41: { ...bare("2026-10-19"), time: "23:30" },
  42: bare("2026-11-02"),
  // Corrections (t6 is the last task, t7 the one before)
  43: one(upd("t6", { size: 30 })),
  44: one(upd("t6", { due: "2026-10-23" })),
  45: one(upd("t6", { title: /^send quote$/i, due: null, size: null })),
  46: one(upd("t6", { project: /album mixing/i })),
  47: one(upd("t6", { title: /mom/i, not: /dana/i })),
  48: none,
  49: one(upd("t6", { size: 15 }), upd("t7", { size: 15 })),
  50: none,
  51: none, // the preview's own item, not a task
  52: one(upd("t6", { size: 30 })),
  // Hebrew / mixed
  53: one(add({ title: /לקנות חלב/ })),
  54: either(one(add({ title: /להתקשר לדנה/, due: "2026-10-20" })), one({ kind: "event", title: /דנה/, date: "2026-10-20", time: "10:00" })),
  55: either(one(add({ title: /חשבונית/, size: 20 })), one(upd("t1", { size: 20 }))),
  56: one(add({ title: has(/reminder/i, /יוני/), due: "2026-10-20" })),
  57: one(add({ title: has(/mix/i, /לשיר/), size: 90 })),
  58: one(add({ title: /master/i, project: /album|האלבום/i })),
  59: one(upd("t6", { size: 30 })),
  60: bare("2026-10-21"),
  61: none,
  62: either(none, { ...bare("2026-10-20"), time: "02:00" }),
  63: bare("2026-10-19"),
  64: one(add({ title: has(/call/i, /דנה/, /quote/i), size: 15 })),
  65: one({ kind: "done", taskId: "t2" }),
  66: either(one({ kind: "later", taskId: "t2" }), none),
  // Voice and mumbling
  67: one(add({ title: /call dana/i, not: /\b(um|uh|so like|i think)\b/i, due: "2026-10-20" })),
  68: one(add({ title: /milk/i, not: /egg/i })),
  69: one(add({ title: /dana/i, not: /dina/i, due: "2026-10-20" })),
  70: one(change(/report/i, { size: 30 })),
  71: none,
  72: none,
  73: one({ kind: "query", query: "next" }),
  74: none,
  75: none, // nothing heard: the bar sends nothing
  76: either(one({ kind: "later", taskId: "t2" }), none),
  // Exits (t2 is on the Now card)
  77: one({ kind: "done", taskId: "t2" }),
  78: one({ kind: "done", taskId: "t1" }),
  79: one({ kind: "switch" }),
  80: either(one({ kind: "later", taskId: "t2" }), one({ kind: "switch" }), none),
  81: one({ kind: "later", taskId: "t2", until: "today" }),
  82: either(one(upd("t2", { notBefore: "2026-10-20", due: null })), one({ kind: "later", taskId: "t2", until: "tomorrow" })),
  83: one({ kind: "waiting", taskId: "t2", waitingOn: /yoni/i }),
  84: one({ kind: "waiting", taskId: "t2", waitingOn: /dana/i, checkOn: "2026-10-22" }),
  85: one({ kind: "hold", taskId: "t2" }),
  86: one({ kind: "drop", taskId: "t2" }),
  87: one({ kind: "undo" }),
  88: one({ kind: "endDay" }),
  89: one({ kind: "resume", taskId: "t4" }),
  90: none, // no Start button: "already on it"
  // Ambiguity: ask, don't guess
  91: none, 92: none, 93: none, 94: none, 95: none, 96: none, 97: none, 98: none,
  99: either(none, one(add({ title: /\bdan\b/i, not: /dana/i }))),
  100: none, 101: none, 102: none,
  // Holdout paraphrases (review column names the row they restate)
  103: one(add({ title: /milk/i, ...blank })),
  104: one(add({ title: /electric/i, ...blank }), add({ title: /flight/i, ...blank }), add({ title: /library/i, ...blank })),
  105: one(add({ title: /portuguese/i, size: 15 })),
  106: one(add({ title: /proposal/i, size: 90 }), add({ title: /yoni/i, size: 5 })),
  107: one(add({ title: /plant/i, size: 10 }), add({ title: /trash/i, size: 10 })),
  108: none,
  109: one(add({ title: /mix/i, size: 150 })),
  110: one(add({ title: /slides/i, size: 30 })),
  111: one(change(/invoice/i, { due: "2026-10-21" })),
  112: one(add({ title: /gas/i, due: "2026-10-21" })),
  113: bare("2026-10-23"),
  114: bare("2026-10-26"),
  115: one(upd("t6", { size: 45 })),
  116: one(upd("t6", { title: /yoni/i, not: /dana/i })),
  117: one(add({ title: /לסדר את המחסן/, size: 60 })),
  118: one(add({ title: /לדנה/, due: "2026-10-20" })),
  119: one(add({ title: /insurance/i, not: /bank/i })),
  120: one({ kind: "done", taskId: "t1" }),
  121: one({ kind: "waiting", taskId: "t2", waitingOn: /yoni/i }),
  122: none,
  // Fresh rows H61-H80 (Mor, 2026-10-20): the clean holdout. Run once per round, reported alone, never tuned on.
  // The week is Mon 10-19 … Sun 10-25: Tuesday is the 20th.
  H61: one(add({ title: /stems/i, due: "2026-10-23", size: null })),
  H62: { expect: [{ kind: "project", project: /game audio pass/i }, add({ title: /footsteps/i, project: /game audio pass/i })] },
  H63: one({ kind: "event", title: /dentist/i, date: "2026-10-25", time: "09:30" }),
  H64: one(add({ title: /chorus/i, size: 60 }), add({ title: /stems/i, size: 25 }), add({ title: /ido/i, size: null })),
  H65: one(add({ title: /tax/i, size: 120 })),
  H66: none,
  H67: one(add({ title: /lesson prep/i, size: 45 })),
  H68: one(add({ title: /demo/i, size: null, due: (d) => d == null || d === "2026-10-20" })),
  H69: { ...one(add({ title: /label/i, due: "2026-10-21" })), flag: "Scored by app logic: at Wed 02:10 the day is still Tuesday, so tomorrow = Wednesday 10-21 (no time said, so no fork)." },
  H70: one(add({ title: /invoice/i, due: "2026-10-31" })),
  H71: one(add({ title: /studio/i, due: "2026-10-23" })),
  H72: { ...one(add({ title: /invoice/i, size: 30 })), preview: [{ kind: "add", title: "Invoice", size: 20 }],
    flag: "A correction of the card on screen: the corrected card comes back, and replaces it." },
  H73: { ...one(add({ title: /call dana/i, due: "2026-10-23" })), preview: [{ kind: "add", title: "Call Dana", due: "2026-10-22" }],
    flag: "A correction of the card on screen: the corrected card comes back, and replaces it." },
  H74: one(add({ title: /לשלוח את החשבונית לדנה/, size: 15, due: "2026-10-21" })),
  H75: one(add({ title: has(/call the bank/i), not: /תזכיר/, due: "2026-10-22" })),
  H76: one(add({ title: /סוללות/, size: 10 }), add({ title: /חשמל/, size: 10 })),
  H77: one(add({ title: /demo notes/i, not: /\b(um|uh|like)\b/i, size: null, due: "2026-10-20" })),
  H78: none,
  H79: one({ kind: "later", taskId: "t2", until: "today" }),
  H80: one({ kind: "waiting", taskId: "t2", waitingOn: /yoni/i, checkOn: "2026-10-23" }),
};
