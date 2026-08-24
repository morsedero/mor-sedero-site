// Starts the Trello auth flow. Redirects to Trello's own authorize page.
// Trello has no OAuth2/refresh-token model — this is a token-grant flow.
// The token comes back in the URL fragment (after #), which the browser
// never sends to a server. return_url points at the relay page, which
// reads the fragment client-side and POSTs it to daisey-auth-trello-save.
const KEY = process.env.TRELLO_STANDALONE_API_KEY;
const RETURN_URL = "https://morsedero.com/.netlify/functions/daisey-auth-trello-callback";

exports.handler = async () => {
  if (!KEY) {
    return { statusCode: 500, body: "Trello auth is not configured." };
  }

  const params = new URLSearchParams({
    key: KEY,
    return_url: RETURN_URL,
    scope: "read,write",
    expiration: "never",
    name: "Daisey",
    response_type: "token",
  });

  return {
    statusCode: 302,
    headers: { Location: `https://trello.com/1/authorize?${params.toString()}` },
    body: "",
  };
};
