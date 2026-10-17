// A duration said in a task's own words (Mor, 2026-10-18: "Submit report
// yesterday 20 min" became 1 h). The helper (Gemini) reads these in a task
// sentence, but a miss fell through to the title-based 1 h guess, so what the
// user typed is read here too and wins. PURE: text in, minutes out.
//
// "20 min", "20 minutes", "20m", "1 h", "1h", "2 hours", "1.5 h", "1 h 30 min",
// "half an hour", "an hour", "an hour and a half", "a quarter of an hour",
// Hebrew ("20 דקות", "חצי שעה", "שעתיים"). Where it sits among other words
// (a date before or after it) makes no difference. null when there's none,
// or when two different ones are said (one sentence, two tasks).

const NUM = "(\\d+(?:[.,]\\d+)?)";
// Not glued to a letter or digit on either side, so "5 minutes" is one, "admin" and "3pm" aren't.
const L = "(?<![\\p{L}\\d])", R = "(?![\\p{L}\\d])";
const num = (s) => parseFloat(String(s).replace(",", "."));

// [regex, minutes from the match]
const RULES = [
  [new RegExp(`${L}${NUM}\\s*(?:h|hr|hrs|hours?)\\s*(?:and\\s*)?${NUM}\\s*(?:m|mins?|minutes?)${R}`, "iu"), (m) => num(m[1]) * 60 + num(m[2])],
  [new RegExp(`${L}(?:an?\\s+)?hour\\s+and\\s+a\\s+half${R}`, "iu"), () => 90],
  [new RegExp(`${L}half\\s+(?:an?\\s+)?hour${R}`, "iu"), () => 30],
  [new RegExp(`${L}(?:a\\s+)?quarter\\s+(?:of\\s+an\\s+)?hour${R}`, "iu"), () => 15],
  [new RegExp(`${L}${NUM}\\s*(?:h|hr|hrs|hours?)${R}`, "iu"), (m) => num(m[1]) * 60],
  [new RegExp(`${L}${NUM}\\s*(?:m|mins?|minutes?)${R}`, "iu"), (m) => num(m[1])],
  [new RegExp(`${L}(?:an?|one)\\s+hour${R}`, "iu"), () => 60],
  [new RegExp(`${L}חצי\\s+שעה${R}`, "u"), () => 30],
  [new RegExp(`${L}שעתיים${R}`, "u"), () => 120],
  [new RegExp(`${L}${NUM}\\s*שעות${R}`, "u"), (m) => num(m[1]) * 60],
  [new RegExp(`${L}${NUM}\\s*דק(?:ות|ה)${R}`, "u"), (m) => num(m[1])],
  [new RegExp(`${L}שעה\\s+אחת${R}`, "u"), () => 60],
];

// → { minutes, rest } (rest: the text without the duration words), or null.
export function durationFrom(text = ""){
  const s = String(text);
  const found = [];
  let rest = s;
  for (const [re, minutes] of RULES) {
    for (let m = re.exec(rest); m; m = re.exec(rest)) {
      found.push(Math.round(minutes(m)));
      rest = rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length); // each phrase counts once
    }
  }
  const mins = [...new Set(found)];
  if (mins.length !== 1 || !(mins[0] >= 1 && mins[0] <= 24 * 60)) return null;
  return { minutes: mins[0], rest: rest.replace(/\s+/g, " ").replace(/\s+([,.;!?])/g, "$1").replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "") };
}

// A duration typed in the sentence wins over the helper's reading, or its
// silence (which falls to a 1 h guess): "Submit report yesterday 20 min" is
// 20 min. Only for one lone add: with several tasks, which duration is whose
// is the helper's call.
export function withSpoken(actions, text){
  const said = durationFrom(text);
  return said && actions.length === 1 && actions[0].kind === "add" ? [{ ...actions[0], size: said.minutes }] : actions;
}
