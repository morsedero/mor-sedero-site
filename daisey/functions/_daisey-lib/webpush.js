// Web Push without a dependency: RFC 8291 (aes128gcm payload encryption)
// and RFC 8292 (VAPID), on node's own crypto. Used by daisey-now-morning
// for the morning brief (2026-10-06).
//
// Keys live in Netlify's environment: VAPID_PUBLIC_KEY (65-byte uncompressed
// P-256 point) and VAPID_PRIVATE_KEY (32-byte scalar), both base64url. The
// public half also goes to the browser (GET daisey-now-push) to subscribe.
//
// encrypt() is checked against RFC 8291's Appendix A example in
// daisey/test/v1/push.test.mjs, so a slip in the key derivation fails a test
// rather than every notification silently.
const crypto = require("crypto");

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s), "base64url");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const RECORD_SIZE = 4096;

// RFC 8291 §3.4: the message for one subscription. `as` (the sender's
// one-off key pair) and `salt` are injectable for the RFC's test vector.
function encrypt(payload, { p256dh, auth }, { as = null, salt = crypto.randomBytes(16) } = {}) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  const ecdh = crypto.createECDH("prime256v1");
  if (as) ecdh.setPrivateKey(unb64u(as)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])])).subarray(0, 32);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// RFC 8292: a signed JWT naming the push service's origin.
function vapidHeader(endpoint, { publicKey, privateKey, subject = "https://morsedero.com" }, now = Date.now()) {
  const pub = unb64u(publicKey);
  const key = crypto.createPrivateKey({ format: "jwk", key: {
    kty: "EC", crv: "P-256", d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)),
  } });
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

const vapidKeys = () => ({ publicKey: process.env.VAPID_PUBLIC_KEY || "", privateKey: process.env.VAPID_PRIVATE_KEY || "" });
const configured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

// Sends one message. Returns { ok, gone, status }: gone = the subscription
// no longer exists (404/410) and should be forgotten.
async function send(subscription, message, { ttl = 6 * 3600, keys = vapidKeys() } = {}) {
  const body = encrypt(JSON.stringify(message), subscription.keys || {});
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidHeader(subscription.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "normal",
    },
    body,
  });
  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
}

module.exports = { encrypt, vapidHeader, send, configured, vapidKeys };
