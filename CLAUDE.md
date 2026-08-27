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

## Context cost is a real cost

The "keep replies short" rule above is about token cost, but replies are the
small half of it. Tool output dominates: one `cat` of a large file costs more
than every reply in a session, and nothing leaves the context window until
compaction. So the same reasoning that shortens replies applies harder to how
files get read.

- `grep -n` for the symbol, then read a line window around it. Don't `cat`
  whole files to find one function.
- Don't re-read a file to verify an edit that already succeeded.
- Filter long command output (`| tail -30`, or grep for the lines that
  matter) rather than pasting it whole.
- `/clear` between unrelated tasks — site work and `tools/` work share
  nothing, and carrying one into the other doubles the bill.

`tools/CLAUDE.md` has the detailed version of this, including the exact test
filter, since `tools/` is where the large files live.

## The site

`index.html` (single page), `css/styles.css`, `js/main.js`, `assets/`.
No framework, and for the SITE's own files no build step either — the files
in the repo are the files that get served. (There is now a build command in
`netlify.toml`, but it exists only to generate Daisey's `daisey/index.html`;
it does not touch anything above.)

### Deploying — read this before you deploy

**`master` is the deploy branch.** Netlify auto-builds on push to `master`;
site id `a9fdb3b6-f428-443f-8c0e-32b718459fb1`, live at https://morsedero.com.
A `git push origin master` is a deploy. Treat it as one.

**Everything is on `master` now** (see "Repo layout" below), so the old
"check what branch you're on" trap is gone by construction — there is no
other branch for work to get stranded on. The history is still worth
knowing, because the same shape can come back: on 2026-08-23 the live site
was found serving a build several revisions old, because the entire site
redesign had been committed onto the Daisey branch inside a commit whose
message described only scheduler changes, so `master` never received it. It
was invisible for weeks because every individual step looked right.

Two habits that would have caught it, both still worth keeping:

- Verify a feature you expect is actually in the file you're about to ship
  (`grep -c` for a class name you know is new), not just that the commit
  succeeded — and check the LIVE artifact after, not the deploy log.
- Say what a commit touches in its message. A site change buried in a
  `tools/` commit is a change nobody will find again.

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

## Repo layout — two things, one branch

**Everything lives on `master`. There is no long-lived Daisey branch any
more** (consolidated 2026-08-27). The two bodies of work are separated by
DIRECTORY, not by branch:

- **The portfolio** — `index.html`, `css/`, `js/`, `assets/`, `cv-source/`.
- **Daisey** — `tools/` (source + the test suite), `daisey/` (the generated
  page that actually ships), and its own Netlify functions: `daisey-proxy`,
  the five `daisey-auth-*`, `_daisey-lib/`, plus `audio-sync.js` and
  `trello-webhook.js` (both write Trello data only Daisey reads).

**Why the branch is gone.** Netlify only ever deployed `master`, so a branch
could hold Daisey's *source* but never Daisey itself — every part users touch
already had to be on `master`. The split was really "deployed vs source", and
work on the branch kept getting stranded. Three times: the whole site
redesign sat unshipped for weeks (2026-08-23); the hero/day-only redesign
never reached the published artifact (2026-08-26); and `trello-webhook.js`'s
hidden-marker fix sat unmerged from 2026-08-18 to 2026-08-27 while the live
webhook kept writing the old visible `▶ Starts …` text into real Trello
cards. Every individual step looked right each time, which is exactly why
nobody caught it.

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

## Several sessions edit this repo at once

Expect to find another session's in-flight work in the tree, especially in
`tools/`. Before overwriting any shared file, re-read it immediately prior to
writing and confirm it hasn't changed under you — edits to `tools/daisey.html`
have been silently lost to this at least twice. Prefer targeted edits over
whole-file rewrites on anything you did not just create.
