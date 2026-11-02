// Hebrew mode (Mor, 2026-11-02). English stays the source everywhere; in
// Hebrew the page is translated as text reaches it. A MutationObserver reads
// every text node and label attribute the app writes (h(), textContent,
// innerHTML, the static HTML) and swaps it for its Hebrew, so no call site
// changes. Lookup is by the trimmed English: an exact entry in HE, else the
// first PATTERNS regex that matches (templated text: "3 min", "Plan: 2 of 5
// done."). No match = left in English, never broken.
//
// What it never touches: <bdi>, inputs and textareas — what you typed
// (titles, names, notes), which the app already wraps that way. Their
// placeholders and labels do translate. Inside dir="auto", which holds both
// titles and Daisey's own lines, only a whole-line match counts.
//
// The choice is per device, like the theme: localStorage "daisey.lang", read
// for the first paint by the inline script in index.html (dir="rtl" before
// the stylesheet lays anything out). Changing it reloads (Settings, main.js).
// In English this file does nothing at all past reading that key.

const KEY = "daisey.lang";
export const LANG = (() => { try { return localStorage.getItem(KEY) === "he" ? "he" : "en"; } catch { return "en"; } })();
export const HE = LANG === "he";
// The app's own direction, for a line of Daisey's words that must not take a
// Hebrew title's direction (a task's meta line): ltr in English, rtl in Hebrew.
export const DIR = HE ? "rtl" : "ltr";
export function setLang(l){
  try { l === "he" ? localStorage.setItem(KEY, "he") : localStorage.removeItem(KEY); } catch { /* private window */ }
}

const DAYS = { Sunday: "ראשון", Monday: "שני", Tuesday: "שלישי", Wednesday: "רביעי", Thursday: "חמישי", Friday: "שישי", Saturday: "שבת",
  Sun: "יום א׳", Mon: "יום ב׳", Tue: "יום ג׳", Wed: "יום ד׳", Thu: "יום ה׳", Fri: "יום ו׳", Sat: "שבת" };
const MONTHS = { Jan: "ינו׳", Feb: "פבר׳", Mar: "מרץ", Apr: "אפר׳", May: "מאי", Jun: "יוני", Jul: "יולי", Aug: "אוג׳", Sep: "ספט׳", Oct: "אוק׳", Nov: "נוב׳", Dec: "דצמ׳" };

