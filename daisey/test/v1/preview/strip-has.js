/* Drops every CSS rule whose selector uses :has(), as a browser without :has()
   does (a selector list with one unknown part is thrown out whole). Used by
   preview.js --no-has to see the app the way Mor's older phone does. */
module.exports = function stripHas(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) { const e = css.indexOf("*/", i + 2); const end = e < 0 ? css.length : e + 2; out.push(css.slice(i, end)); i = end; continue; }
    const open = css.indexOf("{", i), semi = css.indexOf(";", i);
    if (semi >= 0 && (open < 0 || semi < open)) { out.push(css.slice(i, semi + 1)); i = semi + 1; continue; } // @import, @charset
    if (open < 0) { out.push(css.slice(i)); break; }
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { const c = css[j]; if (c === "/" && css[j + 1] === "*") { j = css.indexOf("*/", j + 2) + 1; } else if (c === "{") depth++; else if (c === "}") depth--; j++; }
    const prelude = css.slice(i, open), body = css.slice(open + 1, j - 1);
    if (prelude.trim().startsWith("@")) out.push(prelude + "{" + (/^\s*@(media|supports|layer)/.test(prelude) ? module.exports(body) : body) + "}");
    else if (!prelude.includes(":has(")) out.push(prelude + "{" + body + "}");
    i = j;
  }
  return out.join("");
};
