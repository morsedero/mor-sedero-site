// Tell Daisey's request: the Now card and the last tasks go with the message,
// so "done" and "no, make it 30" have a task to point at (phrase bank
// 2026-10-19). Run: node --test "daisey/test/v1/*.test.mjs"
process.env.TZ = "Asia/Jerusalem";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { requestBody } from "../../app/js/tell-read.js";
const { tidy } = createRequire(import.meta.url)("../../functions/daisey-now-chat.js");

const tasks = [
  { id: "a", title: "Old", status: "ready", createdAt: 1 },
  { id: "b", title: "Edited", status: "ready", createdAt: 2, editedAt: 50 },
  { id: "c", title: "New", status: "ready", createdAt: 40 },
  { id: "d", title: "Finished", status: "done", createdAt: 99 },
  { id: "e", title: "No stamp", status: "ready" },
];

test("recent: open tasks, newest add or edit first, at most 3", () => {
  assert.deepEqual(requestBody("x", tasks).recent, ["b", "c", "a"]);
});

test("now: only an open task on the card is sent", () => {
  assert.equal(requestBody("x", tasks, { now: "c" }).now, "c");
  assert.equal(requestBody("x", tasks, { now: "d" }).now, undefined);
  assert.equal(requestBody("x", tasks).now, undefined);
});

test("waiting keeps a check-in day, drops one that isn't a date", () => {
  const ids = new Set(["a"]);
  assert.equal(tidy({ actions: [{ kind: "waiting", taskId: "a", waitingFor: "Dana", checkOn: "2026-10-22" }] }, ids).actions[0].checkOn, "2026-10-22");
  assert.equal(tidy({ actions: [{ kind: "waiting", taskId: "a", waitingFor: "Dana", checkOn: "Thursday" }] }, ids).actions[0].checkOn, undefined);
});
