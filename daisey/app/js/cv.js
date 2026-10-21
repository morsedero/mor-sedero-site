// "View CV" on a Job Hunt task (Mor, 2026-10-21): the CV is an HTML file in
// Drive. daisey-now-cv fetches it (the Google grant lives on the server, the
// browser holds no Drive token), and it opens here as a real page in its own
// window, so its Google Fonts and its photo load as they would anywhere. Its
// CSS has @page A4 with no margins; a Print to PDF button in that window does
// the rest. Nothing is written back to Drive.
const URL_ = "/.netlify/functions/daisey-now-cv";

const TIP = "Opens the print dialog. Tick “Background graphics” there, or the colours and photo are left out of the PDF.";
const PRINT_BTN = `<style>@media print{.dz-print{display:none!important}}</style>
<button class="dz-print" type="button" title="${TIP}" onclick="window.print()"
  style="position:fixed;top:12px;right:12px;z-index:99;padding:8px 14px;border:0;border-radius:999px;background:#1f1d1a;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)">Print to PDF</button>`;

// The page with the print button in it: before </body>, or at the end.
export const withPrintButton = (html) => (/<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => PRINT_BTN + "</body>") : html + PRINT_BTN);

const WHY = {
  needs_reauth: "Google needs you to reconnect",
  needs_drive: "Google needs you to reconnect (Drive access)",
  no_file: "That CV file isn't in your Drive",
  not_connected: "Google isn't connected",
};

// The window opens at once, inside the tap (a popup opened after the fetch is
// blocked on phones), and takes the CV when it arrives. Resolves true when the CV
// is showing, else the reason as text. Its blob URL is revoked when the window closes.
export async function viewCv(fileId, { fetchFn = fetch, open = (...a) => window.open(...a), token = () => import("./firebase.js").then((m) => m.idToken()), every = 2000 } = {}){
  const w = open("", "_blank");
  if (!w) return "Your browser blocked the CV window";
  try { w.opener = null; w.document.title = "CV"; w.document.body.textContent = "Loading CV…"; } catch { /* about:blank is ours to write; if not, the page replaces it anyway */ }
  try {
    const res = await fetchFn(`${URL_}?id=${encodeURIComponent(fileId)}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body.html !== "string") throw new Error(WHY[body.error] || "Couldn't load the CV");
    const url = URL.createObjectURL(new Blob([withPrintButton(body.html)], { type: "text/html;charset=utf-8" }));
    w.location.href = url;
    const watch = () => (w.closed ? URL.revokeObjectURL(url) : setTimeout(watch, every));
    setTimeout(watch, every);
    return true;
  } catch (e) {
    w.close();
    return e.message || "Couldn't load the CV";
  }
}
