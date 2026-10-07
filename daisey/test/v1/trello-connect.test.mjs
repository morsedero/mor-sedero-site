// "Connect Trello" from Daisey v1 (2026-10-07): start marker cookie, the
// callback's hand-back to the app, and saving with a Firebase sign-in.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
process.env.TRELLO_STANDALONE_API_KEY = "tkey";
process.env.SESSION_SECRET = "s3cret";
const require = createRequire(import.meta.url);
const kv = new Map();
const store = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => { kv.set(k, v); }, setJSON: async (k, v) => { kv.set(k, v); } };
const blobs = require.resolve("../../functions/_daisey-lib/blobs.js");
require.cache[blobs] = { id: blobs, filename: blobs, loaded: true, exports: { openStore: () => store } };

// A Firebase ID token check that accepts "good:<sub>" and nothing else.
const fb = require.resolve("../../functions/_daisey-lib/firebase-auth.js");
require.cache[fb] = { id: fb, filename: fb, loaded: true, exports: { verifyIdToken: async (t) => {
  const m = /^good:(.*)$/.exec(t);
  if (!m) throw new Error("bad token");
  return { firebase: { identities: m[1] ? { "google.com": [m[1]] } : {} } };
} } };

const start = require("../../functions/daisey-auth-trello-start.js");
const callback = require("../../functions/daisey-auth-trello-callback.js");
const save = require("../../functions/daisey-auth-trello-save.js");

test("start: return=now sets a short-lived marker cookie; plain start sets none", async () => {
  const a = await start.handler({ queryStringParameters: { return: "now" } });
  assert.match(a.headers["Set-Cookie"], /^daisey_t_return=now;.*HttpOnly.*Max-Age=600/);
  assert.match(a.headers.Location, /^https:\/\/trello\.com\/1\/authorize\?/);
  const b = await start.handler();
  assert.equal(b.headers["Set-Cookie"], undefined);
});

test("callback: with the marker it forwards the fragment into the app and clears the cookie", async () => {
  const res = await callback.handler({ headers: { cookie: "x=1; daisey_t_return=now" } });
  assert.match(res.body, /location\.replace\("\/daisey\/now\/\?trello=1"\+location\.hash\)/);
  assert.match(res.multiValueHeaders["Set-Cookie"][0], /Max-Age=0/);
  assert.doesNotMatch(res.body, /daisey-auth-trello-save/); // nothing is posted from this page
  assert.match((await callback.handler({ headers: {} })).body, /daisey-auth-trello-save/); // the old relay is unchanged
});

const post = (headers, token = "tok") => save.handler({ httpMethod: "POST", headers, body: JSON.stringify({ token }) });

test("save: a Firebase sign-in stores the token under the Google sub's user id", async () => {
  globalThis.fetch = async () => ({ ok: true, text: async () => "" });
  const res = await post({ authorization: "Bearer good:g-777" });
  assert.equal(res.statusCode, 200);
  const userId = kv.get("google-sub:g-777");
  assert.ok(userId);
  assert.equal(kv.get(`user:${userId}:trello`).token, "tok");
  // The calendar function finds the same user id later.
  await post({ authorization: "Bearer good:g-777" }, "tok2");
  assert.equal(kv.get("google-sub:g-777"), userId);
});

test("save: a guest (no Google id), a bad token and no auth at all are refused", async () => {
  globalThis.fetch = async () => ({ ok: true, text: async () => "" });
  assert.equal((await post({ authorization: "Bearer good:" })).statusCode, 400);
  assert.equal((await post({ authorization: "Bearer nope" })).statusCode, 401);
  assert.equal((await post({})).statusCode, 401);
});

test("save: Trello rejecting the token stores nothing", async () => {
  kv.clear();
  globalThis.fetch = async () => ({ ok: false, text: async () => "invalid token" });
  const res = await post({ authorization: "Bearer good:g-1" });
  assert.equal(res.statusCode, 400);
  assert.equal([...kv.keys()].some((k) => k.endsWith(":trello")), false);
});
