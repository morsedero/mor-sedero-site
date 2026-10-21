// Every screen tells the same truth (Mor, 2026-10-18): one day key, one day
// model, one needs count, overdue/progress/next as data, mixed-direction text,
// a clock that ticks on the minute, one reason line. Run:
//   node --test "daisey/test/v1/truth.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDayKey, localDate, dayAfter } from "../../app/js/model.js";
import { dayHours, usualHours, nightRange, headerDay, dayWord, msToNextMinute } from "../../app/js/day.js";
import { needsCount, nightLine, needsPhrase } from "../../app/js/needs-list.js";
import { daysOverdue, projectState, projectProgress, nextTaskOf, projectSummary, isStarted } from "../../app/js/project-state.js";
import { reasonLine, reasonPieces, dayWords } from "../../app/js/reason.js";
import { bdi, say, pieces } from "../../app/js/ui.js";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app");
const at = (d, h = 12, m = 0) => new Date(2026, 9, d, h, m).getTime(); // Oct 2026; the 18th is a Sunday

// ---------- 1. Day word and boundary ----------

test("1 getDayKey: 03:59 is still yesterday, 04:00 is today", () => {
  assert.equal(getDayKey(at(18, 3, 59)), "2026-10-17");
  assert.equal(getDayKey(at(18, 4, 0)), "2026-10-18");
});

test("1 getDayKey: 00:22 is tonight of the day that started yesterday at 04:00", () => {
  assert.equal(getDayKey(at(18, 0, 22)), "2026-10-17");
  assert.equal(dayAfter(1, at(18, 0, 22)), "2026-10-18"); // the morning you wake into is "tomorrow"
});

test("1 getDayKey: 23:59 is still today", () => {
  assert.equal(getDayKey(at(18, 23, 59)), "2026-10-18");
});

test("1 getDayKey: the date does NOT change at midnight, it changes at 04:00", () => {
  assert.equal(getDayKey(at(18, 23, 59)), getDayKey(at(19, 0, 0)));
  assert.equal(getDayKey(at(19, 0, 0)), "2026-10-18");
  assert.equal(getDayKey(at(19, 3, 59)), "2026-10-18");
  assert.equal(getDayKey(at(19, 4, 0)), "2026-10-19");
});

test("1 the header date never reads Tomorrow: header, Today page and Now card share one key", () => {
  for (const [h, m] of [[0, 22], [3, 0], [3, 59], [4, 0], [4, 1], [8, 0], [12, 0], [23, 59]]) {
    const now = at(19, h, m), shown = localDate(headerDay(now).getTime());
    assert.equal(shown, getDayKey(now), `${h}:${m} header date is the day key`);
    assert.equal(dayWord(shown, now), "today", `${h}:${m} the header's date is "today", never "tomorrow"`);
  }
  // At 00:22 the CALENDAR's date is the one that is "tomorrow", and the header no longer shows it.
  assert.equal(dayWord(localDate(at(19, 0, 22)), at(19, 0, 22)), "tomorrow");
  assert.notEqual(localDate(headerDay(at(19, 0, 22)).getTime()), localDate(at(19, 0, 22)));
});

// ---------- 2. One day model ----------

test("2 the day key is a fixed 04:00: 'My day' start 04:00, 05:00, 08:00 and 09:00 give the same key", () => {
  // hours are read for the same moment, to show the key never depends on them
  for (const [h, m, key] of [[1, 10, "2026-10-17"], [3, 59, "2026-10-17"], [4, 0, "2026-10-18"], [4, 1, "2026-10-18"], [8, 30, "2026-10-18"]]) {
    for (const dayStart of ["04:00", "05:00", "08:00", "09:00"]) {
      const now = at(18, h, m);
      assert.equal(dayHours({ dayStart, dayEnd: "22:30" }, now).start, { "04:00": 240, "05:00": 300, "08:00": 480, "09:00": 540 }[dayStart]);
      assert.equal(getDayKey(now), key, `${h}:${m} with My day ${dayStart}`);
    }
  }
});