const HE_TEXT = {
  // Header, rail, pages
  "Daisey": "Daisey", "Focus": "פוקוס", "Settings": "הגדרות", "Sign out": "התנתקות", "Loading…": "טוען…",
  "Today": "היום", "Tomorrow": "מחר", "Yesterday": "אתמול", "Tonight": "הלילה", "Week": "שבוע", "Now": "עכשיו",
  "Plan my day": "לתכנן את היום", "Projects": "פרויקטים", "Schedule": "לו״ז", "Plan": "תוכנית", "Stats": "סטטיסטיקה",
  "Task": "משימה", "Event": "אירוע", "Project": "פרויקט", "Tell Daisey": "לספר ל-Daisey", "Tell Daisey…": "ספרו ל-Daisey…",
  "Speak to Daisey": "לדבר עם Daisey", "Type to Daisey": "לכתוב ל-Daisey", "Needs you": "מחכה לך", "Close": "סגירה",
  "Swipe up or tap Today for your day": "החליקו למעלה או הקישו על היום כדי לראות את היום", "Today so far": "היום עד עכשיו",
  "Plan and projects": "תוכנית ופרויקטים", "Add": "הוספה", "Refresh": "רענון", "Theme": "ערכת נושא", "Auto": "אוטומטי",
  "Light": "בהיר", "Dark": "כהה", "Loading Daisey": "Daisey נטענת", "Waking Daisey up…": "מעירים את Daisey…",
  "Job Hunt: retry": "חיפוש עבודה: לנסות שוב", "Send the brief now": "לשלוח את הסיכום עכשיו",
  "A job's stage change didn't reach Drive. Tap to try again.": "שינוי שלב במשרה לא הגיע ל-Drive. הקישו כדי לנסות שוב.",
  "Focus mode on: tap to show everything": "מצב פוקוס פעיל: הקישו כדי להציג הכול", "Focus mode: only the Now card": "מצב פוקוס: רק כרטיס העכשיו",
  "Today: a plan is ready to look at": "היום: תוכנית מחכה לעיון", "Today's plan. Open it to change it": "התוכנית של היום. פתחו כדי לשנות",
  "Plan my day: a plan is ready to look at": "לתכנן את היום: תוכנית מחכה לעיון",

  // Splash and sign-in
  "Fluffing the petals…": "מנפחים את עלי הכותרת…", "Checking your calendar…": "בודקים את היומן…",
  "Reading your Trello cards…": "קוראים את כרטיסי ה-Trello…", "Finding the right next thing…": "מחפשים את הדבר הבא…",
  "Almost there…": "כמעט שם…", "Sign in with Google": "כניסה עם Google", "Continue as guest": "המשך כאורח",
  "Sign in to sync your tasks, or try Daisey as a guest. Guest data stays on this device.": "התחברו כדי לסנכרן משימות, או נסו את Daisey כאורח. נתוני אורח נשמרים רק במכשיר הזה.",
  "Daisey isn't set up on this site yet.": "Daisey עוד לא מוגדרת באתר הזה.", "Couldn't load:": "לא נטען:",
  "Popup was blocked. Allow popups for this site and try again.": "החלון הקופץ נחסם. אפשרו חלונות קופצים לאתר ונסו שוב.",
  "Sign-in failed:": "הכניסה נכשלה:", "Guest sign-in failed.": "כניסת אורח נכשלה.", "Guest": "אורח",
  "Guest · this device": "אורח · המכשיר הזה", "Exit guest mode": "יציאה ממצב אורח", "Guest account": "חשבון אורח", "Sign in first": "קודם להתחבר",

  // Settings
  "Settings sections": "חלקי ההגדרות", "Personal": "אישי", "My day": "היום שלי", "Meal breaks": "הפסקות אוכל",
  "Day starts": "תחילת היום", "Day ends": "סוף היום", "Tasks": "משימות", "Maximum projects in Focus": "מקסימום פרויקטים בפוקוס",
  "Notifications": "התראות", "On this device": "במכשיר הזה", "What to send": "מה לשלוח", "Morning brief": "סיכום בוקר",
  "End of day": "סוף היום", "Free time": "זמן פנוי", "Task starts": "תחילת משימה", "Missed tasks": "משימות שפוספסו",
  "Meetings": "פגישות", "Waiting on someone": "מחכה למישהו", "5 min before": "5 דק׳ לפני", "10 min before": "10 דק׳ לפני",
  "15 min before": "15 דק׳ לפני", "30 min before": "30 דק׳ לפני", "Meeting reminder": "תזכורת לפגישה",
  "Google & Trello": "Google ו-Trello", "Google Calendar": "יומן Google", "Log finished tasks": "לרשום משימות שהסתיימו",
  "Choose calendars…": "בחירת יומנים…", "Connect": "חיבור", "Reconnect": "חיבור מחדש", "Connected": "מחובר", "Not connected": "לא מחובר", "Expired": "פג תוקף",
  "Daisey reads the calendars you tick, and plans around them.": "Daisey קוראת את היומנים המסומנים ומתכננת סביבם.",
  "Save": "שמירה", "Cancel": "ביטול", "Job Hunt (Google Drive)": "חיפוש עבודה (Google Drive)", "Reconnect Google Drive": "חיבור מחדש ל-Google Drive",
  "Trello": "Trello", "Import cards…": "ייבוא כרטיסים…", "More": "עוד", "Reset sample day": "איפוס יום הדוגמה", "Reset Daisey…": "איפוס Daisey…",
  "Erases your tasks, plan, learning and settings in Daisey, then starts over. Your calendar and Trello are not changed.": "מוחק את המשימות, התוכנית, הלמידה וההגדרות ב-Daisey ומתחיל מחדש. היומן וה-Trello לא משתנים.",
  "Also disconnect Google Calendar and Trello, so they are read from scratch (you reconnect them after)": "לנתק גם את יומן Google ואת Trello, כדי שייקראו מאפס (מחברים אותם שוב אחר כך)",
  "Erase and start over": "למחוק ולהתחיל מחדש", "Language": "שפה",
  "Couldn't lay the sample day. Try again.": "לא הצלחנו לפרוס את יום הדוגמה. נסו שוב.", "Erasing…": "מוחק…",
  "Couldn't reset. Nothing more was changed after the step that failed; try again.": "האיפוס נכשל. שום דבר לא השתנה אחרי השלב שנכשל; נסו שוב.",
  "Notifications need Google sign-in.": "התראות דורשות כניסה עם Google.", "This browser can't show notifications.": "הדפדפן הזה לא יכול להציג התראות.",
  "Notifications are blocked for this site in the browser settings.": "ההתראות חסומות לאתר הזה בהגדרות הדפדפן.",
  "Not set up on the server yet.": "עוד לא מוגדר בשרת.", "Couldn't change it. Try again.": "לא הצלחנו לשנות. נסו שוב.",
  "The brief didn't arrive. Switch notifications off and on again.": "הסיכום לא הגיע. כבו והדליקו את ההתראות שוב.",
  "Sent, but the calendar couldn't be read.": "נשלח, אבל לא הצלחנו לקרוא את היומן.", "Couldn't send the brief.": "לא הצלחנו לשלוח את הסיכום.",
  "Couldn't load your calendars. Try again.": "לא הצלחנו לטעון את היומנים. נסו שוב.", "Saving…": "שומר…", "Calendars saved.": "היומנים נשמרו.",
  "Couldn't save. Try again.": "השמירה נכשלה. נסו שוב.", "Google Calendar connected.": "יומן Google מחובר.",
  "Couldn't connect Google Calendar. Try again.": "לא הצלחנו לחבר את יומן Google. נסו שוב.", "Trello connected.": "Trello מחובר.",
  "Couldn't connect Trello. Try again.": "לא הצלחנו לחבר את Trello. נסו שוב.", "Connect the calendar first": "קודם לחבר את היומן",
  "Breakfast": "ארוחת בוקר", "Lunch": "ארוחת צהריים", "Dinner": "ארוחת ערב", "Day hours": "שעות היום",

  // Areas, types, places, stakes (model.js)
  "Work": "עבודה", "Home": "בית", "Admin": "סידורים", "Social": "חברתי", "Deep": "ריכוז", "Call": "שיחה", "Errand": "סידור",
  "Anywhere": "בכל מקום", "Out": "בחוץ", "Anytime": "בכל שעה", "Office hours": "שעות משרד", "Evening": "ערב", "Morning": "בוקר", "Afternoon": "צהריים",
  "Low stakes": "לא דחוף", "Costs money": "עולה כסף", "Affects someone": "משפיע על מישהו", "Deadline penalty": "קנס על איחור",
  "Deadline": "דדליין", "Target": "יעד", "Inbox": "דואר נכנס", "Job search": "חיפוש עבודה", "Job Hunt": "חיפוש עבודה",
  "Blocked": "תקוע", "Again?": "שוב?", "More time?": "עוד זמן?", "A task needs a title.": "למשימה צריך שם.",
  "File": "קובץ", "Waiting on": "מחכה ל:", "check now": "לבדוק עכשיו", "this week": "השבוע", "this month": "החודש", "left": "נשארו", "done": "בוצעו", "Back to active": "חזרה לפעיל", "Planned": "מתוכנן", "Routine": "שגרה", "Routines": "שגרות",

  // Task sheet (addtask.js)
  "Area": "תחום", "Type": "סוג", "Where": "איפה", "Open hours": "שעות פתיחה", "Size": "גודל", "Stakes": "חשיבות",
  "New task": "משימה חדשה", "Name the new project": "שם לפרויקט החדש", "New project name": "שם הפרויקט החדש", "What's the task?": "מה המשימה?",
  "Add a time": "להוסיף שעה", "Start": "התחלה", "Any time": "בכל שעה", "Due": "עד", "No date": "בלי תאריך", "No end": "בלי סוף",
  "Times a week": "פעמים בשבוע", "times a week": "פעמים בשבוע", "Fewer times a week": "פחות פעמים בשבוע", "More times a week": "יותר פעמים בשבוע",
  "Which days": "באילו ימים", "Any days": "כל יום", "Set days": "ימים קבועים", "At what time": "באיזו שעה",
  "Daisey puts these in your Daisey calendar.": "Daisey שמה אותן ביומן של Daisey.", "Needs laptop": "צריך מחשב",
  "Pick a Start date: every month on that day.": "בחרו תאריך התחלה: כל חודש באותו יום.", "Would be nice by then.": "יהיה נחמד עד אז.",
  "Missing it costs me.": "פספוס יעלה לי.", "What kind of date": "איזה סוג תאריך",
  "How long you think it takes — Daisey's guess until you pick": "כמה זמן זה ייקח — הניחוש של Daisey עד שתבחרו",
  "What Daisey guessed about this task": "מה Daisey ניחשה על המשימה", "who or what?": "מי או מה?", "Nudge on WhatsApp": "תזכורת בוואטסאפ",
  "Ask me again": "לשאול אותי שוב", "Waiting for a reply": "מחכה לתשובה", "From who (optional)": "ממי (לא חובה)", "Put on hold": "להשהות",
  "Percent finished": "אחוז שהושלם", "How much is done?": "כמה כבר נעשה?", "how much is done?": "כמה כבר נעשה?", "Notes…": "הערות…", "Notes": "הערות",
  "Done": "בוצע", "How long?": "כמה זמן?", "Links & notes": "קישורים והערות", "+ New project…": "+ פרויקט חדש…", "Daisey guesses": "Daisey מנחשת",
  "Paste a link": "הדביקו קישור", "Link": "קישור", "That isn't a web link. For a file on this phone, use + File.": "זה לא קישור לאינטרנט. לקובץ בטלפון, השתמשו ב-+ קובץ.",
  "That file's too big (25 MB at most). Add a Drive or Dropbox link instead.": "הקובץ גדול מדי (עד 25MB). הוסיפו קישור ל-Drive או Dropbox במקום.",
  "Couldn't keep that file on this phone.": "לא הצלחנו לשמור את הקובץ בטלפון.", "That file is on the phone it was added from.": "הקובץ נמצא בטלפון שממנו הוסף.",
  "+ Link": "+ קישור", "+ File": "+ קובץ", "+ Link or file": "+ קישור או קובץ", "Reopen": "לפתוח מחדש", "On hold.": "מושהה.", "Bring back": "להחזיר",
  "Add task": "הוספת משימה", "Sure?": "בטוח?", "Really delete?": "למחוק באמת?", "Delete": "מחיקה", "Delete task": "מחיקת משימה",
  "Name the new project, or pick one from the list.": "תנו שם לפרויקט החדש, או בחרו מהרשימה.", "Give it a name first.": "קודם לתת שם.",
  "Edit task": "עריכת משימה", "Couldn't save": "לא נשמר", "Couldn't delete": "לא נמחק", "Couldn't add": "לא נוסף",
  "Deleted": "נמחק", "Added": "נוסף", "Saved": "נשמר", "Removed": "הוסר", "Deleted:": "נמחק:",
  "How often": "כל כמה זמן", "Every week": "כל שבוע", "Every month": "כל חודש", "Days": "ימים", "Until": "עד", "Repeats": "חוזר",

  // Event sheet (addevent.js)
  "That calendar is read-only.": "היומן הזה לקריאה בלבד.", "Calendar sign-in expired. Sign in again to reconnect it.": "החיבור ליומן פג. התחברו שוב.",
  "Signed out.": "התנתקת.", "Calendar not connected. Sign in again to link it.": "היומן לא מחובר. התחברו שוב כדי לקשר אותו.",
  "That event is already gone.": "האירוע כבר לא קיים.", "Something in that didn't make sense to Google.": "משהו שם לא הסתדר ל-Google.",
  "From": "מ-", "To": "עד", "City or address": "עיר או כתובת", "A city lets Daisey plan the ride there and back.": "עיר מאפשרת ל-Daisey לתכנן את הנסיעה הלוך ושוב.",
  "Add the city too, so Daisey can plan the ride.": "הוסיפו גם עיר, כדי ש-Daisey תתכנן את הנסיעה.", "Place": "מקום", "Add event": "הוספת אירוע",
  "Add to calendar": "הוספה ליומן", "Day": "יום", "Pick a day": "בחרו יום", "Saved on this device only.": "נשמר רק במכשיר הזה.",
  "Goes in your main Google calendar. Guests and the rest are a tap away in Google Calendar.": "נכנס ליומן Google הראשי. מוזמנים וכל השאר — ביומן Google.",
  "New event": "אירוע חדש", "This event": "האירוע הזה", "This and following events": "האירוע הזה והבאים", "All events": "כל האירועים",
  "Delete recurring event": "מחיקת אירוע חוזר", "Edit recurring event": "עריכת אירוע חוזר", "All day": "כל היום", "Remove": "הסרה",
  "Couldn't remove": "לא הוסר", "Removed every": "הוסרו כל המופעים של", "Removed from here on:": "הוסר מכאן והלאה:", "Open in Maps": "לפתוח במפות",
  "Edit": "עריכה", "Read-only. Open it in Google Calendar to change it.": "לקריאה בלבד. פתחו ביומן Google כדי לשנות.", "Edit event": "עריכת אירוע",
  "It has to end after it starts.": "הסוף צריך להיות אחרי ההתחלה.", "Saved every": "נשמרו כל המופעים של", "Saved from here on:": "נשמר מכאן והלאה:",
  "Couldn't add to the calendar:": "לא נוסף ליומן:", "That event no longer exists.": "האירוע כבר לא קיים.",

  // Now card (now.js) and its menus
  "Later": "אחר כך", "Switch": "החלפה", "Pending": "ממתין", "Start task": "להתחיל", "Not now": "לא עכשיו", "Later: when, or why?": "אחר כך: מתי, או למה?",
  "Later today": "מאוחר יותר היום", "This week": "השבוע", "Waiting on…": "מחכה ל…", "Done:": "בוצע:", "Next:": "הבא:",
  "offices are closed now": "המשרדים סגורים עכשיו", "for the evening": "לערב", "not for where you are now": "לא למקום שבו את/ה עכשיו",
  "Other tasks": "משימות אחרות", "Nothing else is active.": "אין עוד משימות פעילות.", "No Done yet.": "עוד לא בוצע.", "When next?": "מתי הבא?",
  "Or later": "או אחר כך", "· no date": "· בלי תאריך", "How did it go?": "איך היה?", "how did it go?": "איך היה?", "Some of it": "חלק ממנה",
  "Keep going": "להמשיך", "Background": "ברקע", "Your project priorities changed, so this is a fresh plan.": "סדר העדיפויות בפרויקטים השתנה, אז זו תוכנית חדשה.",
  "Re-planned from now.": "תוכנן מחדש מעכשיו.", "Its time passed with no Done.": "הזמן שלה עבר בלי סימון בוצע.", "Your plan slipped": "התוכנית החליקה",
  "Re-plan from now": "לתכנן מחדש מעכשיו", "Keep the plan": "להשאיר את התוכנית", "Edit the plan": "לערוך את התוכנית", "Your priorities changed": "סדר העדיפויות השתנה",
  "Re-plan": "לתכנן מחדש", "Keep this plan": "להשאיר את התוכנית הזו", "Its time passed while the plan ran late.": "הזמן שלה עבר כשהתוכנית התעכבה.",
  "I ate": "אכלתי", "Time opened up. Add": "התפנה זמן. להוסיף", "Added to the end of your plan:": "נוסף לסוף התוכנית:",
  "No, leave the plan as it is": "לא, להשאיר את התוכנית כמו שהיא", "Time opened up: added": "התפנה זמן: נוסף", "OK, got it": "בסדר, הבנתי",
  "Added what you just put in.": "נוסף מה שהכנסת עכשיו.", "Your day changed, so I updated the plan.": "היום השתנה, אז עדכנתי את התוכנית.",
  "Keep today": "להשאיר להיום", "Took": "הוצאו", "Nothing small left for today. Take the rest of the day.": "לא נשאר משהו קטן להיום. קחו את שארית היום.",
  "Next at": "הבא ב-", "Nothing planned after": "אין שום דבר מתוכנן אחרי", "Meal": "ארוחה", "Breather": "הפוגה", "Break": "הפסקה",
  "Here's your day from now": "זה היום שלך מעכשיו", "Want me to fit things in?": "לשבץ דברים?", "Plan the rest of today": "לתכנן את שארית היום",
  "Or a lighter plan": "או תוכנית קלה יותר", "Rough day?": "יום קשה?", "Want a lighter plan?": "תוכנית קלה יותר?", "Not today": "לא היום",
  "Lighter plan": "תוכנית קלה יותר", "Same plan. Tell me what to change, like “lighter” or “start with …”.": "אותה תוכנית. ספרו לי מה לשנות, למשל „קל יותר” או „להתחיל עם …”.",
  "Same tasks, new order.": "אותן משימות, סדר חדש.", "Couldn't rethink it. Try again.": "לא הצלחתי לחשוב מחדש. נסו שוב.",
  "Or tell Daisey what to change…": "או ספרו ל-Daisey מה לשנות…", "What should change?": "מה לשנות?", "Thinking": "חושבת", "Thinking…": "חושבת…",
  "Rethink with this": "לחשוב מחדש עם זה", "Fewer tasks": "פחות משימות", "More tasks": "יותר משימות", "Never mind": "לא משנה", "No room": "אין מקום",
  "Do first": "קודם זה", "Proposed schedule": "לו״ז מוצע", "Approve": "לאשר", "Running late: rethink for what's left": "מאחרים: לחשוב מחדש על מה שנשאר",
  "Rethink": "לחשוב מחדש", "No plan": "אין תוכנית", "Example day: these tasks are samples to try Daisey with.": "יום לדוגמה: אלה משימות לדוגמה לנסות איתן את Daisey.",
  "Clear examples": "לנקות דוגמאות", "Ignoring": "מתעלמת מ-", "put it back": "להחזיר", "Loading tasks…": "טוען משימות…",
  "Nothing else needs you today.": "שום דבר אחר לא מחכה לך היום.", "No tasks yet": "עוד אין משימות", "Add a few and Daisey will pick.": "הוסיפו כמה ו-Daisey תבחר.",
  "Nothing fits right now": "שום דבר לא מתאים עכשיו", "Not synced to Drive yet": "עוד לא סונכרן ל-Drive", "I've arrived": "הגעתי",
  "Working on": "עובדים על", "How many minutes each way? Answer it in Needs you.": "כמה דקות לכל כיוון? עונים ב„מחכה לך”.",
  "Laptop with you": "יש מחשב", "Phone only": "רק טלפון", "Laptop with you?": "יש מחשב איתך?", "Laptop": "מחשב",
  "Yes, the laptop is with me": "כן, המחשב איתי", "No laptop, phone tasks only": "בלי מחשב, רק משימות טלפון", "On the train": "ברכבת", "On the bus": "באוטובוס",
  "Riding": "בנסיעה", "as a passenger": "כנוסע/ת", "on the train": "ברכבת", "on the bus": "באוטובוס", "Not going": "לא נוסע/ת",
  "Rest. Daisey picks again when you arrive.": "מנוחה. Daisey תבחר שוב כשתגיעו.", "Show tasks again": "להציג משימות שוב",
  "Still on the way. The plan waits until you're there.": "עדיין בדרך. התוכנית מחכה עד שתגיעו.", "Looking for phone tasks…": "מחפשת משימות לטלפון…",
  "Any of these doable on the phone?": "משהו מאלה אפשר לעשות בטלפון?", "Nothing fits the rest of the ride.": "שום דבר לא מתאים לשארית הנסיעה.",
  "None of these": "אף אחת מאלה", "Just rest": "רק לנוח", "Eyes on the road": "עיניים על הכביש", "I'll have something ready when you stop.": "יהיה משהו מוכן כשתעצרו.",
  "I'm a passenger": "אני נוסע/ת", "Just about done.": "כמעט סיימת.", "Tomorrow:": "מחר:", "On hold:": "מושהה:", "Pending:": "ממתין:",
  "Waiting on what? (optional)": "מחכה למה? (לא חובה)", "Set pending": "לסמן כממתין", "Undo": "ביטול", "How much is left?": "כמה נשאר?",
  "Not sure": "לא בטוח", "Not sure: keep Daisey's guess": "לא בטוח: להשאיר את הניחוש של Daisey", "Got it": "הבנתי", "Why? (optional)": "למה? (לא חובה)",
  "Too big": "גדול מדי", "Too big: offer it in pieces": "גדול מדי: להציע בחלקים", "Not here": "לא כאן", "Not here: don't offer it where I am now": "לא כאן: לא להציע במקום שאני נמצא/ת",
  "1 still open for today": "1 עוד פתוחה להיום", "Sort them": "לסדר אותן", "Sort what's still open for today": "לסדר את מה שעוד פתוח להיום",
  "Due today": "להיום", "Also due:": "גם להיום:", "First today": "ראשון היום", "Nothing lined up yet.": "עוד לא מסודר כלום.",
  "Getting there": "בדרך לשם", "Getting to": "בדרך ל-", "I'm free now, show me something": "אני פנוי/ה עכשיו, תראי לי משהו",
  "I'm free now: pick a task anyway": "אני פנוי/ה עכשיו: לבחור משימה בכל זאת", "Nothing else fits right now, so this is next.": "שום דבר אחר לא מתאים עכשיו, אז זה הבא.",
  "Coming up": "בקרוב", "Starting now.": "מתחיל עכשיו.", "put off today": "נדחה היום", "needs offices open": "צריך משרדים פתוחים", "need offices open": "צריכות משרדים פתוחים",
  "can't be done where you are": "אי אפשר לעשות במקום הנוכחי", "too long for the time you have": "ארוך מדי לזמן שיש", "is for the evening": "מיועדת לערב",
  "are for the evening": "מיועדות לערב", "belongs to another project": "שייכת לפרויקט אחר", "belong to another project": "שייכות לפרויקט אחר",
  "Where are you?": "איפה את/ה?", "On the move?": "בתנועה?", "Home?": "בבית?", "Yes": "כן", "No": "לא", "Show me anyway": "להראות בכל זאת",
  "penalty if late": "קנס על איחור", "Nothing active": "אין משימות פעילות", "Rest it is": "אז מנוחה", "You have time": "יש זמן",
  "Everything open is waiting or set for later. Bring 1–2 back from On hold?": "כל מה שפתוח ממתין או נדחה. להחזיר 1–2 מהמושהות?",
  "Everything open is waiting or set for later.": "כל מה שפתוח ממתין או נדחה.", "From On hold": "מהמושהות", "Pick 1–2 to bring back": "בחרו 1–2 להחזיר",
  "Pick from On hold": "לבחור מהמושהות", "One more, or that's the week?": "עוד אחת, או שזה השבוע?", "Pick 1–2 from On hold for this week.": "בחרו 1–2 מהמושהות לשבוע הזה.",
  "Good morning": "בוקר טוב", "Good afternoon": "צהריים טובים", "Good evening": "ערב טוב", "Let's go": "יאללה", "Do it now": "לעשות עכשיו",
  "Driving": "נוהג/ת", "Train": "רכבת", "Bus": "אוטובוס", "Tomorrow first": "קודם מחר", "I'm free now": "אני פנוי/ה עכשיו",
  "Couldn't get your location. Allow it for this site and try again.": "לא הצלחנו לקבל מיקום. אפשרו אותו לאתר ונסו שוב.",
  "It's not a trip": "זו לא נסיעה", "Keep the plan as it is": "להשאיר את התוכנית",

  // Day, week, schedule
  "Done today": "בוצע היום", "Proposed for …": "מוצע ל…", "No open task fits the free time left today.": "אין משימה פתוחה שמתאימה לזמן הפנוי שנשאר היום.",
  "No open task fits tomorrow.": "אין משימה פתוחה שמתאימה למחר.", "Nothing fits what's left of today.": "שום דבר לא מתאים למה שנשאר מהיום.",
  "Nothing fits tomorrow.": "שום דבר לא מתאים למחר.", "Move the rest": "להעביר את השאר", "Nothing scheduled": "שום דבר לא מתוכנן", "Day or Week": "יום או שבוע",
  "Take five": "הפסקה קצרה", "Loading the calendar…": "טוען את היומן…",
  "Connect Google Calendar to see your day here, and so Daisey plans around your events.": "חברו את יומן Google כדי לראות כאן את היום, וכדי ש-Daisey תתכנן סביב האירועים.",
  "The calendar connection expired.": "החיבור ליומן פג.", "Couldn't load the calendar.": "לא הצלחנו לטעון את היומן.", "Reconnect Google Calendar": "חיבור מחדש ליומן Google",
  "Connect Google Calendar": "חיבור יומן Google", "Earlier today": "מוקדם יותר היום", "Previous week": "השבוע הקודם", "Previous day": "היום הקודם",
  "● Now": "● עכשיו", "← Today": "← היום", "Next week": "השבוע הבא", "Next day": "היום הבא", "Couldn't load these days.": "לא הצלחנו לטעון את הימים האלה.",
  "Busy": "תפוס", "Change plan": "לשנות תוכנית", "Plan the rest": "לתכנן את השאר", "Nothing left tonight.": "לא נשאר כלום הלילה.", "+ Add": "+ הוספה",
  "No Done yet: how did it go?": "עוד לא בוצע: איך היה?", "Back to now": "חזרה לעכשיו",
  "Daisey's plan": "התוכנית של Daisey", "Plan for today": "תוכנית להיום", "Nothing needs this time. Keep it.": "שום דבר לא צריך את הזמן הזה. שמרו אותו.",
  "Daisey's plan. Nothing here is in your calendar.": "התוכנית של Daisey. שום דבר כאן לא ביומן.",
  "Still planned": "עדיין מתוכנן", "Nothing planned right now": "שום דבר לא מתוכנן עכשיו",

  // Brief, deadlines, misc
  "No free time today.": "אין זמן פנוי היום.", "Nothing due today.": "שום דבר לא להיום.", "Deadline passed": "הדדליין עבר", "Deadline today": "דדליין היום",
  "Deadline tomorrow, not started": "דדליין מחר, עוד לא התחיל", "1 thing needs you.": "דבר אחד מחכה לך.", "1 thing needs you": "דבר אחד מחכה לך",
  "Which dates are real deadlines?": "אילו תאריכים הם דדליין אמיתי?",
  "Tick the ones that really can't slip. The rest become targets: wish dates that move on quietly if they pass.": "סמנו את אלה שבאמת אי אפשר לדחות. השאר יהפכו ליעדים: תאריכים רצויים שזזים בשקט אם עברו.",
  "None are": "אף אחד", "Question": "שאלה", "More answers": "עוד תשובות", "Move it to 18:00": "להעביר ל-18:00", "Keep current plan": "להשאיר את התוכנית הנוכחית",
  "Read the moment": "לקרוא את הרגע", "Worked on": "עבדת על", "View CV": "צפייה בקו״ח",
  "Nothing planted yet today. Start any task and it shows up here.": "עוד לא נשתל כלום היום. התחילו משימה והיא תופיע כאן.",
  "What's due today doesn't fit any more.": "מה שצריך להיום כבר לא נכנס.", "Nothing's started yet today.": "שום דבר עוד לא התחיל היום.",
  "Late.": "מאחר.", "Early.": "מוקדם.", "Here's your day.": "זה היום שלך.", "Here's tomorrow.": "זה מחר.", "One deadline is still open today.": "דדליין אחד עוד פתוח היום.",
  "Someday comes back": "„מתישהו” חוזר", "Bring it back?": "להחזיר?", "Did it?": "בוצע?", "Back": "חזרה",

  // Needs you (needs.js)
  "Make this a task?": "להפוך למשימה?", "Old dates": "תאריכים ישנים", "Ask me later": "לשאול אחר כך", "There's a penalty if it's late.": "יש קנס על איחור.",
  "It costs money to leave it.": "להשאיר את זה עולה כסף.", "You marked it as affecting someone.": "סימנת שזה משפיע על מישהו.", "I'd make it a 10-minute task": "הייתי הופכת את זה למשימה של 10 דקות",
  "Let it go": "לוותר", "Pending, waiting on a reply": "ממתין לתשובה", "Welcome back": "ברוכים השבים", "Is this a task?": "זו משימה?",
  "Yes, make it a task": "כן, להפוך למשימה", "No, it's an event": "לא, זה אירוע", "How are you travelling?": "איך את/ה נוסע/ת?", "You're moving fast.": "את/ה זז/ה מהר.",
  "I can't tell a train from a bus or a car.": "אני לא מבחינה בין רכבת, אוטובוס ורכב.", "Not moving": "לא בתנועה", "Are you home right now?": "בבית עכשיו?",
  "I don't have a Home saved yet.": "עוד אין לי בית שמור.", "Then I'll know when tasks that need home fit.": "ככה אדע מתי מתאימות משימות שצריכות בית.",
  "Show it on a map": "להראות במפה", "Yes, I was": "כן, הייתי", "Yes, I'm home": "כן, אני בבית", "Is this a place you go to?": "זה מקום שהולכים אליו?",
  "Name this place?": "לתת שם למקום?", "Tasks that mention it come first when you're there.": "משימות שמזכירות אותו יופיעו ראשונות כשתהיו שם.",
  "Work, Studio, Gym…": "עבודה, סטודיו, חדר כושר…", "Just passing through": "רק עוברים", "How many minutes each way?": "כמה דקות לכל כיוון?",
  "I'll keep the way there and back free, with time to park and settle in. How long is the ride each way?": "אשאיר פנוי את הדרך הלוך ושוב, עם זמן לחנות ולהתמקם. כמה זמן הנסיעה לכל כיוון?",
  "Minutes each way (optional)": "דקות לכל כיוון (לא חובה)", "Minutes each way": "דקות לכל כיוון", "I'll eat there": "אוכל שם",
  "No free time to eat then, or near it.": "אין זמן פנוי לאכול אז, או קרוב לזה.", "Did it": "בוצע", "Skipped it": "דילגתי", "It's still open.": "זה עדיין פתוח.",
  "Tonight, or does the date move?": "הלילה, או שהתאריך זז?", "I'll do it tonight": "אעשה את זה הלילה", "Move it to tomorrow": "להעביר למחר",
  "Still for today?": "עדיין להיום?", "It was planned for today.": "זה תוכנן להיום.", "I'd move it to tomorrow.": "הייתי מעבירה למחר.", "Move to tomorrow": "להעביר למחר",
  "On hold": "מושהה", "Deadline coming up": "דדליין מתקרב", "Bring it back, or delete it?": "להחזיר, או למחוק?", "I'd bring it back before it's too late.": "הייתי מחזירה לפני שיהיה מאוחר.",
  "Bring it back": "להחזיר", "Keep it": "להשאיר", "Still want this?": "עדיין רוצים את זה?", "Keep it, or delete it?": "להשאיר, או למחוק?", "Keeps sliding": "ממשיך להידחות",
  "Keep it, park it, or delete it?": "להשאיר, להשהות, או למחוק?", "Still pending?": "עדיין ממתין?", "Yes, still pending": "כן, עדיין ממתין", "No, it's ready": "לא, זה מוכן",
  "Bring one back?": "להחזיר אחת?", "From On hold, for this week.": "מהמושהות, לשבוע הזה.", "Leave it there": "להשאיר שם",
  "It's in today's plan. I'd keep it today.": "זה בתוכנית של היום. הייתי משאירה להיום.", "Still doing this?": "עדיין עושים את זה?", "Do it today": "לעשות היום",
  "That's the day.": "זה היום.", "That's everything.": "זה הכול.", "Tomorrow's sorted. Sleep well.": "מחר מסודר. לילה טוב.", "Nothing else needs you.": "שום דבר אחר לא מחכה לך.",
  "Keep the event?": "להשאיר את האירוע?", "Added as a task.": "נוסף כמשימה.", "The task is in your list either way.": "המשימה ברשימה בכל מקרה.",
  "Keep it in the calendar": "להשאיר ביומן", "Delete the event": "למחוק את האירוע", "Needs you: 3 quick decisions": "מחכה לך: 3 החלטות קצרות",

  // Projects (projects.js)
  "+ New": "+ חדש", "Next: pick one": "הבא: לבחור אחת", "pick one": "לבחור אחת", "needs you": "מחכה לך", "All done": "הכול בוצע", "This week's Daisey": "ה-Daisey של השבוע",
  "A petal for each task you finish, a leaf for each routine.": "עלה כותרת לכל משימה שמסתיימת, עלה לכל שגרה.", "Still a bud. It opens as you go.": "עדיין ניצן. הוא נפתח תוך כדי.",
  "Done this week": "בוצע השבוע", "Most of your time": "רוב הזמן", "Daisey suggests these first": "Daisey מציעה את אלה קודם", "In the mix most days": "ברוב הימים",
  "Only when nothing else waits, or a date is close": "רק כששום דבר אחר לא מחכה, או כשתאריך מתקרב", "Daisey suggests it first now:": "Daisey מציעה את זה קודם עכשיו:",
  "Back in the mix:": "חזרה לסבב:", "Waits until there's room:": "מחכה שיתפנה מקום:", "Focus is full. Move one out first.": "הפוקוס מלא. קודם להוציא אחד.",
  "0% done": "0% בוצע", "Drag a project here": "גררו לכאן פרויקט", "Due can't be before the start.": "תאריך היעד לא יכול להיות לפני ההתחלה.",
  "Max tasks a day": "מקסימום משימות ביום", "No limit": "בלי הגבלה", "Project name": "שם הפרויקט", "There's already a project by that name.": "כבר יש פרויקט בשם הזה.",
  "New project": "פרויקט חדש", "Add project": "הוספת פרויקט", "Delete project": "מחיקת פרויקט", "Edit project": "עריכת פרויקט", "Did it:": "בוצע:",
  "Starts": "מתחיל", "waiting for a reply": "מחכה לתשובה", "Reopened:": "נפתח מחדש:", "Back on the list:": "חזרה לרשימה:", "Waiting on:": "מחכה ל:",
  "Nothing done yet.": "עוד לא בוצע כלום.", "Off your plate. Daisey offers one back on Sunday.": "ירד מהצלחת. Daisey תציע אחת בחזרה ביום ראשון.",
  "Done with one? Swipe it right →, or tap its ✓.": "סיימתם אחת? החליקו אותה שמאלה ←, או הקישו על ה-✓.", "+ Add a task": "+ הוספת משימה", "+ Task": "+ משימה",

  // Import from Trello, jobs, CV
  "Trello isn't connected yet.": "Trello עוד לא מחובר.", "Trello didn't answer.": "Trello לא ענה.", "Couldn't reach Trello.": "לא הצלחנו להגיע ל-Trello.",
  "Nothing new to bring in.": "אין שום דבר חדש להביא.", "Bringing them in…": "מביאים אותם…", "Connect Trello once, then pick the boards to bring in.": "חברו את Trello פעם אחת, ואז בחרו לוחות להביא.",
  "Connect Trello": "חיבור Trello", "Looking…": "מחפש…", "No Trello boards.": "אין לוחות Trello.", "Which board?": "איזה לוח?", "Import from Trello": "ייבוא מ-Trello",
  "Cover letter": "מכתב מקדים", "Job post": "מודעת משרה", "Apply": "להגיש", "Build tasks": "לבנות משימות",
  "Opens the print dialog. Tick “Background graphics” there, or the colours and photo are left out of the PDF.": "פותח את חלון ההדפסה. סמנו שם „גרפיקת רקע”, אחרת הצבעים והתמונה לא ייכנסו ל-PDF.",
  "Google needs you to reconnect": "Google מבקשת להתחבר מחדש", "Google needs you to reconnect (Drive access)": "Google מבקשת להתחבר מחדש (גישה ל-Drive)",
  "That CV file isn't in your Drive": "קובץ קורות החיים לא נמצא ב-Drive", "Google isn't connected": "Google לא מחובר", "Your browser blocked the CV window": "הדפדפן חסם את חלון קורות החיים",
  "Loading CV…": "טוען קורות חיים…", "Couldn't load the CV": "לא הצלחנו לטעון את קורות החיים",

  // Tell Daisey (tell.js)
  "That's today's limit for Tell Daisey. It resets tomorrow.": "זו המכסה היומית של „לספר ל-Daisey”. היא מתאפסת מחר.", "Couldn't reach Daisey's helper.": "לא הצלחנו להגיע לעוזר של Daisey.",
  "Couldn't read that one. Try saying it another way?": "לא הצלחתי להבין. אפשר לנסח אחרת?", "Signed out. Sign in again and retry.": "התנתקת. התחברו שוב ונסו שוב.",
  "Tell Daisey is temporarily unavailable. Try again shortly.": "„לספר ל-Daisey” לא זמין כרגע. נסו שוב בעוד רגע.", "On a train": "ברכבת", "Passenger": "נוסע/ת",
  "What Daisey understood": "מה Daisey הבינה", "On your mind? Tell Daisey…": "מה על הראש? ספרו ל-Daisey…", "Reading…": "קוראת…",
  "I read that as an event.": "הבנתי את זה כאירוע.", "Add as an event": "להוסיף כאירוע", "Try again": "לנסות שוב", "Add as a task": "להוסיף כמשימה",
  "Here's what I got:": "זה מה שהבנתי:", "Nothing to change.": "אין מה לשנות.", "No free time left there.": "לא נשאר שם זמן פנוי.", "Nothing there.": "אין שם כלום.",
  "Change": "שינוי", "Drop": "להוריד", "Right now": "עכשיו", "Back on": "חזרה ל", "you pick when": "את/ה בוחר/ת מתי", "pick something else for the card": "לבחור משהו אחר לכרטיס",
  "no date, still open": "בלי תאריך, עדיין פתוח", "waiting is over": "ההמתנה נגמרה", "starts with its first task": "מתחיל במשימה הראשונה שלו", "Add first task": "הוספת משימה ראשונה",
  "Don't do this one": "לא לעשות את זה", "Done.": "בוצע.", "Some of that didn't save.": "חלק מזה לא נשמר.", "Listening. Tap to send": "מקשיבה. הקישו לשליחה", "Listening…": "מקשיבה…",
  "I have 30 minutes": "יש לי 30 דקות", "What am I waiting on?": "למה אני מחכה?", "What's next?": "מה הבא?", "Plan my afternoon": "לתכנן את הצהריים",
  "Plan my evening": "לתכנן את הערב", "What's due this week?": "מה צריך השבוע?", "I'm wrecked": "אני גמור/ה", "I'm tired": "אני עייף/ה",
  "I didn't catch that, so here's a fresh take. Try “lighter”, “no calls”, “start with …” or “until 5”.": "לא הבנתי, אז הנה הצעה חדשה. נסו „קל יותר”, „בלי שיחות”, „להתחיל עם …” או „עד 5”.",
  "Can this be done online?": "אפשר לעשות את זה אונליין?", "Which day?": "איזה יום?",

  // Reasons (engine.js, reason.js)
  "planned for today": "מתוכנן להיום", "Planned for today.": "מתוכנן להיום.", "costing money now": "עולה כסף עכשיו", "costs money if late": "עולה כסף אם מאחרים",
  "the penalty applies now": "הקנס חל עכשיו", "there's a penalty if late": "יש קנס על איחור", "you marked it as affecting someone": "סימנת שזה משפיע על מישהו",
  "almost done, finish it": "כמעט גמור, לסיים", "half done, finish it": "חצי גמור, לסיים", "keeps Inbox going": "מקדם את הדואר הנכנס", "I'd do this one next.": "הייתי עושה את זאת בהמשך.",
  "keep, shrink, or drop?": "להשאיר, לקצר, או לוותר?", "Still on it?": "עדיין על זה?", "First in the plan below": "ראשון בתוכנית למטה", "first in your plan": "ראשון בתוכנית",
  "first in the plan below": "ראשון בתוכנית למטה", "no one wants to deal with that": "אף אחד לא רוצה להתעסק עם זה", "a similar past task": "משימה דומה מהעבר",
  "similar past tasks": "משימות דומות מהעבר", "still pending?": "עדיין ממתין?", "needs office hours, none left today": "צריך שעות משרד, לא נשארו היום",
  "evening only, no evening time left": "רק בערב, לא נשאר זמן ערב", "no free time left today": "לא נשאר זמן פנוי היום",

  // Shared dialogs (ui.js)
  "Don't save": "לא לשמור", "Keep editing": "להמשיך לערוך", "Undo:": "ביטול:", "Riding back from…": "בדרך חזרה מ…",
  "Not home": "לא בבית", "On a train, bus or driving?": "ברכבת, באוטובוס או נוהג/ת?", "train, bus or driving?": "רכבת, אוטובוס או נהיגה?",
  "Sample": "דוגמה", "Draft the project proposal": "לכתוב טיוטה להצעת הפרויקט", "Send the invoice": "לשלוח את החשבונית", "Pay the electricity bill": "לשלם את חשבון החשמל",
};
const DICT = new Map(Object.entries(HE_TEXT));

