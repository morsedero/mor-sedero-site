// Job Hunt is Mor's alone (2026-10-25, functions/_daisey-lib/owner.js): only
// her account is asked for Drive at consent, and drive-handler turns anyone
// else away before touching a grant. Firebase and the grant lookup are stubbed.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
process.env.GOOGLE_CLIENT_ID = "cid";
process.env.SESSION_SECRET = "s3cret";
const require = createRequire(import.meta.url);
const stub = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let claims = null, looked = 0;
stub("../../functions/_daisey-lib/firebase-auth.js", { verifyIdToken: async () => claims });
stub("../../functions/_daisey-lib/now-calendar.js", { accessForSub: async () => { looked++; return { accessToken: "at", userId: "u1" }; } });
stub("../../functions/_daisey-lib/tokens.js", { getGoogleAccessToken: async () => null });
const start = require("../../functions/daisey-auth-google-start.js");
const { driveHandler } = require("../../functions/_daisey-lib/drive-handler.js");
const { isJobsOwner } = require("../../functions/_daisey-lib/owner.js");

const scopes = async (hint) => new URL((await start.handler({ queryStringParameters: { return: "now", hint } })).headers.Location).searchParams.get("scope").split(" ");

test("consent: Drive is asked for only on Mor's account", async () => {
  for (const hint of ["morsedero@gmail.com", "MorSedero@Gmail.com"]) {
    assert.ok((await scopes(hint)).includes("https://www.googleapis.com/auth/drive"), hint);
  }
  for (const hint of ["someone@example.com", ""]) {
    const s = await scopes(hint);
    assert.ok(s.includes("https://www.googleapis.com/auth/calendar"), hint);
    assert.ok(!s.some((x) => x.includes("/auth/drive")), hint);
  }
});

const call = () => driveHandler({ httpMethod: "GET", headers: { authorization: "Bearer t" } }, async () => ({ cards: [] }), "test");
const who = (email, verified = true) => ({ sub: "f1", email, email_verified: verified, firebase: { identities: { "google.com": ["g1"] } } });

test("drive-handler: anyone but Mor gets 403 not_owner, and no grant is looked up", async () => {
  looked = 0;
  for (const c of [who("someone@example.com"), who("morsedero@gmail.com", false), who(undefined)]) {
    claims = c;
    const res = await call();
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, "not_owner");
  }
  assert.equal(looked, 0);
  claims = who("morsedero@gmail.com");
  assert.equal((await call()).statusCode, 200);
  assert.equal(looked, 1);
});

test("isJobsOwner: a verified address only", () => {
  assert.equal(isJobsOwner(who("morsedero@gmail.com")), true);
  assert.equal(isJobsOwner(who("morsedero@gmail.com", false)), false);
  assert.equal(isJobsOwner(null), false);
});

// A grant from before the full drive scope reads fine but can't move a folder:
// the read says so (canWrite false) so the app offers Reconnect up front.
stub("../../functions/_daisey-lib/jobs-drive.js", { readJobs: async () => ({ cards: [{ id: "j1" }], modified: null, fileId: "f" }), writeStages: async () => ({}) });
const jobs = require("../../functions/daisey-now-jobs.js");

test("daisey-now-jobs GET: canWrite follows the grant's scope", async () => {
  claims = who("morsedero@gmail.com");
  const real = globalThis.fetch;
  try {
    for (const [scope, want] of [["https://www.googleapis.com/auth/drive.readonly openid", false], ["https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar", true]]) {
      globalThis.fetch = async (u) => { assert.match(u, /tokeninfo\?access_token=at$/); return { ok: true, json: async () => ({ scope }) }; };
      const body = JSON.parse((await jobs.handler({ httpMethod: "GET", headers: { authorization: "Bearer t" } })).body);
      assert.equal(body.canWrite, want, scope);
      assert.equal(body.cards.length, 1);
    }
    globalThis.fetch = async () => ({ ok: false }); // tokeninfo down: no nag
    assert.equal(JSON.parse((await jobs.handler({ httpMethod: "GET", headers: { authorization: "Bearer t" } })).body).canWrite, true);
  } finally { globalThis.fetch = real; }
});