test("2 My day = 09:00 at 08:30 is still the new day (the day key is not My day's start)", () => {
  const now = at(18, 8, 30);
  assert.equal(getDayKey(now), "2026-10-18");
  assert.equal(dayWord("2026-10-18", now), "today");
  assert.equal(dayWord("2026-10-19", now), "tomorrow");
  // …while the planning window and the Night pill do follow My day.
  const hrs = dayHours({ dayStart: "09:00", dayEnd: "22:30" }, now);
  assert.equal(hrs.start, 540);
  assert.deepEqual(nightRange(hrs), ["22:30", "09:00"]);
});

test("2 the Night pill is derived: starts at 'My day' end, ends at its start", () => {
  assert.deepEqual(nightRange(dayHours({ dayStart: "09:00", dayEnd: "22:30" })), ["22:30", "09:00"]);
  assert.deepEqual(nightRange(dayHours({})), ["22:00", "08:00"]);
  assert.deepEqual(nightRange(dayHours({ dayStart: "07:30", dayEnd: "23:15" })), ["23:15", "07:30"]);
});

test("2 existing saved settings keep the user's values: no rewrite, same hours", () => {
  const saved = { dayStart: "09:00", dayEnd: "22:30" };
  const copy = JSON.stringify(saved);
  const u = usualHours(saved);
  assert.deepEqual({ start: u.start, end: u.end }, { start: 540, end: 1350 });
  assert.equal(JSON.stringify(saved), copy);
  assert.equal(getDayKey(at(18, 8, 30)), "2026-10-18"); // and saving them never moved the key
});

// ---------- 3. "Needs you" count ----------

const waiting = (id) => ({ id, title: id, project: "P", status: "waiting", checkOn: "2020-01-01", size: 15, touchedAt: 1, createdAt: 1 });
const NOW = at(18, 20);
const ctx = (tasks) => ({ tasks, events: [], calOk: false, settings: {}, now: NOW });

test("3 needsCount: 0, 1 and N, one selector for chip and night line", () => {
  assert.equal(needsCount(ctx([])), 0);
  assert.equal(needsCount(ctx([waiting("a")])), 1);
  assert.equal(needsCount(ctx([waiting("a"), waiting("b"), waiting("c")])), 3);
  // The asks only the open page sees add to the same count.
  assert.equal(needsCount(ctx([waiting("a")]), { where: true, plan: true, meal: true }), 4);
});

test("3 the night line says 'nothing needs you' only when the count is 0", () => {
  assert.match(nightLine({ needs: 0 }), /^Nothing needs you tonight/);
  for (const n of [1, 2, 7]) {
    const line = nightLine({ needs: n });
    assert.doesNotMatch(line, /Nothing needs you/, `count ${n}`);
    assert.ok(line.startsWith(needsPhrase(n)), line);
  }
  assert.equal(needsPhrase(1), "1 thing needs you");
  assert.equal(needsPhrase(3), "3 things need you");
  assert.doesNotMatch(nightLine({ needs: 2, early: true }), /Nothing needs you/);
  assert.match(nightLine({ needs: 0, early: true }), /^Nothing needs you yet/);
  assert.equal(nightLine({ needs: 3, dueTonight: 2 }), "2 deadlines are still open today.");
  assert.equal(nightLine({ needs: 3, ask: true }), "One question about tomorrow.");
});

// ---------- 4. Overdue data ----------

test("4 daysOverdue: a deadline in the past counts days, counted from the day key", () => {
  const t = { status: "ready", dateKind: "deadline", due: "2026-10-14" };
  assert.equal(daysOverdue(t, at(18, 12)), 4);
  assert.equal(daysOverdue(t, at(14, 12)), 0); // due today
  assert.equal(daysOverdue(t, at(13, 12)), 0);
  assert.equal(daysOverdue({ ...t, due: "2026-10-17" }, at(18, 12)), 1);
  // 02:00 on the 18th is still the 17th: due the 17th is not overdue yet.
  assert.equal(daysOverdue({ ...t, due: "2026-10-17" }, at(18, 2)), 0);
});

