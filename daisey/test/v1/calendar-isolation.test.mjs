// One person's calendar list must never be served to another (now-calendar.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const blobs = require.resolve("../../functions/_daisey-lib/blobs.js");
require.cache[blobs] = { id: blobs, filename: blobs, loaded: true, exports: { openStore: () => ({}) } };
const { calendarsFor } = require("../../functions/_daisey-lib/now-calendar.js");

const lists = { mor: "mor@gmail.com", ester: "ester@gmail.com" };
let calls = 0;
globalThis.fetch = async (url, { headers }) => {
  calls++;
  const who = headers.Authorization.replace("Bearer ", "");
  const u = String(url);
  return { ok: true, json: async () => (u.includes("calendarList") ? { items: [{ id: lists[who], selected: true, accessRole: "owner" }] } : { event: {} }) };
};

test("two people get their own calendars, even back to back", async () => {
  const a = await calendarsFor("mor");
  const b = await calendarsFor("ester");
  assert.deepEqual(a.calendars.map((c) => c.id), ["mor@gmail.com"]);
  assert.deepEqual(b.calendars.map((c) => c.id), ["ester@gmail.com"]);
});

test("the same person is served from the cache, and fresh bypasses it", async () => {
  await calendarsFor("mor");
  const before = calls;
  await calendarsFor("mor");
  assert.equal(calls, before); // cached
  await calendarsFor("mor", true);
  assert.equal(calls > before, true);
});
