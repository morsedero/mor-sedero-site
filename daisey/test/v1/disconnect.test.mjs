// Reset Daisey → disconnect (daisey-now-disconnect.js, 2026-10-07).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const kv = new Map([["user:u1:google", { a: 1 }], ["user:u1:trello", { t: 1 }], ["user:u2:google", { a: 2 }]]);
const users = new Map([["google-sub:g1", "u1"], ["google-sub:g2", "u2"]]);
const stores = { "daisey-users": users, "daisey-tokens": kv };
const blobs = require.resolve("../../functions/_daisey-lib/blobs.js");
require.cache[blobs] = { id: blobs, filename: blobs, loaded: true, exports: { openStore: (n) => ({
  get: async (k) => stores[n].get(k) ?? null, delete: async (k) => { stores[n].delete(k); } }) } };
const fb = require.resolve("../../functions/_daisey-lib/firebase-auth.js");
require.cache[fb] = { id: fb, filename: fb, loaded: true, exports: { verifyIdToken: async (t) => {
  const m = /^good:(.*)$/.exec(t); if (!m) throw new Error("bad");
  return { firebase: { identities: m[1] ? { "google.com": [m[1]] } : {} } };
} } };
const { handler } = require("../../functions/daisey-now-disconnect.js");
const call = (auth, body = {}, method = "POST") => handler({ httpMethod: method, headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });

test("drops this user's Google and Trello tokens, only theirs, and keeps the id link", async () => {
  const res = await call("Bearer good:g1");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).disconnected, ["google", "trello"]);
  assert.equal(kv.has("user:u1:google") || kv.has("user:u1:trello"), false);
  assert.equal(kv.has("user:u2:google"), true); // someone else's is untouched
  assert.equal(users.get("google-sub:g1"), "u1"); // reconnecting lands on the same user
});

test("can drop just one", async () => {
  kv.set("user:u2:trello", { t: 2 });
  await call("Bearer good:g2", { google: false });
  assert.equal(kv.has("user:u2:google"), true);
  assert.equal(kv.has("user:u2:trello"), false);
});

test("refuses: no sign-in, bad token, no Google id, wrong method", async () => {
  assert.equal((await call(null)).statusCode, 401);
  assert.equal((await call("Bearer nope")).statusCode, 401);
  assert.equal((await call("Bearer good:")).statusCode, 404);
  assert.equal((await call("Bearer good:g1", {}, "GET")).statusCode, 405);
});
