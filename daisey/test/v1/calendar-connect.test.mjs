// "Connect Google Calendar" from Daisey v1 (2026-10-07): the start and callback
// functions' return=now flow. Blobs and Google are stubbed here.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
process.env.GOOGLE_CLIENT_ID = "cid";
process.env.GOOGLE_CLIENT_SECRET = "sec";
process.env.SESSION_SECRET = "s3cret";
const require = createRequire(import.meta.url);
const lib = require.resolve("../../functions/_daisey-lib/blobs.js");
const kv = new Map();
const store = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => { kv.set(k, v); }, setJSON: async (k, v) => { kv.set(k, v); } };
require.cache[lib] = { id: lib, filename: lib, loaded: true, exports: { openStore: () => store } };
const start = require("../../functions/daisey-auth-google-start.js");
const callback = require("../../functions/daisey-auth-google-callback.js");

const stateCookie = (res) => res.headers["Set-Cookie"].split(";")[0].slice("daisey_g_state=".length);

test("start: return=now marks the state cookie and preselects the account", async () => {
  const res = await start.handler({ queryStringParameters: { return: "now", hint: "mor@example.com" } });
  const url = new URL(res.headers.Location);
  assert.equal(url.searchParams.get("login_hint"), "mor@example.com");
  assert.equal(url.searchParams.get("prompt"), "consent"); // a refresh token needs it
  assert.match(stateCookie(res), /\.now$/);
});

test("start: plain start is unchanged, and a junk hint is dropped", async () => {
  const res = await start.handler({ queryStringParameters: { hint: "<script>" } });
  assert.equal(new URL(res.headers.Location).searchParams.has("login_hint"), false);
  assert.doesNotMatch(stateCookie(res), /\.now$/);
  assert.equal((await start.handler()).statusCode, 302); // no event at all still works
});

const withGoogle = (tokens) => {
  globalThis.fetch = async (url) => (String(url).includes("userinfo")
    ? { ok: true, json: async () => ({ sub: "g-123" }) }
    : { ok: true, status: 200, json: async () => tokens });
};
const cb = async (tokens) => {
  withGoogle(tokens);
  const s = await start.handler({ queryStringParameters: { return: "now" } });
  const cookie = stateCookie(s), state = cookie.split(".")[0];
  return callback.handler({ queryStringParameters: { code: "c", state }, headers: { cookie: `daisey_g_state=${cookie}` } });
};

test("callback: from Daisey v1 it stores the grant under the Google sub and goes back to /daisey/now/", async () => {
  const res = await cb({ access_token: "a", refresh_token: "r", expires_in: 3600 });
  assert.equal(res.headers.Location, "/daisey/now/?calendar=connected");
  const userId = kv.get("google-sub:g-123");
  assert.ok(userId);
  assert.equal(kv.get(`user:${userId}:google`).refresh_token, "r");
  assert.equal(res.multiValueHeaders["Set-Cookie"].some((c) => c.startsWith("daisey_session")), false); // no old-Daisey session
});

test("callback: no refresh token is a failure, not a half-connection", async () => {
  kv.clear();
  const res = await cb({ access_token: "a", expires_in: 3600 });
  assert.equal(res.headers.Location, "/daisey/now/?calendar=failed");
  assert.equal([...kv.keys()].some((k) => k.endsWith(":google")), false);
});

test("callback: declining on Google's screen returns to the app", async () => {
  const s = await start.handler({ queryStringParameters: { return: "now" } });
  const res = await callback.handler({ queryStringParameters: { error: "access_denied" }, headers: { cookie: `daisey_g_state=${stateCookie(s)}` } });
  assert.equal(res.headers.Location, "/daisey/now/?calendar=failed");
});
