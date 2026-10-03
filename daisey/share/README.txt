DAISEY — set-up in 5 minutes
============================

Daisey plans your day: it reads your Trello boards, decides what to work on,
and writes the plan onto your Google Calendar.


READ THIS FIRST
---------------
daisey.html will NOT work if you just double-click it. It needs to run inside
claude.ai, because that's what connects it to your Trello and your calendar.
Opening it from your desktop shows an empty page saying "Live data isn't
available here." That's expected — follow the steps below instead.


WHAT YOU NEED
-------------
1. A Claude account (the free tier is fine) — https://claude.ai
2. The Trello and Google Calendar connectors added to that account:
      claude.ai  ->  Settings  ->  Connectors
   Add both, and sign in to each when asked.
   You can skip this now — Daisey will tell you if either is missing and
   show you exactly where to go.


HOW TO OPEN IT
--------------
Start a new chat at claude.ai, attach daisey.html, and send this:

      Publish this file as an artifact, unchanged. Declare the mcp
      capability with these tools:
        Trello: trelloReadCard, trelloReadList, trelloReadChecklist,
                trelloReadBoard, trelloWriteCard, trelloWriteChecklist,
                trelloWriteList
        Google Calendar: list_events, list_calendars, create_event,
                update_event, delete_event

That tool list matters — the page can only call what's declared, so a short
list means parts of Daisey silently stop working.

Claude gives you back a link. That link IS your Daisey — bookmark it, or add
it to your phone's home screen. It stays private to your account.

The first time you open it, Claude asks whether the page may use your
connectors. Say yes; that's what lets it see your boards and calendar.
It runs with your own login — it cannot see anyone else's data, and nobody
else can see yours through it.


FIRST RUN
---------
Daisey asks you four things:

  1. WHICH BOARDS should it schedule?
     Tick the boards with real work on them. Skip reference or archive
     boards — anything you tick becomes part of your day.

     "Tracker" is for a board where each card is an ASSET rather than a
     task (say, one card per sound in a game). Those get read and shown,
     but never scheduled, because one work session covers many of them.
     If that's not how you work, ignore it.

  2. WHICH CALENDAR should it write to?
     Usually your personal one. Daisey creates and moves events here, so
     point it at a calendar you don't mind it touching.

  3. WHERE SHOULD DAISEY KEEP ITS SETTINGS?
     It adds one hidden list — "📊 Daisey (widget state — do not edit)" —
     to a board you pick, and keeps your settings, streak and deadlines in
     a single card there. Nothing else on that board is touched.

  4. WHICH DAY IS YOUR DAY OFF?
     Nothing gets scheduled that day.

You can change any of it later: gear icon -> "Boards & calendar".


HOW IT DECIDES WHAT TO DO
-------------------------
The Trello LABEL on a card sets how long it takes:

      no label      a quick task  (15 min each, up to 4 a day, back to
                                   back in one window on your calendar)
      yellow        a session     (3 hours)
      orange        a work day    (8 hours — nothing else is scheduled)
      green         ignored entirely — never scheduled

All of those lengths are yours to change, in the gear icon.

Cards with a due date come first, overdue ones before that. A card whose
name or description says "waiting" / "pending" sits out until you edit that
out.

Press the ↻ button any time to rebuild the day.


THINGS WORTH KNOWING
--------------------
* It only builds today and tomorrow. Past days are read-only.
* It never schedules over a real meeting. Tap the ⊙ on a meeting to say
  "quick tasks may run inside this one".
* Press and hold a card to drag it to another time.
* Your data stays yours. Daisey runs in your browser with your own
  connectors; nobody else can see your boards or calendar through it.


IF SOMETHING LOOKS WRONG
------------------------
"Add Trello in claude.ai -> Settings -> Connectors"
      The connector isn't set up yet. Add it, then press Try again.

"Reconnect Google Calendar..."
      Your sign-in expired. Reconnect it in the same place.

The page looks stale after an update
      Open it in a private/incognito window once. Chrome caches this
      page aggressively.
