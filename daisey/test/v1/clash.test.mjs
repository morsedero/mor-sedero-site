// A booked slot another event ran into (clash.js, 2026-10-06).
import test from "node:test";
import assert from "node:assert/strict";
process.env.TZ = "Asia/Jerusalem";
const { slotClashes } = await import("../../app/js/clash.js");
const { collectNeeds } = await import("../../app/js/needs-list.js");

const at = (h, m = 0) => Date.UTC(2026, 9, 6, h - 3, m);
const il = (h, m = 0) => new Date(at(h, m)).toISOString();
const task = (o) => ({ id: "mix", title: "Mix review", status: "ready", due: "2026-10-07", dateKind: "deadline", size: 60, ...o });
const slot = { id: "s", title: "Mix review", start: il(15), end: il(16), busy: true, editable: true, taskId: "mix" };
const meet = { id: "m", title: "Dentist", start: il(14), end: il(15, 40), busy: true };
const NOW = at(13);

test("a meeting running into a deadline task's slot: ask, with a move ready", () => {
  const [c] = slotClashes([task({})], [slot, meet], NOW);
  assert.equal(c.over.title, "Dentist");
  assert.deepEqual([c.move.start, c.move.end], [at(15, 40), at(16, 40)]); // 13:10–14:00 is too short; the first gap that fits is after the dentist
  assert.equal(collectNeeds({ tasks: [task({})], events: [slot, meet], calOk: true, now: NOW }).filter((n) => n.kind === "clash").length, 1);
});

test("no question when it's only a target, a small overlap, no room, or not yours to move", () => {
  assert.equal(slotClashes([task({ dateKind: "target" })], [slot, meet], NOW).length, 0); // a prediction: adapt silently
  assert.equal(slotClashes([task({})], [slot, { ...meet, end: il(15, 5) }], NOW).length, 0); // 5 min
  assert.equal(slotClashes([task({})], [slot, { ...meet, start: il(13, 5), end: il(22) }], NOW).length, 0); // nowhere to move it today
  assert.equal(slotClashes([task({})], [{ ...slot, editable: false }, meet], NOW).length, 0);
  assert.equal(slotClashes([task({})], [slot], NOW).length, 0); // nothing in the way
});
