#!/bin/bash
# SessionStart: tells Claude which of the repo's two projects this session is.
# Set by the cloud environment: CLAUDE_PROJECT=daisey ("Daisey" env) or unset (site).
if [ "$CLAUDE_PROJECT" = "daisey" ]; then
  cat <<'MSG'
THIS SESSION IS THE DAISEY PROJECT (cloud environment "Daisey").
- Work only in daisey/ (source, tests, functions). Never touch site/ (the portfolio); site/daisey/ is generated, never hand-edit.
- "Daisey" = the NEW app, daisey/app/ (morsedero.com/daisey/now). Old daisey.html only when Mor says "old daisey".
- daisey/CLAUDE.md is the project doc. It is ~156KB: grep it for the topic, read windows, never cat it whole.
- Ships via master -> Netlify -> morsedero.com/daisey. Push to master = deploy; confirm first.
MSG
fi
exit 0
