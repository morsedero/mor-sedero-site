// Tell Daisey's server side: what the model returns is only a suggestion, so
// tidy() keeps the actions the app can actually apply and drops the rest.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { tidy, handler } = createRequire(import.meta.url)("../../functions/daisey-now-chat.js");
const ids = new Set(["t1", "t2"]);

test("keeps adds, and changes only to tasks that exist", () => {
  const out = tidy({ reply: "ok", actions: [
    { kind: "add", title: "Call Uri", size: 15, due: "2026-10-08", dateKind: "deadline" },
    { kind: "update", taskId: "t1", notBefore: "2026-10-11" },
    { kind: "drop", taskId: "nope" }, // made up: gone
    { kind: "explode", taskId: "t2" }, // unknown kind: gone
  ] }, ids);
  assert.deepEqual(out.actions, [
    { kind: "add", title: "Call Uri", size: 15, due: "2026-10-08", dateKind: "deadline" },
    { kind: "update", taskId: "t1", notBefore: "2026-10-11" },
  ]);
});

test("drops nonsense values rather than the whole action", () => {
  const [a] = tidy({ reply: "", actions: [{ kind: "add", title: "  Lesson   prep ", size: -5, due: "Thursday", dateKind: "soon" }] }, ids).actions;
  assert.deepEqual(a, { kind: "add", title: "Lesson prep" });
});

test("an add needs a title, a moment needs energy or place", () => {
  const out = tidy({ reply: "", actions: [{ kind: "add", title: " " }, { kind: "moment" }, { kind: "moment", energy: "low", place: "moon" }] }, ids);
  assert.deepEqual(out.actions, [{ kind: "moment", energy: "low" }]);
});

test("a question only comes with buttons to answer it", () => {
  assert.equal(tidy({ reply: "", actions: [], question: "Which one?" }, ids).question, undefined);
  assert.deepEqual(tidy({ reply: "", actions: [], question: "Which one?", choices: ["Mix A", "Mix B"] }, ids).choices, ["Mix A", "Mix B"]);
});

test("done, event and query (2026-10-06)", () => {
  const r = tidy({ reply: "x", actions: [
    { kind: "done", taskId: "t1" }, { kind: "done", taskId: "nope" },
    { kind: "event", title: "Dentist", eventDate: "2026-10-08", time: "15:00" },
    { kind: "event", title: "Bad time", eventDate: "2026-10-08", time: "25:00" },
    { kind: "event", title: "Long", eventDate: "2026-10-08", time: "09:30", minutes: 90 },
    { kind: "query", query: "due", range: "week" }, { kind: "query", query: "next" }, { kind: "query", query: "weather" },
  ] }, ids);
  assert.deepEqual(r.actions, [
    { kind: "done", taskId: "t1" },
    { kind: "event", title: "Dentist", date: "2026-10-08", time: "15:00", minutes: 60 },
    { kind: "event", title: "Long", date: "2026-10-08", time: "09:30", minutes: 90 },
    { kind: "query", query: "due", range: "week" }, { kind: "query", query: "next" },
  ]);
});

test("a moment can say how long you have free: 5 min to 4 h, nothing else", () => {
  const out = tidy({ reply: "", actions: [{ kind: "moment", minutes: 30 }, { kind: "moment", minutes: 2 }, { kind: "moment", minutes: 999 }, { kind: "moment", energy: "low", minutes: 45 }] }, ids);
  assert.deepEqual(out.actions, [{ kind: "moment", minutes: 30 }, { kind: "moment", energy: "low", minutes: 45 }]);
});

test("a plan question keeps its part, defaulting to the whole day", () => {
  const out = tidy({ reply: "", actions: [{ kind: "query", query: "plan", part: "afternoon" }, { kind: "query", query: "plan", part: "lunch" }] }, ids);
  assert.deepEqual(out.actions, [{ kind: "query", query: "plan", part: "afternoon" }, { kind: "query", query: "plan", part: "day" }]);
});

test("a moment can move today's day end", () => {
  const out = tidy({ reply: "", actions: [{ kind: "moment", dayEnd: "23:00" }, { kind: "moment", dayEnd: "11pm" }] }, ids);
  assert.deepEqual(out.actions, [{ kind: "moment", dayEnd: "23:00" }]);
});

test("guest chat requires the explicit guest marker and Netlify client IP", async () => {
  const body = JSON.stringify({ guest: true, text: "Add a task", today: "2026-10-06" });
  const response = await handler({ httpMethod: "POST", headers: { "x-daisey-guest": "1" }, body });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "guest_limit_unavailable" });

  const noGuestFlag = await handler({ httpMethod: "POST", headers: {}, body });
  assert.equal(noGuestFlag.statusCode, 401);
  assert.deepEqual(JSON.parse(noGuestFlag.body), { error: "no_session" });
});
