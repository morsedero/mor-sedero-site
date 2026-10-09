// A repeating event changed for "this and following" or "all" (gcal-series.js):
// what reaches Google, against a fake Calendar API.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { changeSeries, rules } = require("../../functions/_daisey-lib/gcal-series.js");

const base = "https://cal/events";
const headers = { Authorization: "Bearer t" };
const TZ = "Asia/Jerusalem";
// Weekly on Tuesdays at 10:00 (07:00Z in October), from 2026-10-06.
const master = () => ({ id: "m", summary: "Standup", description: "notes", colorId: "3", etag: "x", htmlLink: "l",
  start: { dateTime: "2026-10-06T10:00:00+03:00", timeZone: TZ }, end: { dateTime: "2026-10-06T10:30:00+03:00", timeZone: TZ },
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=10"] });
const inst = (day) => ({ id: `m_${day}`, recurringEventId: "m", originalStartTime: { dateTime: `2026-10-${day}T10:00:00+03:00`, timeZone: TZ },
  start: { dateTime: `2026-10-${day}T10:00:00+03:00`, timeZone: TZ }, end: { dateTime: `2026-10-${day}T10:30:00+03:00`, timeZone: TZ } });

let calls;
function fake(byId){
  calls = [];
  globalThis.fetch = async (url, { method = "GET", body } = {}) => {
    calls.push({ method, url: String(url), body: body && JSON.parse(body) });
    const id = decodeURIComponent(String(url).slice(base.length + 1));
    if (method === "GET") return byId[id] ? { ok: true, status: 200, json: async () => byId[id] } : { ok: false, status: 404 };
    if (method === "POST") return { ok: true, status: 200, json: async () => ({ id: "new" }) };
    return { ok: true, status: method === "DELETE" ? 204 : 200, json: async () => ({}) };
  };
}
const writes = () => calls.filter((c) => c.method !== "GET");

test("all events: a rename patches the series itself", async () => {
  fake({ m_13: inst("13"), m: master() });
  await changeSeries({ base, headers, eventId: "m_13", scope: "all", title: "Sync" });
  assert.deepEqual(writes(), [{ method: "PATCH", url: `${base}/m`, body: { summary: "Sync" } }]);
});

test("all events: a move shifts the series by the same amount, weekday included", async () => {
  fake({ m_13: inst("13"), m: master() });
  // Tuesday 13th 10:00 -> Wednesday 14th 11:00, an hour long.
  await changeSeries({ base, headers, eventId: "m_13", scope: "all", start: "2026-10-14T11:00:00+03:00", end: "2026-10-14T12:00:00+03:00" });
  const [w] = writes();
  assert.equal(w.method, "PATCH");
  assert.equal(Date.parse(w.body.start.dateTime), Date.parse("2026-10-07T11:00:00+03:00"));
  assert.equal(Date.parse(w.body.end.dateTime), Date.parse("2026-10-07T12:00:00+03:00"));
  assert.equal(w.body.start.timeZone, TZ);
  assert.deepEqual(w.body.recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=10"]);
});

test("all events: delete removes the series", async () => {
  fake({ m_13: inst("13"), m: master() });
  await changeSeries({ base, headers, eventId: "m_13", scope: "all", remove: true });
  assert.deepEqual(writes().map((c) => [c.method, c.url]), [["DELETE", `${base}/m`]]);
});

test("following: a copy starts here with the change, then the series ends the second before", async () => {
  fake({ m_20: inst("20"), m: master() });
  const out = await changeSeries({ base, headers, eventId: "m_20", scope: "following", title: "Sync", start: "2026-10-20T09:00:00+03:00", end: "2026-10-20T09:30:00+03:00" });
  const [made, cut] = writes();
  assert.equal(made.method, "POST");
  assert.equal(made.body.summary, "Sync");
  assert.equal(made.body.description, "notes");
  assert.equal(made.body.colorId, "3");
  assert.equal(made.body.etag, undefined);
  assert.equal(made.body.id, undefined);
  assert.equal(Date.parse(made.body.start.dateTime), Date.parse("2026-10-20T09:00:00+03:00"));
  assert.deepEqual(made.body.recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
  assert.deepEqual(cut, { method: "PATCH", url: `${base}/m`, body: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261020T065959Z"] } });
  assert.equal(out.id, "new");
});

test("following: delete only ends the series", async () => {
  fake({ m_20: inst("20"), m: master() });
  await changeSeries({ base, headers, eventId: "m_20", scope: "following", remove: true });
  assert.deepEqual(writes(), [{ method: "PATCH", url: `${base}/m`, body: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261020T065959Z"] } }]);
});

test("following on the first day is all events", async () => {
  fake({ m_06: inst("06"), m: master() });
  await changeSeries({ base, headers, eventId: "m_06", scope: "following", remove: true });
  assert.deepEqual(writes().map((c) => [c.method, c.url]), [["DELETE", `${base}/m`]]);
});

test("a refused copy leaves the series alone", async () => {
  fake({ m_20: inst("20"), m: master() });
  const real = globalThis.fetch;
  globalThis.fetch = async (url, o = {}) => (o.method === "POST" ? (calls.push({ method: "POST" }), { ok: false, status: 403 }) : real(url, o));
  const out = await changeSeries({ base, headers, eventId: "m_20", scope: "following", title: "Sync" });
  assert.equal(out.res.status, 403);
  assert.deepEqual(writes().map((c) => c.method), ["POST"]);
});

test("an event that doesn't repeat is left to the plain write", async () => {
  fake({ solo: { id: "solo", start: { dateTime: "2026-10-20T10:00:00+03:00" } } });
  assert.equal(await changeSeries({ base, headers, eventId: "solo", scope: "all", title: "x" }), null);
  assert.deepEqual(writes(), []);
});

test("rules keep other lines and only shift weekly days", () => {
  assert.deepEqual(rules(["EXDATE:20261013T070000Z", "RRULE:FREQ=WEEKLY;BYDAY=SA,MO"], { shift: 1 }),
    ["EXDATE:20261013T070000Z", "RRULE:FREQ=WEEKLY;BYDAY=SU,TU"]);
  assert.deepEqual(rules(["RRULE:FREQ=MONTHLY;BYDAY=2TU"], { shift: 1 }), ["RRULE:FREQ=MONTHLY;BYDAY=2TU"]);
});
