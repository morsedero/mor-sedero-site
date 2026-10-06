// The morning brief (2026-10-06): Web Push encryption against RFC 8291's
// own example, the VAPID signature, and the brief's sums in the user's zone.
// Run: node --test "daisey/test/v1/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = require("../../functions/_daisey-lib/webpush.js");
process.env.TZ = "Asia/Jerusalem"; // the engine reads local time, as on the server
const B = await import("../../app/js/brief.js");
const N = require("../../functions/_daisey-lib/notify.js");

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
const t = (o) => ({ id: String(Math.random()), title: "Task", status: "ready", due: "2026-10-06", dateKind: "target", size: 30, spentMinutes: 0, ...o });

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

test("brief: tomorrow's deadline not started, and Needs you's count", () => {
  const tasks = [t({ title: "Send stems", dateKind: "deadline", due: "2026-10-07" }),
    t({ title: "Begun", dateKind: "deadline", due: "2026-10-07", starts: 1 })];
  const b = B.brief({ tasks, events: null, now: NOW, tz: TZ, needs: 2 });
  assert.equal(b.body, "Nothing due today. Deadline tomorrow, not started: Send stems. 2 things need you.");
});

// ---------- notify.decide: what goes, when ----------
const at = (h, m = 0) => Date.UTC(2026, 9, 6, h - 3, m); // Israel wall clock, 6 Oct
const rec = (o = {}) => ({ tz: TZ, dayStart: 480, dayEnd: 1320, subs: [{}], tasks: [], ...o });
const types = (out) => out.map((m) => m.type);

test("decide: brief once, at day start, never inside an event or at night", () => {
  const teach = { id: "e1", title: "Teaching", start: il(8), end: il(10), busy: true };
  assert.deepEqual(types(N.decide(rec(), [], at(7, 55)).out), []); // before the day
  assert.deepEqual(types(N.decide(rec(), [teach], at(8, 5)).out), []); // in an event: wait
  const d = N.decide(rec(), [teach], at(10, 5));
  assert.ok(types(d.out).includes("brief"));
  assert.equal(d.patch.sentOn, "2026-10-06");
  assert.ok(!types(N.decide(rec({ sentOn: "2026-10-06" }), [], at(10, 10)).out).includes("brief"));
  assert.deepEqual(types(N.decide(rec({ notify: { brief: false } }), [], at(8, 5)).out), []); // switched off
});

test("decide: gap after an event names the Now card's pick, once", () => {
  const evs = [{ id: "e1", title: "Teaching", start: il(9), end: il(11), busy: true }, { id: "e2", title: "Rehearsal", start: il(12, 30), end: il(14), busy: true }];
  const r = rec({ sentOn: "2026-10-06", tasks: [t({ title: "Send invoice to Uri", size: 15, type: "admin", due: "2026-10-06", dateKind: "deadline" })] });
  const d = N.decide(r, evs, at(11, 5));
  assert.deepEqual(types(d.out), ["gap"]);
  assert.match(d.out[0].body, /^1 h 15 min free\. Next: Send invoice to Uri\./); // 85 min less the 10-minute buffer
  assert.equal(d.out[0].title, "Teaching is over");
  assert.equal(N.decide({ ...r, gapFor: d.patch.gapFor }, evs, at(11, 10)).out.length, 0); // not twice
  assert.equal(N.decide(r, evs, at(11, 20)).out.length, 0); // ended too long ago
  assert.equal(N.decide(r, [evs[0], { ...evs[1], start: il(11, 20) }], at(11, 5)).out.length, 0); // under 30 min free
});

test("decide: booked slot starting, once; wrap in the day's last hour", () => {
  const task = t({ id: "mix", title: "Mix review", due: null });
  const slot = { id: "s1", title: "Mix review", start: il(14), end: il(15, 30), busy: true, taskId: "mix" };
  const r = rec({ sentOn: "2026-10-06", tasks: [task] });
  assert.equal(N.decide(r, [slot], at(13, 50)).out.length, 0); // too early
  const d = N.decide(r, [slot], at(14, 1));
  assert.deepEqual(types(d.out), ["booked"]);
  assert.equal(d.out[0].body, "Mix review, booked 14:00–15:30.");
  assert.equal(N.decide({ ...r, bookedSent: d.patch.bookedSent }, [slot], at(14, 5)).out.length, 0);

  const day = rec({ sentOn: "2026-10-06", tasks: [t({ title: "Pay arnona", dateKind: "deadline" }), t({ status: "done", doneAt: at(12) }), t({ status: "done", doneAt: at(9) })] });
  assert.equal(N.decide(day, [], at(20, 55)).out.length, 0);
  const w = N.decide(day, [], at(21, 5));
  assert.deepEqual(types(w.out), ["wrap"]);
  assert.equal(w.out[0].body, "Done today: 2. Still open for today: 1, deadline: Pay arnona. Tap to sort them.");
  assert.equal(w.out[0].url, "./?open=wrap");
  assert.equal(N.decide({ ...day, wrapOn: "2026-10-06" }, [], at(21, 10)).out.length, 0);
});

// ---------- waiting on people (2026-10-06) ----------
const Nu = await import("../../app/js/nudge.js");
test("nudge: the name, the language, the WhatsApp link", () => {
  assert.equal(Nu.personOf("Yuval sends the stems"), "Yuval");
  assert.equal(Nu.personOf("יובל שולח את הסטמס"), "יובל");
  assert.equal(Nu.personOf("the bank"), null);
  assert.ok(Nu.names("Coffee with Yuval", "Yuval") && Nu.names("פגישה עם יובל", "יובל") && Nu.names("שיחה ליובל", "יובל"));
  assert.ok(!Nu.names("Yuvalim party", "Yuval"));
  assert.equal(Nu.nudgeText({ title: "Pre-attack cue", waitingOn: "Yuval" }), 'Hi Yuval, just checking in about "Pre-attack cue". Any news?');
  assert.equal(Nu.nudgeText({ title: "הסטמס", waitingOn: "יובל" }), 'היי יובל, רציתי לבדוק לגבי "הסטמס". יש עדכון?');
  assert.equal(Nu.waLink("a b"), "https://wa.me/?text=a%20b");
});

test("decide: people — before a meeting with someone you wait on, once; gap leaves the buffer", () => {
  const r = rec({ sentOn: "2026-10-06", tasks: [t({ id: "c", title: "Pre-attack cue", status: "waiting", waitingOn: "Yuval sends it" })] });
  const ev = { id: "m1", title: "Coffee with Yuval", start: il(14), end: il(15), busy: true };
  assert.equal(N.decide(r, [ev], at(13, 0)).out.length, 0); // an hour early
  const d = N.decide(r, [ev], at(13, 30));
  assert.deepEqual(types(d.out), ["people"]);
  assert.equal(d.out[0].body, "You're waiting on Yuval for: Pre-attack cue.");
  assert.equal(N.decide({ ...r, peopleSent: d.patch.peopleSent }, [ev], at(13, 40)).out.length, 0);
  // Gap: 11:05 → 12:30 is 85 min, less the 10-minute buffer.
  const evs = [{ id: "e1", title: "Teaching", start: il(9), end: il(11), busy: true }, { id: "e2", title: "Rehearsal", start: il(12, 30), end: il(14), busy: true }];
  const g = N.decide(rec({ sentOn: "2026-10-06", tasks: [t({ title: "Send invoice", size: 15 })] }), evs, at(11, 5));
  assert.match(g.out[0].body, /^1 h 15 min free\./);
});
