// Google redirects here after consent. Verifies `state`, exchanges the code
// for tokens, mints/reuses a userId keyed to the Google account, stores the
// tokens, creates a session, redirects into the app. If Trello isn't linked
// yet, redirects with ?needsTrello=1 instead (see tools/_standalone-src —
// the app's login gate reads that).
const crypto = require("crypto");
const { saveGoogleTokens, hasTrello } = require("./_daisey-lib/tokens");
const { createSession } = require("./_daisey-lib/session");
const { openStore } = require("./_daisey-lib/blobs");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const REDIRECT_URI = "https://morsedero.com/.netlify/functions/daisey-auth-google-callback";

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function getCookie(headers, name) {
  const raw = (headers && (headers.cookie || headers.Cookie)) || "";
  const match = raw.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return match ? match.slice(name.length + 1) : null;
}

// Google's own account id (the userinfo `sub` claim) is the stable key —
// the same Google account always maps to the same Daisey userId, so
// logging in again doesn't create a duplicate user or orphan the Trello
// link already made under the first one.
async function userIdForGoogleSub(sub) {
  const store = openStore("daisey-users");
  const key = `google-sub:${sub}`;
  const existing = await store.get(key, { type: "text" });
  if (existing) return existing;
  const userId = crypto.randomBytes(16).toString("hex");
  await store.set(key, userId);
  return userId;
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const code = qs.code;
  const state = qs.state;
  const error = qs.error;

  if (error) {
    return { statusCode: 200, body: `Google returned an error: ${error}` };
  }

  const cookieVal = getCookie(event.headers, "daisey_g_state");
  if (!cookieVal) return { statusCode: 400, body: "Missing state cookie. Start over from sign-in." };
  const [cookieState, cookieSig] = cookieVal.split(".");
  const expectedSig = sign(cookieState || "");
  const sigOk = cookieSig && cookieSig.length === expectedSig.length &&
    crypto.timingSafeEqual(Buffer.from(cookieSig), Buffer.from(expectedSig));
  if (!sigOk || cookieState !== state) {
    return { statusCode: 400, body: "State mismatch — possible CSRF, or an expired/reused login link." };
  }

  if (!code) return { statusCode: 400, body: "Missing authorization code." };

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok) {
    return { statusCode: 200, body: `Token exchange failed (${tokenRes.status}): ${JSON.stringify(tokenBody)}` };
  }

  const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  if (!infoRes.ok) {
    return { statusCode: 200, body: `Couldn't read the Google account id (${infoRes.status}).` };
  }
  const info = await infoRes.json();
  if (!info.sub) return { statusCode: 200, body: "Google didn't return an account id." };

  const userId = await userIdForGoogleSub(info.sub);
  await saveGoogleTokens(userId, tokenBody);
  const sessionCookie = await createSession(userId);
  const needsTrello = !(await hasTrello(userId));

  return {
    statusCode: 302,
    headers: { Location: needsTrello ? "/?needsTrello=1" : "/" },
    // Two Set-Cookie headers (the new session, clearing the old state
    // cookie) — multiValueHeaders is the Netlify/Lambda-compatible way to
    // send more than one value for the same header name.
    multiValueHeaders: {
      "Set-Cookie": [sessionCookie, "daisey_g_state=; Path=/; Max-Age=0"],
    },
    body: "",
  };
};
