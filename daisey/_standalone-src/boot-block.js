  STANDALONE = true;
  const qs = new URLSearchParams(location.search);
  const guestMode = qs.get("guest") === "1" || isGuestMode();
  if(qs.get("needsTrello")){
    history.replaceState(null, "", location.pathname);
    S.needsTrello = true; S.ready = true; render();
    return;
  }
  if(guestMode){
    setGuestMode(true);
    history.replaceState(null, "", location.pathname);
    S.guestMode = true;
    S.mcp = guestMcp();
    S.noMcp = false;
    S.events = { payload: { events: [] }, storedAt: Date.now() };
    S.cards = {};
    S.stats = { ...DEFAULT_STATS };
    S.ready = true;
    render();
    return;
  }
  const loggedIn = await checkStandaloneSession();
  if(!loggedIn){
    S.needsLogin = true; S.ready = true; render();
    return;
  }
  mcp = standaloneMcp();
