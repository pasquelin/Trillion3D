/**
 * The audience measurement tag of www.trillion3d.com, added to every served page.
 *
 * One line, loaded from www.pasquelin.com: behind it, the consent panel and the Google
 * Analytics loader are a single shared file, so a fix is made once for the four sites that
 * carry it rather than four times. Nothing reaches Google before the visitor agrees, and the
 * panel takes its colours from the page it opens on. Its source, translations and tests live
 * in the `pasquelin/site` repository, under `public/shared/`.
 *
 * Only the published build carries it (`docs-build.ts --published`, run by the site workflow):
 * a local serve, a browser proof or a thumbnail capture never calls the audience host.
 *
 * The tag is injected at copy time rather than written into the hundred page sources: a page
 * added tomorrow would silently miss it, and a hundred copies of one line drift apart. The
 * measurement id is public by construction — every page carrying it shows it to anyone who
 * reads the source — so it belongs here and not in a secret.
 *
 * This module holds no dependency of its own so that it stays testable without building the
 * whole site.
 */
const MEASUREMENT_ID = 'G-488KCZW3JQ';
const LOADER = 'https://www.pasquelin.com/shared/consent.v1.js';

export const MEASUREMENT_TAG = `<script defer src="${LOADER}" data-ga="${MEASUREMENT_ID}"></script>`;

/**
 * The same tag for a page the portal shows in a frame, an example: it loads only when the page is
 * the top window, so a visit to the portal is not counted a second time by the page it frames,
 * while the example opened on its own is counted like any page.
 */
export const FRAMED_MEASUREMENT_TAG =
  `<script>if (self === top) { const tag = document.createElement('script'); ` +
  `tag.src = '${LOADER}'; tag.dataset.ga = '${MEASUREMENT_ID}'; document.head.append(tag); }</script>`;

/**
 * `html` with `tag` before its `</head>`, indented one step inside it; `html` unchanged when it has
 * no head to carry one, since a fragment is not a page and failing a build over one would stop
 * the site for a file no browser loads. What guarantees the real pages are covered is the
 * test walking the served tree, not this function.
 */
export function withMeasurement(html: string, tag = MEASUREMENT_TAG): string {
  if (html.includes('consent.v1.js')) return html;
  const close = /^([ \t]*)<\/head>/m.exec(html);
  if (!close) return html;
  return html.replace(close[0], `${close[1]}  ${tag}\n${close[0]}`);
}
