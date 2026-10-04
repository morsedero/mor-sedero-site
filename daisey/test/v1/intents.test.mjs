// Daisey v1 weekly intents. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../../app/js/context.js";
import * as E from "../../app/js/engine.js";

const at = (d, h = 10) => new Date(2026, 9, d, h).getTime(); // Oct 2026; Sun 4, Wed 7
const NOW = at(7);
const done = (area, d) => ({ id: `${area}${d}`, title: "x", project: "P", area, status: "done", doneAt: at(d), touchedAt: at(d), starts: 1, size: 30, spentMinutes: 30 });

test("weekly progress: finished this week (from Sunday) against each goal, goals with 0 hidden", () => {
  const tasks = [done("job", 5), done("job", 6), done("job", 1) /* last week's Thu: not counted */, done("home", 4)];
  const p = C.weekProgress(tasks, { job: 3, home: 2, admin: 0 }, NOW);
  assert.deepEqual(p.map((x) => [x.area, x.done, x.intent]), [["job", 2, 3], ["home", 1, 2]]);
  assert.deepEqual(C.weekProgress(tasks, {}, NOW), []);
});

test("intents move the engine: the area behind its goal gets the points, the one on track doesn't", () => {
  const job = { id: "j", project: "A", title: "cv", size: 30, area: "job", status: "ready", createdAt: 1, touchedAt: NOW };
  const home = { id: "h", project: "B", title: "laundry", size: 30, area: "home", status: "ready", createdAt: 1, touchedAt: NOW };
  const pts = (intents, areaDone) => Object.fromEntries(E.rank([job, home], { now: NOW, intents, areaDone })
    .ranked.map((s) => [s.task.area, s.parts.area]));
  assert.deepEqual(pts({ job: 3, home: 2 }, { job: 0, home: 2 }), { job: 12, home: 0 }); // job 0 of 3, home 2 of 2
  assert.deepEqual(pts({ job: 3, home: 2 }, { job: 3, home: 0 }), { job: 0, home: 12 });
});
