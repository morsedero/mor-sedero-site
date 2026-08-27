/* ============================================================
   STANDALONE ONLY — spliced into daisey.html by build-standalone.js
   at the BUILD-STANDALONE:MCP-RESOLVE marker inside boot(). Never
   present in the Claude artifact. See tools/CLAUDE.md's "Daisey
   standalone" section for the architecture this implements.
   ============================================================ */

/* The whole point: daisey.html's 27 Trello/Google call sites all go through
   callTool()/S.mcp.watchTool()/S.mcp.invalidate(). This object implements
   that exact three-method shape over real HTTP to daisey-proxy.js, so NONE
   of those 27 call sites — or anything else in the file below boot() —
   needs to change. Session auth rides on the browser's own cookie jar
   (credentials:"include"); the shim itself holds no token, ever. */
function standaloneMcp(){
  async function callTool(server, tool, input){
    const res = await fetch("/.netlify/functions/daisey-proxy", {
      method:"POST", credentials:"include",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ server, tool, input })
    });
    if(res.status === 401){
      /* The session cookie is missing or the proxy rejected it outright —
         distinct from a Trello/Google token being stale (that comes back as
         a 200 whose body carries {code:"needs_reauth"}, handled below). A
         bare 401 means "we don't know who this is," so route it through the
         same needsLogin path startWatches' errors go through rather than
         surfacing it as a per-call toast — see boot()'s session check. */
      throw { code:"no_session", server, message:"Sign in to continue." };
    }
    let body;
    try{ body = await res.json(); }
    catch(_){ body = {}; }
    if(!res.ok || body.error){
      const err = body.error || body;
      throw { code: err.code || "tool_error", message: err.message, server };
    }
    return body;
  }

  /* No push transport exists from Trello/Google REST without materially
     more infrastructure (webhooks + a relay) than this app's own staleness
     tolerance needs. Polling at the SAME intervals the app already passes
     as opts.refetchInterval (180000 cards / 600000 tracker lists / 120000
     calendar) is the honest equivalent of watchTool's live updates — those
     numbers already encode "how fresh does this actually need to be,"
     nothing here reinvents that. */
  /* invalidate(server, tool) has no input of its own — the real MCP
     capability replays whatever the live watchTool subscription already
     owns. This map is what makes that true here too: every active watch
     registers its own (server,tool,input,fire) under a shared key, so
     invalidate can re-fire the SAME request a bare empty-input call
     never could (list_events needs calendarId/startTime/endTime; an
     empty {} 404s at the proxy and gets swallowed, silently leaving
     stale/empty data on screen — this is what that bug looked like). */
  const live = new Map(); // key -> { input, fire }

  function watchTool(server, tool, input, handler, opts){
    const key = server + "|" + tool;
    let alive = true;
    const interval = (opts && opts.refetchInterval) || 180000;
    const fire = () => {
      if(!alive) return;
      callTool(server, tool, input)
        .then(result => { if(alive) handler({ type:"data", result }); })
        .catch(error => { if(alive) handler({ type:"error", error }); });
    };
    live.set(key, { input, fire });
    fire();
    const id = setInterval(fire, interval);
    return () => {
      alive = false; clearInterval(id);
      if(live.get(key) && live.get(key).fire === fire) live.delete(key);
    };
  }

  /* Re-fires the matching watchTool's own last request right now, same as
     the real capability's cache-bust. If no watch is registered for this
     (server,tool) — shouldn't happen given every call site pairs the two —
     falls back to the old empty-input call rather than doing nothing. */
  async function invalidate(server, tool){
    const key = server + "|" + tool;
    const entry = live.get(key);
    if(entry){ entry.fire(); return; }
    await callTool(server, tool, {}).catch(()=>{});
  }

  return { callTool, watchTool, invalidate };
}

/* Checks whether the visitor has a usable session WITHOUT assuming — a
   stale/expired cookie must not look like "logged in" to boot(). Cheapest
   real check: ask the proxy for something trivial. Reuses trelloReadBoard
   action:"get" against a placeholder id would be wasteful; instead the
   proxy exposes a dedicated lightweight whoami-shaped check via the same
   callTool path so there's still only one request shape to reason about. */
async function checkStandaloneSession(){
  try{
    const res = await fetch("/.netlify/functions/daisey-proxy", {
      method:"POST", credentials:"include",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ server:"Session", tool:"whoami", input:{} })
    });
    return res.ok;
  }catch(_){ return false; }
}

/* The in-page login gate. Deliberately NOT a route/second file — the
   BUILD-STANDALONE plan chose "logic inside daisey.html, gated before
   boot() runs" specifically because this is a single-file app by design and
   already has this exact "render an inline state instead of the real app"
   pattern (S.noMcp, see sharedState()). Google first, Trello second: Google
   mints the session (daisey-auth-google-callback.js creates the userId and
   sets the cookie); Trello only ever links INTO an existing session, so
   attempting it first would have nothing to attach to. */
function renderLoginGate(){
  const wrap = el("div","state login-gate");
  wrap.appendChild(el("div","big","🌼"));
  wrap.appendChild(el("h2",null,"Sign in to Daisey"));
  wrap.appendChild(el("p",null,"Connect your Google Calendar and Trello. Nothing is shared with anyone else — this runs entirely against your own accounts."));
  const acts = el("div","acts");
  const g = el("a","btn primary","Sign in with Google");
  g.href = "/.netlify/functions/daisey-auth-google-start";
  acts.appendChild(g);
  wrap.appendChild(acts);
  wrap.appendChild(el("p","dim","Trello connects as a second step, right after."));
  return wrap;
}

/* Trello-linking step: shown once Google succeeded but Trello hasn't been
   connected yet. daisey-auth-google-callback.js redirects back to the app
   with ?needsTrello=1 rather than the app polling for this — a redirect
   query param is simpler than inventing a "half-logged-in" session shape
   the proxy would otherwise need to expose. */
function renderTrelloLinkGate(){
  const wrap = el("div","state login-gate");
  wrap.appendChild(el("div","big","🔗"));
  wrap.appendChild(el("h2",null,"Connect Trello"));
  wrap.appendChild(el("p",null,"One more step — Daisey reads your boards and writes the plan back as cards."));
  const acts = el("div","acts");
  const t = el("a","btn primary","Connect Trello");
  t.href = "/.netlify/functions/daisey-auth-trello-start";
  acts.appendChild(t);
  wrap.appendChild(acts);
  return wrap;
}
