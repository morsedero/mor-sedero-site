// The morning brief (2026-10-06): Web Push encryption against RFC 8291's
// own example, the VAPID signature, and the brief's sums in the user's zone.
// Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = require("../../functions/_daisey-lib/webpush.js");
const B = require("../../functions/_daisey-lib/brief.js");

test("encrypt: RFC 8291 Appendix A, byte for byte", () => {
  const out = P.encrypt("When I grow up, I want to be a watermelon",
    { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
    { as: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url") });
  assert.equal(out.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("vapidHeader: an ES256 JWT for the push service's origin that the public key verifies", () => {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const keys = { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: ecdh.getPrivateKey().toString("base64url") };
  const h = P.vapidHeader("https://fcm.googleapis.com/fcm/send/abc", keys, Date.UTC(2026, 9, 6));
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [head, claims, sig] = jwt.split(".");
  const c = JSON.parse(Buffer.from(claims, "base64url"));
  assert.equal(c.aud, "https://fcm.googleapis.com");
  assert.equal(c.exp, Date.UTC(2026, 9, 6) / 1000 + 12 * 3600);
  const pub = Buffer.from(keys.publicKey, "base64url");
  const key = crypto.createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") } });
  assert.ok(crypto.verify("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
});

// Tue 6 Oct 2026, 08:05 in Israel (UTC+3) = 05:05 UTC.
const TZ = "Asia/Jerusalem";
const NOW = Date.UTC(2026, 9, 6, 5, 5);
const il = (h, m = 0) => new Date(Date.UTC(2026, 9, 6, h - 3, m)).toISOString();
const t = (o) => ({ title: "Task", status: "ready", due: "2026-10-06", dateKind: "target", size: 30, spentMinutes: 0, ...o });

test("brief: the wall clock in the user's zone, not the server's", () => {
  assert.deepEqual(B.localParts(NOW, TZ), { date: "2026-10-06", minutes: 8 * 60 + 5 });
  assert.equal(B.zoned("2026-10-06", 8 * 60, TZ), Date.UTC(2026, 9, 6, 5, 0));
  // Winter time (UTC+2) after 25 Oct.
  assert.equal(B.zoned("2026-11-01", 8 * 60, TZ), Date.UTC(2026, 10, 1, 6, 0));
});

test("brief: free time, open and fit, deadlines, first event", () => {
  const events = [
    { title: "Teaching", start: il(10), end: il(14), busy: true },
    { title: "Holiday", start: "2026-10-06", end: "2026-10-07", allDay: true, busy: false },
  ];
  const tasks = [
    t({ title: "Pay arnona", dateKind: "deadline", size: 15 }),
    t({ title: "Grant report", dateKind: "deadline", due: "2026-10-04", size: 60 }),
    t({ title: "Mix review", size: 600 }), // too big to fit
    t({ title: "Lesson prep", due: "2026-10-09" }), // later: not open today
    t({ title: "Old wish", due: "2026-10-01", size: 15 }), // passed target rolls to today
    t({ title: "Not yet", notBefore: "2026-10-07" }),
    t({ title: "Pending", status: "waiting" }),
  ];
  const b = B.brief({ tasks, events, now: NOW, tz: TZ, dayStart: 480, dayEnd: 1320 });
  // 08:05–10:00 (115) + 14:00–22:00 (480) = 595 min.
  assert.equal(b.body, "9 h 55 min free today. 4 open, about 3 fit. Deadline passed: Grant report. Deadline today: Pay arnona. First: Teaching at 10:00.");
});

test("brief: no calendar claims no free time; an empty day says so", () => {
  assert.equal(B.brief({ tasks: [t({})], events: null, now: NOW, tz: TZ }).body, "1 open today.");
  assert.equal(B.brief({ tasks: [], events: [], now: NOW, tz: TZ, dayStart: 480, dayEnd: 1320 }).body, "13 h 55 min free today. Nothing due today.");
});
