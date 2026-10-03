// Per-user OAuth token storage. Google tokens refresh; Trello tokens don't
// (expiration=never — no refresh_token concept exists on Trello's side).
const { openStore } = require("./blobs");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function store() {
  return openStore("daisey-tokens");
}

async function saveGoogleTokens(userId, tokens) {
  await store().setJSON(`user:${userId}:google`, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    // expiry as an absolute timestamp, not a relative "seconds from now" —
    // expires_in is only meaningful at the instant it was issued.
    expiry: Date.now() + (tokens.expires_in || 3600) * 1000,
  });
}

async function saveTrelloToken(userId, token) {
  await store().setJSON(`user:${userId}:trello`, { token, expiration: "never" });
}

// Returns a live Google access token, refreshing first if it's stale.
// Refreshing updates the stored record so the next call doesn't repeat it.
// Returns null if there's no Google connection at all for this user.
async function getGoogleAccessToken(userId) {
  const rec = await store().get(`user:${userId}:google`, { type: "json" });
  if (!rec) return null;

  // 60s margin so a token doesn't expire mid-flight between check and use.
  if (rec.expiry && Date.now() < rec.expiry - 60000) return rec.access_token;
  if (!rec.refresh_token) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: rec.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // invalid_grant — the 7-day Testing-mode expiry, or a revoked grant.
    // Not retryable; the caller surfaces needs_reauth.
    return null;
  }
  const body = await res.json();
  const updated = {
    access_token: body.access_token,
    refresh_token: rec.refresh_token, // Google doesn't always resend it
    expiry: Date.now() + (body.expires_in || 3600) * 1000,
  };
  await store().setJSON(`user:${userId}:google`, updated);
  return updated.access_token;
}

async function getTrelloToken(userId) {
  const rec = await store().get(`user:${userId}:trello`, { type: "json" });
  return rec ? rec.token : null;
}

async function hasTrello(userId) {
  return !!(await getTrelloToken(userId));
}

module.exports = { saveGoogleTokens, saveTrelloToken, getGoogleAccessToken, getTrelloToken, hasTrello };