test("4 daysOverdue: done, dropped, on hold and undated tasks are never overdue", () => {
  const past = "2026-10-01";
  assert.equal(daysOverdue({ status: "done", due: past }, NOW), 0);
  assert.equal(daysOverdue({ status: "dropped", due: past }, NOW), 0);
  assert.equal(daysOverdue({ status: "someday", due: past }, NOW), 0);
  assert.equal(daysOverdue({ status: "ready" }, NOW), 0);
  assert.equal(daysOverdue({ status: "waiting", due: past }, NOW), 17);
  assert.equal(daysOverdue({ status: "ready", dateKind: "target", due: past }, NOW), 17); // targets too
});

const proj = (tasks) => {
  const open = tasks.filter((t) => t.status !== "done");
  return { name: "Web", all: tasks, open, next: open.filter((t) => t.status === "ready"), pending: [], someday: [], done: tasks.filter((t) => t.status === "done") };
};
const rt = (o = {}) => ({ id: "x", title: "T", project: "Web", status: "ready", size: 30, progress: 0, ...o });

test("4 a project with a past due date reports overdue, not just 'due Wed'", () => {
  const p = proj([rt()]);
  const s = projectSummary(p, { due: "2026-10-14" }, at(18, 12));
  assert.equal(s.overdue, true);
  assert.equal(s.daysOverdue, 4);
  assert.equal(projectSummary(p, { due: "2026-10-20" }, at(18, 12)).overdue, false);
  assert.equal(projectSummary(p, null, at(18, 12)).daysOverdue, 0);
  // A finished project isn't overdue whatever its date says.
  assert.equal(projectSummary(proj([rt({ status: "done" })]), { due: "2026-10-01" }, NOW).overdue, false);
});

// ---------- 5. Progress and next ----------

test("5 0% and nothing started → state 'not started'", () => {
  assert.equal(projectState(proj([rt(), rt({ id: "y" })])), "not started");
  assert.equal(projectProgress(proj([rt()])), 0);
});

test("5 an ended routine counts its sessions (1 of 3 = 33%), not 100%", () => {
  const routine = { per: 3, until: "2026-10-21", log: [{ day: "2026-10-21" }] };
  assert.equal(Math.round(projectProgress(proj([rt({ routine, status: "done", progress: 100 })])) * 100), 33);
  assert.equal(projectProgress(proj([rt({ routine, status: "ready" })])), 0);
});

test("5 any started task makes it 'in progress'; all done → 'done'; no tasks → 'empty'", () => {
  assert.equal(projectState(proj([rt({ progress: 40 })])), "in progress");
  assert.equal(projectState(proj([rt({ starts: 1 })])), "in progress");
  assert.equal(projectState(proj([rt({ status: "done" }), rt({ id: "y" })])), "in progress");
  assert.equal(projectState(proj([rt({ status: "done" })])), "done");
  assert.equal(projectState(proj([])), "empty");
  assert.ok(isStarted(rt({ workedAt: 5 })) && !isStarted(rt()));
});

test("5 no next task → nextTask is null (so the UI can say 'pick one')", () => {
  assert.equal(nextTaskOf(proj([])), null);
  const hold = rt({ status: "waiting" });
  assert.equal(nextTaskOf(proj([hold])), null);
  assert.equal(projectSummary(proj([hold]), null, NOW).nextTask, null);
  // A task that can't start yet isn't next either.
  assert.equal(nextTaskOf(proj([rt({ notBefore: "2026-12-01" })]), NOW), null);
  const a = rt({ id: "a" });
  assert.equal(nextTaskOf(proj([a, rt({ id: "b" })]), NOW).id, "a");
});

// ---------- 6. Text direction ----------

const stubDom = () => {
  const el = (tag) => ({ tag, children: [], append(...k) { this.children.push(...k); } });
  globalThis.document = { createElement: el, createTextNode: (text) => ({ text }) };
};

test("6 bdi: mixed Hebrew and English stays whole, in its own dir=auto isolate", () => {
  stubDom();
  for (const s of ["לקנות milk ואז לחזור", "Call אמא at 5", "חתונה Planning (2026)", "פגישה — Reprise mix v2"]) {
    const b = bdi(s);
    assert.equal(b.tag, "bdi");
    assert.equal(b.dir, "auto");
    assert.equal(b.textContent, s, "never truncated or reordered by the code");
  }
});

