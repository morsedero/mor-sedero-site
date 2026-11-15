// Needs you: an answer on a passed date doesn't bring the same task back
// (Mor, 2026-10-19: Pending "did nothing", the card came straight back).
import test from "node:test";
import assert from "node:assert/strict";
const { collectNeeds } = await import("../../app/js/needs-list.js");

const NOW = new Date("2026-10-19T10:00").getTime();
const base = { id: "t1", title: "Pay invoice", size: 15, due: "2026-10-13", dateKind: "deadline", createdAt: NOW - 20 * 864e5 };
const ids = (tasks) => collectNeeds({ tasks, now: NOW, settings: { somedayAsked: null } }).filter((n) => n.id === "t1").map((n) => n.kind);

test("a passed deadline is swept while open", () => {
  assert.deepEqual(ids([{ ...base, status: "ready", touchedAt: NOW - 3 * 864e5 }]), ["sweep"]);
});
test("Pending: a waiting task isn't swept, only asked on its checkOn", () => {
  assert.deepEqual(ids([{ ...base, status: "waiting", checkOn: "2026-10-20", touchedAt: NOW }]), []);
  assert.deepEqual(ids([{ ...base, status: "waiting", checkOn: "2026-10-19", touchedAt: NOW - 864e5 }]), ["pending"]);
});
test("Pending with today's check date: later today, not straight away", () => {
  const pend = (ago) => ids([{ ...base, status: "waiting", checkOn: "2026-10-19", touchedAt: NOW - ago }]);
  assert.deepEqual(pend(0), []);
  assert.deepEqual(pend(2 * 3600000), []);
  assert.deepEqual(pend(3 * 3600000), ["pending"]);
});
test("On hold today: not asked to bring it back the same day", () => {
  assert.deepEqual(ids([{ ...base, status: "someday", touchedAt: NOW }]), []);
  assert.ok(ids([{ ...base, status: "someday", touchedAt: NOW - 2 * 864e5 }]).length > 0);
});

// An answer buys quiet (Mor, 2026-11-15: answering brought more questions).
test("Answered lately: no follow-on asks about the same task", () => {
  const asked = NOW - 864e5;
  const ready = { ...base, due: "2026-10-25", status: "ready", touchedAt: asked };
  assert.deepEqual(ids([{ ...ready, pushes: 2 }]), ["pushed"]);
  assert.deepEqual(ids([{ ...ready, pushes: 2, askedAt: asked }]), []);
  assert.deepEqual(ids([{ ...ready, skipsSinceStart: 5, askedAt: asked }]), []);
  const held = { ...base, due: "2026-10-21", status: "someday", touchedAt: asked };
  assert.deepEqual(ids([held]), ["parked"]);
  assert.deepEqual(ids([{ ...held, askedAt: asked }]), []);
});
test("Quiet ends after a week; a passed deadline still asks", () => {
  const ready = { ...base, due: "2026-10-25", status: "ready", pushes: 2, touchedAt: NOW };
  assert.deepEqual(ids([{ ...ready, askedAt: NOW - 8 * 864e5 }]), ["pushed"]);
  assert.deepEqual(ids([{ ...base, status: "ready", touchedAt: NOW, askedAt: NOW }]), ["sweep"]);
  assert.deepEqual(ids([{ ...base, status: "someday", touchedAt: NOW - 864e5, askedAt: NOW - 864e5 }]), ["parked"]);
});
