# Now screen redesign — plan

Scope: `daisey/app/` only (v1, served at morsedero.com/daisey/now/). No engine,
store or scheduling logic changes — only how things render, plus the one
put-off bug. Each step: build → preview screenshots (`test/v1/preview`) →
`npm test` for v1 → commit → push master (deploy) → curl-verify live → stop
for your phone test.

## Step 0 (folded into step 1): tokens + font
- `app.css` `:root`: your light tokens; dark block gets your dark tokens.
  Existing Auto/Light/Dark switch keeps working.
- Area tokens `--a-{admin,work,home,social,job,personal}-{tint,line,ink}`,
  light + dark. A `.area-<key>` class sets `--tint/--aline/--aink` so every
  card just reads those three.
- Rubik 400–700 via Google Fonts `<link>` in `index.html` (fallback: system).
- Radius 24/16/999, touch targets ≥ 44px.

## 1. Header + context
- `index.html` topbar: daisy SVG (petals = done today, 0–8, center only at 0)
  + "Daisey" 21/700 + "N done today" pill (hidden at 0) + avatar. Date/time
  line goes (greeting replaces it).
- Greeting 26/600 from time of day + `displayName` first word.
- One line: "4 h 44 free until <event> at 17:00" / "… until 22:00" (day end)
  / "In <event> until 17:00". Removes the `45 min free` in the chip row and
  the "2 h free today" in Schedule's cap line.
- Place/energy chips: filled, icon + label. Guess vs corrected = text
  colour only (dashed border goes).

## 2. Hero card
- `taskCard(main)` gets `.area-<key>`: tint bg, 1px area border, soft shadow.
- Top row: dot + "Area · project" (project still opens its Tasks tab) |
  size right. Title 32/600 `dir=auto`. Why 15px. Next-step line kept.
- Start 56px amber with play icon. Later/Switch/Pending: 3-col quiet row
  (already icon+text — restyle only).
- Deck: 0–2 faint cards behind, one per real alternative (so it never
  promises tasks that aren't there).
- Breathe 3px/5s, off under reduced motion and while an ask is open.
- Same skin for booked, batch, paused, meeting, block cards.

## 3. Empty state + put-off fix
- When no pick and every out task is waiting / someday / future-dated: neutral
  card, swaying daisy, "Nothing active right now", "You have time…", up to 3
  Someday (stakes first, "costs money" tag), tap toggles select, amber
  "Bring N back to this week" (same `restoreTask` write the Someday ask uses),
  ghost "Just rest" (= the ask's Not now, closes it for today).
- Other empty cases ("nothing fits 3 h", no tasks yet) keep their copy, new skin.
- **Bug, found:** Pending / Tomorrow / This week / Someday all add the task to
  today's put-off list too, so "Show the 1 you put off" counts a task that's
  now Waiting or future-dated; clearing the list can't bring it back. Fix:
  the button counts only tasks the engine reports as `skipped`, and clears
  only those.

## 4. Focus mode
- Cream bg, area-tinted card: title, "I'll hold everything else.", 220px
  SVG ring (track = area line, amber 8px progress, 46px tabular time,
  "of 15 min"). Past the estimate the ring stays full; no red, no glow.
- Note field under the card → saves to the task's `notes` on blur/Enter.
- "Hold to finish": existing hold logic, fill restyled left→right.
- Row: +15 min (always, not only when over) · Stuck · Stop — see Q2.
- Batch focus gets the same card + ring, checklist inside.

## 5. Done + Next
- `handoffView`: daisy pops (spring), 6 petals drift 2.6s, "Done in X min",
  "N done today. Your daisy grew a petal." (petal line only while N ≤ 8),
  `navigator.vibrate(15)`. Replaces 🎉 + confetti.
- Next card in its area tint: NEXT · type · size, title, why, Start (2/3) +
  Not now. "Nothing else fits" case keeps its Back.

## 6. Night mode
- Night screen always dark (own dark scope, even in Light theme): dimmed
  daisy + moon, 4 twinkling stars, "Late, <name>.", "Nothing needs you
  tonight. Here's tomorrow.", card with tomorrow's first calendar block then
  the engine's morning pick (no Start), "I'm free now, show me something"
  pill, "Day hours 08:00–22:00".

## 7. Below the card
- Folder tabs → one segmented control "Today | Tasks" (Schedule renamed Today).
- Projects: horizontal chip row with area-colour dots (dot = the project's
  most common area). Existing drag/fling on the row kept.
- Today timeline: red now-line row, dashed free-gap boxes, events as tinted
  blocks (time left, title right, content height). Other days in the slider
  get the same look.
- Tasks: page scrolls, inner scroll box removed; rows `dir=auto`.
- Bottom bar replaces +: pill input "Tell Daisey…" + dark mic. Enter (and mic,
  for now) opens the add form prefilled.

## Last
- DAISEY_SPEC.md "Visual design" section: tokens, area colours, type, radii,
  motion rules (150–250ms UI, springs only for celebrations, never block
  taps, all off under reduced motion).

## Questions
1. **Personal** area has no colour in your list. Proposal: teal
   `#E3F3F3 / #C4E3E3 / #24706F`.
2. Focus row says **Stop**, but 2026-10-05 you replaced Stop with Pause
   (back to main, card keeps the task). Proposal: label it **Pause**, same
   logic. **Stuck** = pause + open Pending's "waiting on what?" on the card.
3. Night mode forced dark even in Light theme? (Proposed yes.)
