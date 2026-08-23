# mor-sedero-site

Mor Sedero's personal portfolio site, plus `tools/` — small self-contained
apps that are unrelated to the site itself.

**Daisey and the audio-sync function are documented in `tools/CLAUDE.md`,**
not here. That file only loads when you're working in `tools/`, which keeps
~21k tokens of scheduling-widget detail out of every site session.

## Keep replies short

Caveman mode, on every reply in this repo: short, blunt, minimal words. Drop
articles and filler, skip pleasantries and hedging, no elaboration unless
asked. State the result, not the journey to it. The reason is token cost, so a
long reply is a real cost, not a style preference.

Two things brevity may never hide: a **real blocker**, and anything needing
**approval before a risky or outward-facing action**. Say those plainly and in
full — a terse reply that buries a broken publish or a data-loss risk has
failed at the job, not succeeded at being short. Everything else gets cut.

Note that the *documentation* in this repo is deliberately long-form — that is
a different thing from a reply. Don't read `tools/CLAUDE.md`'s register as
permission to write like that in chat.

## The site

`index.html` (single page), `css/styles.css`, `js/main.js`, `assets/`.
No build step, no framework — the files that are in the repo are the files
that get served.

### Deploying — read this before you deploy

**`master` is the deploy branch.** Netlify auto-builds on push to `master`;
site id `a9fdb3b6-f428-443f-8c0e-32b718459fb1`, live at https://morsedero.com.
A `git push origin master` is a deploy. Treat it as one.

**Check what branch you're on before deploying.** This is not a formality —
on 2026-08-23 the live site was found serving a build several revisions old:
the entire site redesign (logo eyes, skill cards, showreel labels, studio
background) had been committed onto the Daisey branch inside a commit whose
message described only scheduler changes, so `master` never received it. A
session then deployed from a worktree checked out to `master` and shipped
correct-but-ancient files. Nothing was broken and nothing was lost; it was
invisible for weeks because every individual step looked right.

Two habits that would have caught it:

- Verify a feature you expect is actually in the file you're about to ship
  (`grep -c` for a class name you know is new), not just that the commit
  succeeded.
- Keep site changes in commits whose message says "site". A site change
  buried in a `tools/` commit is a change nobody will find again.

`netlify deploy --prod --dir .` also works from a linked folder, but it
deploys *whatever is in that folder right now* with no branch check at all,
which is the sharper edge of the same knife. Prefer the push.

### Verifying a deploy actually landed

Netlify serves the old copy until the build finishes, so "I pushed" is not
"it's live". Check the artifact, not the commit:

    curl -sI https://morsedero.com/css/styles.css | grep -i content-length
    curl -s https://morsedero.com/ | grep -c site-logo-pupil

Compare against the local file. Matching byte counts and a non-zero marker
count are real evidence; a green deploy log is not.

## Branch layout

- **`master`** — the site. Has no `tools/` directory at all.
- **`claude/dayflow-calendar-trello-pnzrg4`** — Daisey plus the test suite.
  Also carries the site files, so they drift from `master` and have to be
  reconciled by hand.

They are genuinely separate bodies of work that share a repo. Cherry-pick
site paths between them (`git checkout <branch> -- index.html css js assets`)
rather than merging wholesale — the Daisey branch deletes
`netlify/functions/trello-webhook.js`, which is live on `master`, so a full
merge silently removes a running function.

## Netlify functions

`netlify/functions/` holds two scheduled/triggered functions that run
server-side, independent of the site and of Daisey's own tab:

- `trello-webhook.js` — syncs Trello card start dates into card descriptions.
- `audio-sync.js` — every 30 min; documented in `tools/CLAUDE.md`.

Both use `TRELLO_API_KEY`/`TRELLO_API_TOKEN` from Netlify env, via raw REST —
they do not go through the MCP connector or any artifact capability manifest.

## Several sessions edit this repo at once

Expect to find another session's in-flight work in the tree, especially in
`tools/`. Before overwriting any shared file, re-read it immediately prior to
writing and confirm it hasn't changed under you — edits to `tools/daisey.html`
have been silently lost to this at least twice. Prefer targeted edits over
whole-file rewrites on anything you did not just create.
