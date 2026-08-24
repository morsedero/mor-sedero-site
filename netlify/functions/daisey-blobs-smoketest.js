// One-time smoke test: write then read a key with Netlify Blobs, across
// what may be two different invocations. Confirms the store actually works
// on this project before daisey-proxy.js depends on it for real tokens.
// Safe to delete once confirmed — writes only to a "smoketest" store.
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const store = getStore("smoketest");
  const key = "ping";

  if (event.queryStringParameters && event.queryStringParameters.write) {
    const value = { at: new Date().toISOString(), rand: Math.random().toString(36).slice(2) };
    await store.setJSON(key, value);
    return { statusCode: 200, body: `wrote: ${JSON.stringify(value)}` };
  }

  const got = await store.get(key, { type: "json" });
  return { statusCode: 200, body: got ? `read: ${JSON.stringify(got)}` : "nothing stored yet — call with ?write=1 first" };
};
