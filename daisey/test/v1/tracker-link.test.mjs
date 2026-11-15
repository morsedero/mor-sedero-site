// PC tracker link + data (daisey-now-tracker.js, 2026-11-15).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const kv = new Map();
const blobs = require.resolve("../../functions/_daisey-lib/blobs.js");
require.cache[blobs] = { id: blobs, filename: blobs, loaded: true, exports: { openStore: () => ({
  get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null),
  setJSON: async (k, v) => { kv.set(k, JSON.stringify(v)); },
  delete: async (k) => { kv.delete(k); },
  list: async ({ prefix }) => ({ blobs: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
}) } };
const fb = require.resolve("../../functions/_daisey-lib/firebase-auth.js");
require.cache[fb] = { id: fb, filename: fb, loaded: true, exports: { verifyIdToken: async (t) => {
  const m = /^user:(.+)$/.exec(t); if (!m) throw new Error("bad"); return { user_id: m[1] };
} } };
const { handler } = require("../../functions/daisey-now-tracker.js");
const call = async (body, auth, method = "POST") => {
  const r = await handler({ httpMethod: method, headers: auth ? { authorization: "Bearer " + auth } : {}, body: JSON.stringify(body) });
  return { status: r.statusCode, ...JSON.parse(r.body) };
};
const day = (date, app = "Cubase.exe") => ({ date, dayStartMinute: 360, activeMinutes: 10, appMinutes: { [app]: 10 }, siteMinutes: {},
  detailMinutes: { [app]: { "My Song": 10 } }, timeline: [[60, 70, app, "My Song"]], hourlyMinutes: Array(24).fill(0),
  icons: { x: "ignored here" }, title: "a raw title must not be stored" });

async function link(device, uid) {
  const { req } = await call({ action: "start", device });
  assert.equal((await call({ action: "poll", req })).status, "pending");
  assert.equal((await call({ action: "info", req }, "user:" + uid)).device, device);
  assert.equal((await call({ action: "approve", req }, "user:" + uid)).ok, true);
  const p = await call({ action: "poll", req });
  assert.equal(p.status, "approved");
  assert.match(p.token, /^dtk_/);
  assert.equal((await call({ action: "poll", req })).status, "gone"); // handed over once
  return p.token;
}

test("link two PCs, upload, read back per PC", async () => {
  const a = await link("MOR-PC", "u1"), b = await link("LAPTOP", "u1");
  assert.equal((await call({ action: "upload", day: day("2026-11-15") }, a)).ok, true);
  await call({ action: "upload", day: day("2026-11-15", "Code.exe"), icons: { "Code.exe": "data:image/png;base64,AAAA" } }, b);
  const r = await call({ action: "read", dates: ["2026-11-15", "2026-11-14"] }, "user:u1");
  assert.equal(r.days["2026-11-15"].length, 2);
  assert.deepEqual(r.days["2026-11-15"].map((d) => d.device).sort(), ["LAPTOP", "MOR-PC"]);
  assert.equal(r.days["2026-11-15"][0].title, undefined); // only known fields kept
  assert.deepEqual(r.days["2026-11-14"], []);
  assert.equal(r.icons["Code.exe"], "data:image/png;base64,AAAA");
  assert.equal(r.devices.length, 2);
});

test("users never see each other's data", async () => {
  const t = await link("OTHER", "u2");
  await call({ action: "upload", day: day("2026-11-15", "Word.exe") }, t);
  const r = await call({ action: "read", dates: ["2026-11-15"] }, "user:u2");
  assert.equal(r.days["2026-11-15"].length, 1);
  assert.equal(r.days["2026-11-15"][0].device, "OTHER");
});

test("disconnect one PC drops its token and data; all drops everything", async () => {
  const before = await call({ action: "read", dates: ["2026-11-15"] }, "user:u1");
  const laptop = before.devices.find((d) => d.name === "LAPTOP");
  await call({ action: "disconnect", deviceId: laptop.id }, "user:u1");
  const r = await call({ action: "read", dates: ["2026-11-15"] }, "user:u1");
  assert.deepEqual(r.days["2026-11-15"].map((d) => d.device), ["MOR-PC"]);
  await call({ action: "disconnect" }, "user:u1");
  assert.equal([...kv.keys()].some((k) => k.startsWith("user:u1:")), false);
  assert.equal([...kv.keys()].some((k) => k.startsWith("user:u2:")), true);
});

test("refuses: bad device token, no sign-in, bad request, GET", async () => {
  assert.equal((await call({ action: "upload", day: day("2026-11-15") }, "dtk_nope")).status, 401);
  assert.equal((await call({ action: "read", dates: [] })).status, 401);
  assert.equal((await call({ action: "approve", req: "x".repeat(32) }, "user:u1")).status, 404);
  assert.equal((await call({ action: "poll", req: "bad req" })).status, 400);
  assert.equal((await call({}, null, "GET")).status, 405);
});
