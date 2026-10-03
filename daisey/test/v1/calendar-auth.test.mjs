// The Firebase ID-token check in daisey/functions/_daisey-lib/firebase-auth.js,
// against a key made here. Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const { verifyIdToken } = createRequire(import.meta.url)("../../functions/_daisey-lib/firebase-auth.js");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const certs = { k1: publicKey.export({ type: "spki", format: "pem" }) };
const NOW = Date.UTC(2026, 9, 5, 10), sec = NOW / 1000, P = "proj";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (claims, header = { alg: "RS256", kid: "k1" }) => {
  const body = `${b64(header)}.${b64(claims)}`;
  return `${body}.${crypto.sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
};
const good = { aud: P, iss: `https://securetoken.google.com/${P}`, sub: "u1", iat: sec - 60, auth_time: sec - 60, exp: sec + 3000,
  firebase: { identities: { "google.com": ["123"] } } };
const check = (token) => verifyIdToken(token, { certs, now: NOW, projectId: P });

test("a good token returns its claims", async () => {
  assert.equal((await check(sign(good))).firebase.identities["google.com"][0], "123");
});

test("rejects: expired, wrong project, wrong issuer, unknown key, tampered, wrong alg, junk", async () => {
  await assert.rejects(check(sign({ ...good, exp: sec - 600 })), /expired/);
  await assert.rejects(check(sign({ ...good, aud: "other" })), /audience/);
  await assert.rejects(check(sign({ ...good, iss: "https://evil" })), /issuer/);
  await assert.rejects(check(sign(good, { alg: "RS256", kid: "nope" })), /kid/);
  const [h, , s] = sign(good).split(".");
  await assert.rejects(check(`${h}.${b64({ ...good, sub: "someone-else" })}.${s}`), /signature/);
  await assert.rejects(check(sign(good, { alg: "none", kid: "k1" })), /alg/);
  await assert.rejects(check("junk"), /malformed/);
});
