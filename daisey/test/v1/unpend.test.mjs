// A pending task has a way back to active from its Edit panel (Mor, 2026-10-18).
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../../app/js/model.js";

const NOW = new Date(2026, 9, 18, 10).getTime();
const pending = (o = {}) => {
  const t = M.createTask({ title: "email Dana", size: 20 }, { now: NOW });
  return { ...t, ...M.editTask(t, { status: "waiting", waitingOn: "Dana", ...o }, { now: NOW + 1 }) };
};
const apply = (t, c) => ({ ...t, ...M.editTask(t, c, { now: NOW + 2 }) });

test("un-pend: 'Back to active' is the plain status:ready change - active, waiting-on and check-in cleared", () => {
  const p = pending();
  assert.equal(p.status, "waiting"); assert.equal(p.waitingOn, "Dana"); assert.ok(p.checkOn);
  const back = apply(p, { status: "ready" });
  assert.equal(back.status, "ready"); assert.equal(back.waitingOn, null); assert.equal(back.checkOn, null);
});

test("un-pend: clearing Waiting on makes it active too", () => {
  const back = apply(pending(), { waitingOn: "" });
  assert.equal(back.status, "ready"); assert.equal(back.waitingOn, null); assert.equal(back.checkOn, null);
  assert.equal(apply(pending(), { waitingOn: "   " }).status, "ready");
});

test("un-pend: changing who it waits on keeps it pending; a pending task with no 'waiting on' isn't flipped by an unrelated edit", () => {
  const p = pending();
  assert.equal(apply(p, { waitingOn: "Yuval" }).status, "waiting");
  assert.equal(apply(p, { waitingOn: "Yuval" }).waitingOn, "Yuval");
  const blocked = { ...p, waitingOn: null }; // pended by "blocked", no name
  assert.equal(apply(blocked, { size: 30 }).status, "waiting");
  assert.equal(apply(blocked, { waitingOn: "" }).status, "waiting", "nothing was cleared");
});

test("un-pend: an active task given a waiting-on still goes pending (unchanged)", () => {
  const t = M.createTask({ title: "x", size: 20 }, { now: NOW });
  assert.equal({ ...t, ...M.editTask(t, { waitingOn: "Dana" }, { now: NOW + 1 }) }.status, "waiting");
});
