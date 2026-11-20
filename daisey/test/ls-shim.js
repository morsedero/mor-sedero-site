// Test-only preload (run-all.js sets NODE_OPTIONS=--require). Current
// Chromium denies localStorage on the about:blank page the suites
// setContent() into (and init scripts don't run there either), so the app dies
// at boot ("Access is denied for this document") and every suite then fails
// with "S is not defined". Serve the same HTML from a real origin instead, so
// storage works. Everything else about setContent is unchanged.
const pw = require("playwright");
const URL_ = "https://daisey.test/";
const patchPage = (p) => {
  p.setContent = async (html, opts = {}) => {
    await p.unroute(URL_).catch(() => {});
    await p.route(URL_, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
    await p.goto(URL_, { waitUntil: opts.waitUntil || "load", timeout: opts.timeout });
  };
  return p;
};
const patchCtx = (ctx) => { const o = ctx.newPage.bind(ctx); ctx.newPage = async (...a) => patchPage(await o(...a)); return ctx; };
const ol = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...a) => {
  const b = await ol(...a);
  const nc = b.newContext.bind(b), np = b.newPage.bind(b);
  b.newContext = async (...x) => patchCtx(await nc(...x));
  b.newPage = async (...x) => patchPage(await np(...x));
  return b;
};
