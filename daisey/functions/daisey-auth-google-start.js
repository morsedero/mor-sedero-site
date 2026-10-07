// Starts the Google OAuth flow. Redirects to Google's consent screen.
// Sets a signed `state` cookie first, checked by the callback for CSRF.
const crypto = require("crypto");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const SESSION_SECRET = process.env.SESSION_SECRET;
const REDIRECT_URI = "https://morsedero.com/.netlify/functions/daisey-auth-google-callback";

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

// ?return=now: Daisey v1's "Connect Google Calendar" (2026-10-07). Same
// consent and the same stored grant as old Daisey (daisey-now-calendar finds
// it by the Google `sub`), but the callback sends the user back to
// /daisey/now/ instead of starting an old-Daisey session. ?hint=<email> asks
// Google to preselect the account they're signed in with, so the grant lands
// on the same `sub` the app's Firebase sign-in carries.
exports.handler = async (event = {}) => {
  const q = (event && event.queryStringParameters) || {};
  const back = q.return === "now";
  const hint = /^[^\s@<>"]+@[^\s@<>"]+$/.test(q.hint || "") ? q.hint : "";
  if (!CLIENT_ID || !SESSION_SECRET) {
    return { statusCode: 500, body: "Google auth is not configured." };
  }

  const state = crypto.randomBytes(16).toString("hex");
  const cookieValue = `${state}.${sign(state)}`;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    // calendar for the app itself; openid+email for the userinfo call the
    // callback makes to mint a stable userId — without these it can read
    // calendars but can't identify WHO logged in.
    scope: "https://www.googleapis.com/auth/calendar openid email",
    access_type: "offline",
    prompt: "consent",
    ...(hint ? { login_hint: hint } : {}),
    state,
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      "Set-Cookie": `daisey_g_state=${cookieValue}${back ? ".now" : ""}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
    body: "",
  };
};
