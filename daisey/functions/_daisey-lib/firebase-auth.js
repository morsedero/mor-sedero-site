// Verifies a Firebase ID token (Daisey v1's sign-in) without firebase-admin:
// an RS256 JWT signed by one of Google's securetoken certs. Checks follow
// Firebase's "verify ID tokens using a third-party JWT library" rules.
// Returns the token's claims, or throws.
const crypto = require("crypto");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "daisey-3bd45"; // public, see daisey/app/js/config.js
const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cache = { certs: null, until: 0 };
async function googleCerts() {
  if (cache.certs && Date.now() < cache.until) return cache.certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const maxAge = Number((res.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || 3600);
  cache = { certs: await res.json(), until: Date.now() + maxAge * 1000 };
  return cache.certs;
}

const b64json = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

// certs: { kid: PEM } — injectable for tests.
async function verifyIdToken(token, { certs, now = Date.now(), projectId = PROJECT_ID } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, sig] = parts;
  const header = b64json(h), claims = b64json(p);
  if (header.alg !== "RS256") throw new Error("bad alg");
  const pem = (certs || (await googleCerts()))[header.kid];
  if (!pem) throw new Error("unknown kid");
  const ok = crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(crypto.createPublicKey(pem), Buffer.from(sig, "base64url"));
  if (!ok) throw new Error("bad signature");
  const sec = Math.floor(now / 1000), SKEW = 300;
  if (!(claims.exp > sec - SKEW)) throw new Error("expired");
  if (!(claims.iat <= sec + SKEW) || !(claims.auth_time <= sec + SKEW)) throw new Error("issued in the future");
  if (claims.aud !== projectId) throw new Error("wrong audience");
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("wrong issuer");
  if (!claims.sub) throw new Error("no subject");
  return claims;
}

module.exports = { verifyIdToken };
