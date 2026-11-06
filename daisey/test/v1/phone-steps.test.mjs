// "None of these" on a ride: what can be planned or arranged from the phone.
import test from "node:test";
import assert from "node:assert/strict";
import { findPhoneSteps, onComputer, phoneSteps, STEP_APP } from "../../app/js/phone.js";

const t = (id, title, extra = {}) => ({ id, title, project: "P", type: "deep", status: "ready", ...extra });

test("a computer is a wide screen with a real pointer; no screen at all (the server) isn't", () => {
  assert.equal(onComputer(), false);
  globalThis.matchMedia = (q) => ({ matches: /min-width: 1024px/.test(q) && /pointer: fine/.test(q) });
  assert.equal(onComputer(), true);
  globalThis.matchMedia = () => ({ matches: false });
  assert.equal(onComputer(), false);
  delete globalThis.matchMedia;
});

test("with no answer yet, a plain Plan stands in, in the title's language", () => {
  assert.deepEqual(phoneSteps([t("a", "BOBBA coding"), t("b", "קידוד BOBBA")]).map((s) => s.title),
    ["Plan: BOBBA coding", "לתכנן: קידוד BOBBA"]);
});

test("no step for a routine, a step itself, or a task that already got one", () => {
  const taken = t("c", "Book the room", { source: { app: STEP_APP, cardId: "a" }, status: "done" });
  const list = [t("a", "Mix"), t("r", "Gym", { routine: { perWeek: 3 } }), taken, t("d", "Edit")];
  assert.deepEqual(phoneSteps(list, list).map((s) => s.task.id), ["d"]);
});

test("the server's steps are used, once; a task it skips isn't offered", async () => {
  const list = [t("s1", "Render the mix"), t("s2", "Wash the car")];
  const calls = [];
  globalThis.fetch = async (url, o) => {
    calls.push(JSON.parse(o.body));
    return { ok: true, json: async () => ({ steps: [{ id: "s1", title: "List what the mix still needs" }] }) };
  };
  assert.equal(await findPhoneSteps(list, { guest: true }), true);
  assert.equal(calls[0].mode, "steps");
  assert.deepEqual(phoneSteps(list).map((s) => s.title), ["List what the mix still needs"]);
  assert.equal(await findPhoneSteps(list, { guest: true }), false);
  assert.equal(calls.length, 1);
});

test("a failed ask keeps the stand-in and waits before trying again", async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    let n = 0;
    globalThis.fetch = async () => { n++; return { ok: false, status: 502, json: async () => ({ error: "model" }) }; };
    const list = [t("f1", "Render the stems")];
    assert.equal(await findPhoneSteps(list, { guest: true }), true);
    assert.deepEqual(phoneSteps(list).map((s) => s.title), ["Plan: Render the stems"]);
    assert.equal(await findPhoneSteps(list, { guest: true }), false);
    assert.equal(n, 1);
  } finally { console.warn = warn; }
});
