// Starts the Google OAuth flow. Redirects to Google's consent screen.
// Sets a signed `state` cookie first, checked by the callback for CSRF.
const crypto = require("crypto");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const SESSION_SECRET = process.env.SESSION_SECRET;
const REDIRECT_URI = "https://morsedero.com/.netlify/functions/daisey-auth-google-callback";

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

exports.handler = async () => {
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
    state,
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      "Set-Cookie": `daisey_g_state=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
    body: "",
  };
};
