// Session cookie: signed random id, stored value in Blobs under
// session:<id> -> { userId, createdAt }. Real user data lives under
// user:<userId>:google / user:<userId>:trello.
const crypto = require("crypto");
const { openStore } = require("./blobs");

const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = "daisey_session";
const SESSION_TTL_DAYS = 30;

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function getCookie(headers, name) {
  const raw = (headers && (headers.cookie || headers.Cookie)) || "";
  const match = raw.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

// Verifies the incoming request's session cookie. Returns the userId, or
// null if there's no valid session — never throws, so callers can just
// check truthiness rather than try/catch on every call.
async function getUserId(event) {
  const cookieVal = getCookie(event.headers || {}, COOKIE_NAME);
  if (!cookieVal) return null;
  const [id, sig] = cookieVal.split(".");
  if (!id || !sig) return null;
  const expected = sign(id);
  const sigOk = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!sigOk) return null;

  const store = openStore("daisey-sessions");
  const session = await store.get(`session:${id}`, { type: "json" });
  if (!session) return null;
  if (session.expiresAt && Date.now() > session.expiresAt) return null;
  return session.userId;
}

// Creates a brand-new session for a userId, returns the Set-Cookie header
// value to send back. Used once, right after a successful Google login.
async function createSession(userId) {
  const id = crypto.randomBytes(24).toString("hex");
  const store = openStore("daisey-sessions");
  const expiresAt = Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  await store.setJSON(`session:${id}`, { userId, createdAt: Date.now(), expiresAt });
  const cookieVal = `${id}.${sign(id)}`;
  return `${COOKIE_NAME}=${cookieVal}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_DAYS * 24 * 60 * 60}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0`;
}

module.exports = { getUserId, createSession, clearSessionCookie };
