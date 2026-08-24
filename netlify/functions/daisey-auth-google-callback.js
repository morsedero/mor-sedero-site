// Google redirects here after consent. Verifies `state`, exchanges the code
// for tokens, mints a session, redirects into the app.
//
// Token storage is NOT wired up yet (Netlify Blobs step comes later in the
// build order). For now this just proves the OAuth exchange itself works —
// it logs the token response shape and redirects with a status query param,
// rather than pretending a session exists that isn't backed by anything.
const crypto = require("crypto");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;
const REDIRECT_URI = "https://morsedero.com/.netlify/functions/daisey-auth-google-callback";

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function getCookie(headers, name) {
  const raw = headers.cookie || headers.Cookie || "";
  const match = raw.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return match ? match.slice(name.length + 1) : null;
}

exports.handler = async (event) => {
  const params = new URLSearchParams(event.rawQuery || event.queryStringParameters
    ? new URLSearchParams(event.queryStringParameters).toString()
    : "");
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  if (error) {
    return { statusCode: 200, body: `Google returned an error: ${error}` };
  }

  const cookieVal = getCookie(event.headers || {}, "daisey_g_state");
  if (!cookieVal) return { statusCode: 400, body: "Missing state cookie." };
  const [cookieState, cookieSig] = cookieVal.split(".");
  const expectedSig = sign(cookieState);
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
    return {
      statusCode: 200,
      body: `Token exchange failed (${tokenRes.status}): ${JSON.stringify(tokenBody)}`,
    };
  }

  // Real token storage (Netlify Blobs) is the next build step. For this
  // smoke test, report exactly what came back so the shape can be verified
  // against what the proxy will need to store — access_token, refresh_token
  // (only present because access_type=offline+prompt=consent), expires_in.
  const shape = {
    has_access_token: !!tokenBody.access_token,
    has_refresh_token: !!tokenBody.refresh_token,
    expires_in: tokenBody.expires_in,
    scope: tokenBody.scope,
    token_type: tokenBody.token_type,
  };

  return {
    statusCode: 200,
    headers: { "Set-Cookie": "daisey_g_state=; Path=/; Max-Age=0" },
    body: `Google OAuth exchange succeeded.\n${JSON.stringify(shape, null, 2)}\n\n(Token storage not wired up yet — this is a smoke test.)`,
  };
};
