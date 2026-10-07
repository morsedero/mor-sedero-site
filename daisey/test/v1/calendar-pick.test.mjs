// Choosing which calendars Daisey reads (now-calendar.js + daisey-now-calendar.js, 2026-10-07).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const mem = { "daisey-users": new Map([["google-sub:g1", "u1"]]), "daisey-prefs": new Map(), "daisey-tokens": new Map([["user:u1:google", { access_token: "tok", expiry: Date.now() + 3e6 }]]) };
const blobs = require.resolve("../../functions/_daisey-lib/blobs.js");
require.cache[blobs] = { id: blobs, filename: blobs, loaded: true, exports: { openStore: (n) => ({
  get: async (k) => mem[n].get(k) ?? null, set: async (k, v) => { mem[n].set(k, v); },
  setJSON: async (k, v) => { mem[n].set(k, v); }, delete: async (k) => { mem[n].delete(k); } }) } };
const fba = require.resolve("../../functions/_daisey-lib/firebase-auth.js");
require.cache[fba] = { id: fba, filename: fba, loaded: true, exports: { verifyIdToken: async (t) => {
  if (t !== "good") throw new Error("bad");
  return { firebase: { identities: { "google.com": ["g1"] } } };
} } };
// Google: three calendars, one unticked by the user in Google Calendar.
const LIST = [
  { id: "me@x.com", summary: "Me", primary: true, selected: true, accessRole: "owner", backgroundColor: "#111" },
  { id: "work", summary: "Work", selected: true, accessRole: "owner", backgroundColor: "#222" },
  { id: "family", summary: "Family", selected: false, accessRole: "reader", backgroundColor: "#333" },
];
const asked = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("calendarList")) return { ok: true, json: async () => ({ items: LIST }) };
  if (u.includes("/colors")) return { ok: true, json: async () => ({}) };
  const id = decodeURIComponent(u.split("/calendars/")[1].split("/events")[0]);
  asked.push(id);
  return { ok: true, status: 200, json: async () => ({ items: [{ id: `e-${id}`, summary: `Event on ${id}`, start: { dateTime: "2026-10-07T10:00:00Z" }, end: { dateTime: "2026-10-07T11:00:00Z" } }] }) };
};
const { handler } = require("../../functions/daisey-now-calendar.js");
const range = { from: "2026-10-07T00:00:00Z", to: "2026-10-08T00:00:00Z" };
const get = (q = {}) => handler({ httpMethod: "GET", headers: { authorization: "Bearer good" }, queryStringParameters: { ...range, ...q } });
const post = (body) => handler({ httpMethod: "POST", headers: { authorization: "Bearer good" }, queryStringParameters: {}, body: JSON.stringify(body) });
const titles = async () => JSON.parse((await get({ fresh: "1" })).body).events.map((e) => e.title).sort();

test("never picked: Google's own ticks decide", async () => {
  assert.deepEqual(await titles(), ["Event on me@x.com", "Event on work"]);
});

test("the list says every calendar and which are in use", async () => {
  const body = JSON.parse((await get({ list: "1" })).body);
  assert.deepEqual(body.calendars.map((c) => [c.id, c.selected]), [["me@x.com", true], ["work", true], ["family", false]]);
  assert.equal(body.chosen, null);
});

test("a pick is saved, and only those calendars are read", async () => {
  const res = await post({ ids: ["family", "work"] });
  assert.deepEqual(JSON.parse(res.body).ids, ["family", "work"]);
  asked.length = 0;
  assert.deepEqual(await titles(), ["Event on family", "Event on work"]);
  assert.deepEqual(JSON.parse((await get({ list: "1" })).body).chosen, ["family", "work"]);
});

test("an id that isn't one of the user's calendars is dropped; junk is refused", async () => {
  const res = await post({ ids: ["work", "someone-elses@x.com", 5] });
  assert.deepEqual(JSON.parse(res.body).ids, ["work"]);
  assert.equal((await post({ ids: "work" })).statusCode, 400);
  assert.equal((await post({ ids: ["work"] }).then(() => handler({ httpMethod: "POST", headers: {}, body: "{}" }))).statusCode, 401);
});

test("picking none reads none; null goes back to Google's ticks", async () => {
  await post({ ids: [] });
  assert.deepEqual(await titles(), []);
  await post({ ids: null });
  assert.deepEqual(await titles(), ["Event on me@x.com", "Event on work"]);
});