test("6 say / pieces: every user-typed name gets its own dir=auto isolate", () => {
  stubDom();
  const out = say(["keeps ", { name: "חתונה Planning" }, " going, ", { name: "Reprise" }]);
  assert.deepEqual(out.map((n) => n.tag || "text"), ["text", "bdi", "text", "bdi"]);
  assert.ok(out.filter((n) => n.tag).every((n) => n.dir === "auto"));
  const row = pieces("חתונה · Website", "5 min");
  assert.deepEqual(row.map((n) => n.tag || "text"), ["bdi", "text", "bdi"]);
  assert.ok(row.filter((n) => n.tag).every((n) => n.dir === "auto"));
});

test("6 every free-text input and textarea in the app is dir=auto", () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(APP, "js")).filter((f) => f.endsWith(".js"))) {
    fs.readFileSync(path.join(APP, "js", f), "utf8").split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(/h\("(input|textarea)",\s*\{([^}]*)\}/g)) {
        const props = m[2], typed = /\btype:\s*"(?!text)/.test(props);
        if (!typed && !/\bdir:\s*"auto"/.test(props)) bad.push(`${f}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(bad, []);
  const html = fs.readFileSync(path.join(APP, "index.html"), "utf8");
  assert.match(html, /<input id="tellInput" dir="auto"/);
});

test("6 user-text nodes set from a title or project name carry dir=auto or a bdi", () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(APP, "js")).filter((f) => f.endsWith(".js"))) {
    fs.readFileSync(path.join(APP, "js", f), "utf8").split(/\r?\n/).forEach((line, i) => {
      // sc-name is the Today page's own day name; missTitle is the app's own "Missed" heading.
      if (/textContent:\s*(?:[a-zA-Z.\[\]?]*\.)?(title|project|name)\s*[,}]/.test(line) && !/dir:\s*"auto"|bdi\(|"sc-name"|"missTitle"/.test(line)) {
        bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

// ---------- 7. Clock ----------

test("7 the clock waits for the next minute, never a second", () => {
  const t0 = at(18, 12, 0) + 5000; // 5 s into the minute
  const wait = msToNextMinute(t0);
  assert.ok(wait > 50000 && wait <= 60020, `waits ~55 s, got ${wait}`);
  assert.ok(msToNextMinute(at(18, 12, 0)) > 59000); // right on the minute → a full minute
  assert.equal(new Date(t0 + msToNextMinute(t0)).getSeconds(), 0);
});

// Every setInterval delay in app/js, read from the source.
function intervals(){
  const found = [];
  for (const f of fs.readdirSync(path.join(APP, "js")).filter((f) => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(APP, "js", f), "utf8");
    for (let at = src.indexOf("setInterval("); at >= 0; at = src.indexOf("setInterval(", at + 1)) {
      let depth = 0, i = at + "setInterval".length;
      const start = i;
      for (; i < src.length; i++) { if (src[i] === "(") depth++; else if (src[i] === ")" && --depth === 0) break; }
      const m = /,\s*([\w*+ ]+)\s*\)$/.exec(src.slice(start, i + 1));
      let expr = m?.[1].trim();
      if (expr && /^[A-Z_]+$/.test(expr)) expr = new RegExp(`const ${expr}\\s*=\\s*([\\d*+ ]+);`).exec(src)?.[1]; // a named constant
      found.push({ file: f, ms: expr ? Function(`return ${expr}`)() : NaN });
    }
  }
  return found;
}

test("7 no timer fires every second: no setInterval in the app is under 2 s", () => {
  const all = intervals();
  assert.ok(all.length >= 5, "found the intervals");
  assert.deepEqual(all.filter((x) => !Number.isFinite(x.ms)), [], "every delay is a readable number");
  assert.deepEqual(all.filter((x) => x.ms < 2000), []);
});

test("7 the header clock shows no seconds and repaints from the minute timer", () => {
  const main = fs.readFileSync(path.join(APP, "js", "main.js"), "utf8");
  assert.doesNotMatch(main, /getSeconds\(\)/);
  assert.match(main, /msToNextMinute\(Date\.now\(\)\)/);
});

// ---------- 8. Reason strings ----------

const NOW8 = at(18, 12); // Sunday the 18th
const task8 = (o = {}) => ({ id: "t", title: "T", project: "Website", status: "ready", dateKind: "deadline", progress: 0, ...o });

test("8 overdue: 'Overdue since Wed.'", () => {
  assert.equal(reasonLine(task8({ due: "2026-10-14" }), { now: NOW8 }).text, "Overdue since Wed.");
  assert.equal(reasonLine(task8({ due: "2026-10-01" }), { now: NOW8 }).text, "Overdue since Oct 1.");
  assert.equal(reasonLine(task8({ due: "2026-10-17" }), { now: NOW8 }).text, "Overdue since yesterday.");
});

test("8 due today, tomorrow, this week; far dates say nothing", () => {
  assert.equal(reasonLine(task8({ due: "2026-10-18" }), { now: NOW8 }).text, "Due today.");
  assert.equal(reasonLine(task8({ due: "2026-10-19" }), { now: NOW8 }).text, "Due tomorrow.");
  assert.equal(reasonLine(task8({ due: "2026-10-22" }), { now: NOW8 }).text, "Due Thu.");
  assert.equal(reasonLine(task8({ due: "2026-12-01" }), { now: NOW8 }).text, "");
});

test("8 target dates are not deadlines: 'Target was Wed.' / 'Target today.'", () => {
  assert.equal(reasonLine(task8({ dateKind: "target", due: "2026-10-14" }), { now: NOW8 }).text, "Target was Wed.");
  assert.equal(reasonLine(task8({ dateKind: "target", due: "2026-10-18" }), { now: NOW8 }).text, "Target today.");
});

test("8 planned: 'Planned for today.' / tomorrow", () => {
  assert.equal(reasonLine(task8(), { now: NOW8, planned: "2026-10-18" }).text, "Planned for today.");
  assert.equal(reasonLine(task8(), { now: NOW8, planned: "2026-10-19" }).text, "Planned for tomorrow.");
});

test("8 project in Focus names the project once", () => {
  const r = reasonLine(task8(), { now: NOW8, focus: true });
  assert.equal(r.text, "Website is in Focus.");
  assert.deepEqual(r.pieces[0][0], { name: "Website" });
  assert.equal(reasonLine(task8({ project: "Inbox" }), { now: NOW8, focus: true }).text, ""); // Inbox isn't a project
});

test("8 reasons combine, strongest first, two at most", () => {
  const r = reasonLine(task8({ due: "2026-10-14" }), { now: NOW8, planned: "2026-10-18", focus: true });
  assert.equal(r.text, "Overdue since Wed. Planned for today.");
  assert.equal(r.lines.length, 2);
});

test("8 never repeats the project name twice", () => {
  const r = reasonLine(task8(), { now: NOW8, projectDue: "2026-10-14", focus: true });
  assert.equal(r.text, "Website was due Wed.");
  const names = r.pieces.flat().filter((x) => typeof x !== "string");
  assert.equal(names.length, 1);
  assert.equal((r.text.match(/Website/g) || []).length, 1);
  // Same name in a different case still counts as the same project.
  assert.equal((reasonLine(task8({ project: "WEBSITE" }), { now: NOW8, projectDue: "2026-10-20", focus: true }).text.match(/website/gi) || []).length, 1);
});

test("8 a started task says so; nothing to say gives an empty line, not a blank sentence", () => {
  assert.equal(reasonLine(task8({ dateKind: "target", progress: 40 }), { now: NOW8 }).text, "40% done.");
  assert.deepEqual(reasonLine(task8({ dateKind: "target" }), { now: NOW8 }), { text: "", lines: [], pieces: [] });
  assert.deepEqual(reasonPieces(null, { now: NOW8 }), []);
  assert.equal(dayWords("2026-10-18", NOW8), "today");
});
