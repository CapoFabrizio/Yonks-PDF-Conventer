import { decodeText } from "../detect.js";
import { documentHtml, escapeHtml } from "./common.js";

/** Texte brut : retours à la ligne et tabulations conservés, police à chasse fixe. */
export function readTxt(bytes, title) {
  const text = decodeText(bytes).replace(/\r\n?/g, "\n");
  const pages = text.split("\f").map((t) => `<pre>${escapeHtml(t)}</pre>`).join('<div class="page-break"></div>');
  return documentHtml({
    title,
    body: pages,
    css: `pre { margin: 0; white-space: pre-wrap; font-family: "Liberation Mono", "Courier New", monospace; font-size: 13.333px; line-height: 1.3; tab-size: 4; }`,
  });
}
