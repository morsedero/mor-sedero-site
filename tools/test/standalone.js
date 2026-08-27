/* Build order step 2: prove the daisey.html -> daisey-standalone.html splice
 * actually works end to end — real HTTP to a mock proxy standing in for
 * netlify/functions/daisey-proxy.js, no window.claude anywhere in the page.
 *
 * This is the step that has to pass before any OAuth/Netlify Function work
 * starts: if the shim/splice itself is broken, nothing built on top of it
 * can be trusted either. Two things this specifically must show:
 *   1. With no session cookie at all, the login gate renders — not a
 *      silent blank page, not a crash on window.claude being undefined.
 *   2. With a session, the app boots for real: boards load, the state
 *      card's `setup` block is adopted (so this ALSO re-proves the
 *      standalone build doesn't need its own separate setup path — the
 *      existing SETUP/applySetup/discoverSetup machinery just works,
 *      per the build-standalone plan's §9 claim), and a real write
 *      (marking a card done) reaches the mock as trelloWriteCard.
 */
const fs = require("fs");
const { chromium } = require("playwright");
const mockProxy = require("./mock-proxy");

const STANDALONE_HTML = __dirname + "/../daisey-standalone.html";

(async () => {
  const bad = [];
  const check = (ok, msg) => { if(!ok) bad.push(msg); };

  const html = fs.readFileSync(STANDALONE_HTML, "utf8");
  const { server, writeCalls } = await mockProxy.start(0, html);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch({});

  /* ---- 1. no session -> login gate, not a crash ------------------------ */
  {
    const ctx = await browser.newContext({ viewport:{width:390,height:800} });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    /* This mock never actually rejects the session check (see mock-proxy.js
       — "Session"/"whoami" always returns {}), so to exercise the
       no-session path this context blocks that one call and lets it 401,
       same as a real missing cookie would produce against the real proxy. */
    await p.route("**/daisey-proxy", route => {
      const body = route.request().postDataJSON();
      if(body && body.server === "Session") return route.fulfill({ status:401, body:"{}" });
      return route.continue();
    });
    await p.goto(base, { waitUntil:"load" });
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({
      gate: !!document.querySelector(".login-gate"),
      hasGoogleLink: !!document.querySelector('a[href*="daisey-auth-google-start"]'),
      windowClaude: typeof window.claude
    }));
    console.log("no session       :", JSON.stringify(r));
    check(r.gate, "no login gate rendered with no session");
    check(r.hasGoogleLink, "login gate has no Sign in with Google link");
    check(errs.length === 0, "page errors with no session: " + errs.join("|"));
    await ctx.close();
  }

  /* ---- 2. real session -> app boots for real ---------------------------- */
  {
    const ctx = await browser.newContext({ viewport:{width:390,height:800} });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    p.on("console", m => { if(m.type() === "error") errs.push(m.text()); });
    await p.goto(base, { waitUntil:"load" });
    await p.waitForTimeout(3500);

    const r = await p.evaluate(() => ({
      gate: !!document.querySelector(".login-gate"),
      windowClaude: typeof window.claude,
      standalone: typeof STANDALONE !== "undefined" ? STANDALONE : "undefined",
      setup: typeof SETUP !== "undefined" && SETUP ? { keys: SETUP.boards.map(b=>b.key), cal: SETUP.calId } : null,
      streak: (typeof S !== "undefined" && S.stats) ? S.stats.streak : null,
      cardsLoaded: typeof allCards === "function" ? allCards().length : -1
    }));
    console.log("real session      :", JSON.stringify(r));
    check(!r.gate, "login gate still showing with a valid session");
    check(r.windowClaude === "undefined", "window.claude exists in the standalone build — it must not");
    check(r.standalone === true, "STANDALONE flag is not true at runtime");
    check(!!r.setup, "SETUP was never adopted from the mock state card");
    check(r.setup && r.setup.cal === "mock@example.com", `wrong calendar adopted: ${r.setup && r.setup.cal}`);
    check(r.streak === 2, `state card's streak wasn't read back correctly: ${r.streak}`);
    check(r.cardsLoaded > 0, "no cards loaded from the mock boards at all");

    /* a real write: mark the one PROJECTS card done, confirm it reaches the
       mock as a real trelloWriteCard call — proves callTool(), not just
       watchTool()'s reads, works through the shim. */
    const before = writeCalls().length;
    /* Simplest reliable proof of a real write without needing the card to be
       on today's schedule (completeItem/etc. all require that): call
       writeCardDesc directly, the same function every real card-edit path
       in the app uses under the hood — it goes through callTool() exactly
       like everything else. */
    await p.evaluate(async () => {
      const c = allCards().find(x => x.name === "Pay rent");
      await writeCardDesc(c, "edited via standalone shim test");
    });
    await p.waitForTimeout(300);
    const after = writeCalls();
    console.log("write proof       :", JSON.stringify(after.slice(before)));
    check(after.length > before, "no trelloWriteCard call reached the mock proxy");
    check(after[after.length-1].tool === "trelloWriteCard", `expected trelloWriteCard, got ${after[after.length-1] && after[after.length-1].tool}`);

    check(errs.length === 0, "page errors with a real session: " + errs.join("|"));
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(bad.length ? "FAIL:\n  x " + bad.join("\n  x ") : "OK standalone: splice boots for real, login-gates correctly, writes reach the proxy");
  process.exit(bad.length ? 1 : 0);
})();
