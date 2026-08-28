# mor-sedero-site

Mor Sedero's personal portfolio site, plus `tools/` — small self-contained
apps that are unrelated to the site itself.

**Daisey and the audio-sync function are documented in `tools/CLAUDE.md`,**
not here. That file only loads when you're working in `tools/`, which keeps
~21k tokens of scheduling-widget detail out of every site session.

## Keep replies short

Short, blunt replies. Drop articles and filler. State the result, not the journey. **Never hide blockers or actions needing approval** — say those plainly.
(The *documentation* in this repo is deliberately long-form; this rule applies only to chat replies.)

## Context cost is a real cost

Tool output eats tokens fast. One `cat` of a large file costs more than all replies in a session.

- Grep for a symbol, then read a line window around it. Never `cat` whole files.
- Don't re-read files to verify edits (Edit fails loudly on miss; success needs no check).
- Filter command output with `tail`, `grep`, or pipes — never paste it whole.
- `/clear` between unrelated tasks — site and `tools/` share nothing.

## The site

`index.html` (single page), `css/styles.css`, `js/main.js`, `assets/`.
No framework, and for the SITE's own files no build step either — the files
in the repo are the files that get served. (There is now a build command in
`netlify.toml`, but it exists only to generate Daisey's `daisey/index.html`;
it does not touch anything above.)

### Deploying — read this before you deploy

**`master` is the deploy branch.** Netlify auto-builds on push; site id
`a9fdb3b6-f428-443f-8c0e-32b718459fb1`, live at https://morsedero.com. A
`git push origin master` is a deploy.

**Everything lives on `master`** — no feature branches. Commits touching the
site MUST say so in the message. Verify a feature is actually in the file
before shipping (`grep -c` for a class name), then check the LIVE site, not
the deploy log.

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

## Repo layout

**Everything lives on `master`.** Two bodies of work, one branch, separated by
directory:

- **The portfolio** — `index.html`, `css/`, `js/`, `assets/`, `cv-source/`.
- **Daisey** — `tools/` (source + tests), `daisey/` (generated), plus Netlify
  functions (`daisey-proxy`, `daisey-auth-*`, `_daisey-lib/`, `audio-sync.js`,
  `trello-webhook.js`).

**`daisey/index.html` is GENERATED — never hand-edit it.** Netlify runs
`node tools/build-standalone.js` at deploy time (see `netlify.toml`), so the
shipped page is always built from the `tools/daisey.html` in the same commit.
Edit the source, push, done. The script self-checks its output and exits
non-zero on a bad splice, so a broken build fails the deploy rather than
shipping something broken.

**One consequence worth knowing:** a `tools/` change now rebuilds on every
deploy, so a genuinely broken `build-standalone.js` fails the *whole site's*
deploy, not just Daisey's page. That is deliberate — failing loudly beats
silently serving a stale build, which is the failure this replaced.

## Netlify functions

`netlify/functions/` holds two scheduled/triggered functions that run
server-side, independent of the site and of Daisey's own tab:

- `trello-webhook.js` — syncs Trello card start dates into card descriptions.
- `audio-sync.js` — every 30 min; documented in `tools/CLAUDE.md`.

Both use `TRELLO_API_KEY`/`TRELLO_API_TOKEN` from Netlify env, via raw REST —
they do not go through the MCP connector or any artifact capability manifest.

## Shared editing

Multiple sessions edit this repo. Before writing any shared file, re-read it
immediately first — edits to `tools/daisey.html` have been silently lost to
stale reads at least twice. Prefer targeted edits over whole-file rewrites.