// Bits of English inside a templated string: durations, day and month names,
// today/tomorrow. Applied to the pieces a pattern captures, never to text as a whole.
const bit = (s) => DICT.get(s) ?? s
  .replace(/(\d+) (?:hours?|h)\b/g, "$1 ש׳").replace(/(\d+) min(?:utes?)?\b/g, "$1 דק׳")
  .replace(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g, (d) => DAYS[d])
  .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (m) => MONTHS[m])
  .replace(/\btoday\b/g, "היום").replace(/\btomorrow\b/g, "מחר").replace(/\byesterday\b/g, "אתמול")
  .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1");

// Templated text, matched whole. [regex, Hebrew with $1… or a function of the match].
// A pattern given as a string may say {D}: something date-like ("today",
// "Fri", "Oct 12", "14:00"), so it can't swallow a title that merely starts
// with "Due" or ends in "left".
const DATE = String.raw`((?:today|tonight|tomorrow|yesterday|יום [א-ו]׳|שבת|(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?: \d+)?|\d[\d:.\/]*(?: [A-Z][a-z]{2})?)(?: \d\d?:\d\d)?)`;
const DUR = String.raw`(\d+ (?:h|min)(?: \d+ min)?)`;
const P = (re, out) => [typeof re === "string" ? new RegExp(re.replace(/\{D\}/g, DATE).replace(/\{T\}/g, DUR)) : re, typeof out === "function" ? out : (m) => out.replace(/\$(\d)/g, (_, i) => bit(m[i] ?? ""))];
const PATTERNS = [
  P(/^(\d+) min$/, "$1 דק׳"), P(/^\+(\d+) min$/, "+$1 דק׳"), P(/^(\d+) h$/, "$1 ש׳"), P(/^(\d+) h (\d+) min$/, "$1 ש׳ $2 דק׳"),
  P(/^(\d+)h$/, "$1ש׳"), P(/^(\d+)h (\d+)m$/, "$1ש׳ $2ד׳"), P(/^([\d.]+) h$/, "$1 ש׳"),
  P("^{T} left$", "נשארו $1"), P("^{T} free$", "$1 פנוי"), P("^{T} free today\\.$", "$1 פנוי היום."),
  P(/^(\d+)% done$/, "$1% בוצע"), P(/^(\d+)%$/, "$1%"), P(/^of (\d+)$/, "מתוך $1"), P(/^(\d+) of (\d+) done$/, "$1 מתוך $2 בוצעו"), P(/^(\d+) of (\d+) in Focus$/, "$1 מתוך $2 בפוקוס"),
  P(/^Room for (\d+) more · drag a project here$/, "מקום לעוד $1 · גררו לכאן פרויקט"),
  P(/^(\d+) of (\d+) this (week|month)$/, (m) => `${m[1]} מתוך ${m[2]} ${m[3] === "week" ? "השבוע" : "החודש"}`),
  P(/^(\d+) of (\d+) this (week|month) so far\.$/, (m) => `${m[1]} מתוך ${m[2]} ${m[3] === "week" ? "השבוע" : "החודש"} עד עכשיו.`),
  P(/^(\d+)× a week$/, "$1 פעמים בשבוע"), P(/^(\d+)× a month$/, "$1 פעמים בחודש"),
  P(/^(\d+) to go, last day$/, "עוד $1, יום אחרון"), P(/^(\d+) to go, (\d+) days left$/, "עוד $1, נשארו $2 ימים"),
  P(/^(\d+) more this (week|month), (\d+) days left$/, (m) => `עוד ${m[1]} ${m[2] === "week" ? "השבוע" : "החודש"}, נשארו ${m[3]} ימים`),
  P(/^(\d+) things need you\.?$/, "$1 דברים מחכים לך"), P(/^(\d+) still open for today$/, "$1 עוד פתוחות להיום"),
  P(/^(\d+) tasks$/, "$1 משימות"), P(/^(\d+) min before$/, "$1 דק׳ לפני"),
  P(/^(.+) time$/, (m) => DICT.has(m[1]) ? `זמן ${DICT.get(m[1])}` : null), P(/^(.+) length$/, (m) => DICT.has(m[1]) ? `אורך ${DICT.get(m[1])}` : null),
  P(/^(\d\d:\d\d) · (\d+) min$/, "$1 · $2 דק׳"), P(/^(.+) at (\d\d:\d\d), (\d+) minutes\. Change$/, (m) => `${bit(m[1])} ב-${m[2]}, ${m[3]} דקות. שינוי`),
  P("^{T} break$", "הפסקה $1"), P(/^Free (.+) — add an event$/, "פנוי $1 — הוספת אירוע"), P(/^Next, in (.+):$/, "הבא, בעוד $1:"),
  P(/^(.+), all day$/, null), // a title: leave it
  P(/^Good (morning|afternoon|evening)(.*)$/, (m) => ({ morning: "בוקר טוב", afternoon: "צהריים טובים", evening: "ערב טוב" })[m[1]] + m[2]),
  P(/^Up late(.*)$/, "ער/ה מאוחר$1"),
  P(/^Plan: (\d+) of (\d+) done\.$/, "תוכנית: $1 מתוך $2 בוצעו."), P(/^Plan done: (\d+) of (\d+)\.$/, "התוכנית: $1 מתוך $2 בוצעו."),
  P(/^(\d+) open today\.$/, "$1 פתוחות היום."), P(/^(\d+) open, about (\d+) fit\.$/, "$1 פתוחות, בערך $2 נכנסות."),
  P(/^Plan set: (\d+) tasks?\. The card follows it\.$/, "התוכנית נקבעה: $1 משימות. הכרטיס הולך לפיה."),
  P(/^Took (\d+) tasks off the plan\.$/, "הוצאו $1 משימות מהתוכנית."), P(/^Added (\d+) tasks to the end of your plan\.$/, "נוספו $1 משימות לסוף התוכנית."),
  P(/^Time opened up\. Add (\d+) tasks\?$/, "התפנה זמן. להוסיף $1 משימות?"),
  P(/^Removed (today|tomorrow)'s plan\. Your calendar is untouched\.$/, "התוכנית של $1 הוסרה. היומן לא השתנה."),
  P(/^Remove (today|tomorrow)'s plan$/, "להסיר את התוכנית של $1"), P(/^Add them to (today|tomorrow)'s plan$/, "להוסיף לתוכנית של $1"),
  P(/^(today|tomorrow)'s plan$/i, "התוכנית של $1"), P(/^(\d+) planned tasks passed with no Done\.$/, "$1 משימות מתוכננות עברו בלי סימון בוצע."),
  P(/^Running behind: (\d+) won't fit\.$/, "מאחרים: $1 לא ייכנסו."), P(/^(\d+) passed with no Done, (\d+) won't fit\.$/, "$1 עברו בלי סימון בוצע, $2 לא ייכנסו."),
  P(/^(\d+) projects moved\.$/, "$1 פרויקטים זזו."), P(/^Show the (\d+) (?:tasks )?you put off(?: today)?$/, "להציג את $1 שנדחו"),
  P(/^Bring (\d+) back to this week$/, "להחזיר $1 לשבוע הזה"), P(/^In (.+)\. Nothing else fits before it\.$/, "בעוד $1. שום דבר אחר לא נכנס לפני."),
  P(/^Free until (\d\d:\d\d)\.$/, "פנוי עד $1."), P(/^and (\d+) more$/, "ועוד $1"), P(/^Planned (\d\d:\d\d)(.*)$/, "מתוכנן $1$2"),
  P(/^planned for (\d\d:\d\d), no Done yet$/, "מתוכנן ל-$1, עוד לא בוצע"), P(/^up since (\d\d:\d\d), no Done yet$/, "מאז $1, עוד לא בוצע"),
  P(/^Later \((.+)\):$/, "אחר כך ($1):"), P(/^This week \((.+)\):$/, "השבוע ($1):"),
  P(/^(.+) left\. Daisey picks a task again when it ends\.$/, "נשארו $1. Daisey תבחר משימה שוב כשזה ייגמר."),
  P("^Overdue since {D}\\.?$", "באיחור מאז $1"), P("^Due {D}$", "עד $1"), P("^Target was {D}$", "היעד היה $1"), P("^Target {D}$", "יעד $1"), P("^Planned for {D}(\\.?)$", "מתוכנן ל$1$2"),
  P("^Starts {D}$", "מתחיל $1"), P("^(Was due|By|was due|due|by) {D}$", (m) => `${/was/i.test(m[1]) ? "היה עד" : "עד"} ${bit(m[2])}`),
  P("^The deadline (was|is) {D}\\.$", (m) => `הדדליין ${m[1] === "was" ? "היה" : "הוא"} ${bit(m[2])}.`),
  P("^It's on hold\\. The deadline (was|is) {D}\\.$", (m) => `זה מושהה. הדדליין ${m[1] === "was" ? "היה" : "הוא"} ${bit(m[2])}.`),
  P("^Move to {D}$", "להעביר ל$1"), P("^I'll ask you {D}$", "אשאל שוב ב$1"),
  P(/^deadline passed (.+)$/, "הדדליין עבר $1"), P(/^deadline (.+?), (.+) still to do$/, "דדליין $1, עוד $2"),
  P(/^untouched for (\d+) days$/, "לא נגעו בזה $1 ימים"), P(/^(\d+)% done, finish it$/, "$1% בוצע, לסיים"), P(/^(.+), quick win$/, "$1, ניצחון מהיר"),
  P(/^(.+), a piece of it$/, "$1, חלק מזה"), P(/^Fit (\d+)\/10(.*)$/, "התאמה $1/10$2"),
  P(/^You've been away (\d+) days\.$/, "לא היית כאן $1 ימים."), P(/^It was (.+)\.$/, "זה היה $1."), P(/^It was planned for (.+)\.$/, "זה תוכנן ל$1."),
  P(/^Put off (\d+) times without starting\.$/, "נדחה $1 פעמים בלי להתחיל."), P(/^Pushed to a later day (\d+) times\.$/, "נדחה ליום אחר $1 פעמים."),
  P(/^I'd move it to (.+), the roomiest day this week\.$/, "הייתי מעבירה ל$1, היום הכי פנוי השבוע."),
  P(/^Brought in (\d+) cards?\.$/, "הובאו $1 כרטיסים."), P(/^Bring in (\d+)(.*)$/, "להביא $1$2"),
  P(/^Job Hunt: (\d+) stage changes? not saved to Drive\. Tap to retry\.$/, "חיפוש עבודה: $1 שינויי שלב לא נשמרו ב-Drive. הקישו לנסות שוב."),
  P(/^On\. The morning brief comes at (\d\d:\d\d), when your day starts\.$/, "פועל. סיכום הבוקר מגיע ב-$1, כשהיום מתחיל."),
  P(/^Worked (\d+) sessions? · (.+) so far$/, "$1 סשנים · $2 עד עכשיו"), P(/^Done: (\d+) changes\.$/, "בוצע: $1 שינויים."),
  P(/^Save this (.+)\?$/, (m) => `לשמור את ה${{ task: "משימה", event: "אירוע", project: "פרויקט" }[m[1]] ?? m[1]}?`),
  P(/^Really delete\? (\d+) tasks? too$/, "למחוק באמת? גם $1 משימות"), P(/^(\d+) tasks? outside these dates:$/, "$1 משימות מחוץ לתאריכים:"),
  P(/^(\d+) (\w+) moved to (.+), so this is a fresh plan\.$/, null),
  P(/^Moved to (.+)\.$/, "הועבר ל$1."), P(/^Every month on the (.+?)(, from Start)?\.$/, (m) => `כל חודש ב-${bit(m[1])}${m[2] ? ", מתאריך ההתחלה" : ""}.`),
  P(/^(Today|Tomorrow|Yesterday) · (.+)$/, "$1 · $2"), P(/^(.+) — back to today$/, "$1 — חזרה להיום"), P(/^(.+) — open the day$/, "$1 — לפתוח את היום"),
  P(/^Take five · (.+)$/, "הפסקה קצרה · $1"), P(/^Lunch time · (.+)$/, "זמן צהריים · $1"), P(/^Open space · (.+)$/, "זמן פתוח · $1"), P(/^Next · (.+)$/, "הבא · $1"),
  P(/^(.+) of (.+), shortened to fit$/, "$1 מתוך $2, קוצר כדי להיכנס"), P(/^No free time to eat then\. Eating there, or (.+) at (\d\d:\d\d)\?$/, null),
  P(/^Were you home at (\d\d:\d\d)\?$/, "היית בבית ב-$1?"), P(/^Where were you at (.+)\?$/, "איפה היית ב-$1?"),
  P(/^You stood still there about (.+)\.$/, "עמדת שם בערך $1."), P(/^You've stopped there on (\d+) days\.$/, "עצרת שם ב-$1 ימים."),
  P(/^You've been still here since (\d\d:\d\d)\.$/, "את/ה כאן מאז $1."),
  P(/^It's booked (\d\d:\d\d)–(\d\d:\d\d)\. Deadline (.+)\.$/, "שמור $1–$2. דדליין $3."), P(/^I can move it to (\d\d:\d\d)\.$/, "אפשר להעביר ל-$1."),
  P(/^It's (.+), and the week has room\.$/, "זה $1, ויש מקום השבוע."), P(/^One question about (.+)\.$/, "שאלה אחת על $1."),
  P(/^(\d+) deadlines are still open today\.$/, "$1 דדליינים עוד פתוחים היום."),
  P(/^Nothing's moved since (.+)\.$/, "שום דבר לא זז מאז $1."), P(/^(.+) Want a lighter plan for the rest of today\?$/, null),
  P(/^Pending(.*)\.$/, "ממתין$1."), P(/^Overdue since (.+)\. Planned for today\.$/, "באיחור מאז $1. מתוכנן להיום."),
];
// Patterns whose output is null are deliberate "leave it" lines; the null
// output above returns undefined below, i.e. English stays.

function translate(core){
  const hit = DICT.get(core);
  if (hit != null) return hit;
  for (const [re, out] of PATTERNS) {
    const m = core.match(re);
    if (m) { const r = out(m); return r == null ? null : r; }
  }
  // A line of parts ("20% · 24 min left · due Fri"): each part on its own;
  // a tail piece arrives as its own node, starting "· ".
  if (core.startsWith("· ")) { const rest = translate(core.slice(2)); return rest == null ? null : `· ${rest}`; }
  if (core.includes(" · ")) {
    const parts = core.split(" · "), out = parts.map((p) => translate(p) ?? units(p));
    if (out.some((p, i) => p !== parts[i])) return out.join(" · ");
  }
  return null;
}

// t(): the same lookup for code that builds a string it doesn't put in the
// DOM itself (document.title, a notification). English passes through.
export function t(s, mixed = false){
  if (!HE || typeof s !== "string") return s;
  const core = s.trim();
  const out = core && /[A-Za-z]/.test(core) ? translate(core) : null;
  if (out != null) return ltr(s.replace(core, out));
  return mixed ? s : ltr(units(s));
}
// Left over in any line nothing matched whole ("5 min · 19:01–19:06"): the units.
const units = (s) => s.replace(/\b(\d+) h (\d+) min\b/g, "$1 ש׳ $2 דק׳").replace(/\b(\d+) min\b/g, "$1 דק׳").replace(/\b(\d+) h\b/g, "$1 ש׳");
// A time range in right-to-left text prints backwards (19:06–19:01): each one
// is isolated left to right, once.
const ltr = (s) => s.replace(/(?<!⁦)\b\d{1,2}:\d\d\s?[–-]\s?\d{1,2}:\d\d\b/g, "⁦$&⁩");

const SKIP = 'bdi, input, textarea, script, style, [contenteditable], [data-no-i18n]';
// dir="auto" holds both: Daisey's own lines (Needs you questions) and titles.
// There only a whole-line match translates; no loose unit or range edits.
const MIXED = '[dir="auto"]';
const ATTRS = ["aria-label", "placeholder", "title", "alt", "aria-valuetext"];

function doText(node){
  const p = node.parentElement;
  if (!p || p.closest(SKIP)) return;
  const v = node.data, out = t(v, !!p.closest(MIXED));
  if (out !== v) node.data = out;
}
function doAttrs(el){
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) { const out = t(v); if (out !== v) el.setAttribute(a, out); }
  }
}
function walk(root){
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return;
  doAttrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
}

if (HE) {
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";
  // Dates and times the app formats with the browser's locale (or en-GB/en-US
  // for display) come out in Hebrew; en-CA (a YYYY-MM-DD key) is left alone.
  for (const name of ["toLocaleDateString", "toLocaleTimeString", "toLocaleString"]) {
    const orig = Date.prototype[name];
    Date.prototype[name] = function(loc, opts){
      const swap = loc == null || (Array.isArray(loc) && !loc.length) || loc === "en-GB" || loc === "en-US" || loc === "en";
      return orig.call(this, swap ? "he-IL" : loc, opts);
    };
  }
  const start = () => {
    walk(document.body);
    new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === "childList") r.addedNodes.forEach(walk);
        else if (r.type === "characterData") doText(r.target);
        else if (r.target.nodeType === 1) { const v = r.target.getAttribute(r.attributeName); if (v) { const out = t(v); if (out !== v) r.target.setAttribute(r.attributeName, out); } }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  document.body ? start() : document.addEventListener("DOMContentLoaded", start, { once: true });
}
