  STANDALONE = true;
  const qs = new URLSearchParams(location.search);
  if(qs.get("needsTrello")){
    history.replaceState(null, "", location.pathname);
    S.needsTrello = true; S.ready = true; render();
    return;
  }
  const loggedIn = await checkStandaloneSession();
  if(!loggedIn){
    S.needsLogin = true; S.ready = true; render();
    return;
  }
  mcp = standaloneMcp();
